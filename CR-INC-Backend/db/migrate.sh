#!/usr/bin/env bash
#
# Applies db/migrations/*.sql in filename order, once each, tracked in schema_migrations.
# Every migration runs in a single transaction together with its bookkeeping row, so a
# failing migration leaves the database exactly as it was.
#
#   ./db/migrate.sh            apply pending migrations
#   ./db/migrate.sh --status   show applied / pending migrations
#   ./db/migrate.sh --seed     apply pending migrations, then run db/seeds/*.sql
#   ./db/migrate.sh --reset    DROP everything (db/reset.sql), then re-apply from 001
#
# Connection comes from DATABASE_URL: exported env var first, then db/.env, then ../.env.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"
SEEDS_DIR="$SCRIPT_DIR/seeds"
RESET_FILE="$SCRIPT_DIR/reset.sql"

RUN_SEEDS=false
DO_RESET=false
STATUS_ONLY=false
ASSUME_YES=false

usage() {
    sed -n '3,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --seed)     RUN_SEEDS=true ;;
        --reset)    DO_RESET=true ;;
        --status)   STATUS_ONLY=true ;;
        -y|--yes)   ASSUME_YES=true ;;
        -h|--help)  usage 0 ;;
        *) echo "Unknown option: $1" >&2; usage 1 ;;
    esac
    shift
done

# --- connection -------------------------------------------------------------

# An already-exported DATABASE_URL takes precedence over the .env files.
EXPORTED_DATABASE_URL="${DATABASE_URL:-}"
for env_file in "$SCRIPT_DIR/.env" "$SCRIPT_DIR/../.env"; do
    if [[ -f "$env_file" ]]; then
        set -a
        # shellcheck disable=SC1090
        source "$env_file"
        set +a
        break
    fi
done
[[ -n "$EXPORTED_DATABASE_URL" ]] && DATABASE_URL="$EXPORTED_DATABASE_URL"
DATABASE_URL="${DATABASE_URL:-postgresql://incident:incident@localhost:5432/incident_response}"

if ! command -v psql >/dev/null 2>&1; then
    cat >&2 <<'EOF'
error: psql not found on PATH.

  macOS:  brew install libpq && brew link --force libpq
  or run the SQL through the container instead:
      docker compose -f db/docker-compose.yml exec -T postgres \
          psql -U incident -d incident_response -v ON_ERROR_STOP=1 -f - < db/migrations/001_extensions.sql
EOF
    exit 1
fi

psql_run() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --quiet --no-psqlrc "$@"; }
psql_value() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --no-psqlrc -Atc "$1"; }

# Redacted form for logs — never print the password.
SAFE_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#')"

if ! psql_value 'SELECT 1' >/dev/null 2>&1; then
    echo "error: cannot connect to $SAFE_URL" >&2
    echo "hint: docker compose -f db/docker-compose.yml up -d" >&2
    exit 1
fi

echo "database: $SAFE_URL"
echo "postgres: $(psql_value 'SHOW server_version')"

checksum_of() {
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        sha256sum "$1" | cut -d' ' -f1
    fi
}

# --- reset ------------------------------------------------------------------

if [[ "$DO_RESET" == true ]]; then
    if [[ "$ASSUME_YES" != true ]]; then
        echo
        echo "WARNING: this DROPS every table, view, type and row created by db/migrations/."
        echo "         Target: $SAFE_URL"
        read -r -p "Type 'reset' to continue: " confirm
        [[ "$confirm" == "reset" ]] || { echo "aborted."; exit 1; }
    fi
    echo "--> reset.sql"
    psql_run --single-transaction -f "$RESET_FILE"
fi

# --- bookkeeping ------------------------------------------------------------

psql_run -c "
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);"

shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob
if [[ ${#migrations[@]} -eq 0 ]]; then
    echo "error: no .sql files in $MIGRATIONS_DIR" >&2
    exit 1
fi

is_applied() {
    local applied
    applied="$(psql_value "SELECT checksum FROM schema_migrations WHERE filename = '$1'")"
    printf '%s' "$applied"
}

# --- status -----------------------------------------------------------------

if [[ "$STATUS_ONLY" == true ]]; then
    echo
    printf '%-10s %s\n' "STATE" "MIGRATION"
    for file in "${migrations[@]}"; do
        name="$(basename "$file")"
        recorded="$(is_applied "$name")"
        if [[ -z "$recorded" ]]; then
            printf '%-10s %s\n' "pending" "$name"
        elif [[ "$recorded" != "$(checksum_of "$file")" ]]; then
            printf '%-10s %s  (file changed since it was applied)\n' "MODIFIED" "$name"
        else
            printf '%-10s %s\n' "applied" "$name"
        fi
    done
    exit 0
fi

# --- apply ------------------------------------------------------------------

applied_count=0
for file in "${migrations[@]}"; do
    name="$(basename "$file")"
    sum="$(checksum_of "$file")"
    recorded="$(is_applied "$name")"

    if [[ -n "$recorded" ]]; then
        if [[ "$recorded" != "$sum" ]]; then
            echo "!!  $name already applied but the file has changed."
            echo "    Add a new migration instead of editing this one (or use --reset locally)."
        else
            echo "==  $name (already applied)"
        fi
        continue
    fi

    echo "--> $name"
    psql_run --single-transaction \
        -f "$file" \
        -c "INSERT INTO schema_migrations (filename, checksum) VALUES ('$name', '$sum');"
    applied_count=$((applied_count + 1))
done

echo "applied $applied_count new migration(s)."

# --- seeds ------------------------------------------------------------------

if [[ "$RUN_SEEDS" == true ]]; then
    shopt -s nullglob
    seeds=("$SEEDS_DIR"/*.sql)
    shopt -u nullglob
    # Seeds are idempotent (ON CONFLICT DO NOTHING) and re-run on every --seed.
    for file in "${seeds[@]}"; do
        echo "--> seed $(basename "$file")"
        psql_run --single-transaction -f "$file"
    done
fi

echo
echo "tables:"
psql_value "SELECT '  ' || table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name"
