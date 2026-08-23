#!/usr/bin/env python3
"""Applies db/migrations/*.sql without psql — the runner for Supabase and Windows.

db/migrate.sh is still the reference implementation. This is the same contract
(filename order, once each, sha256 recorded in schema_migrations, one transaction
per migration) for the two environments where psql is not a reasonable ask:

  * Supabase, where there is no local server to install client tools next to;
  * Windows, where libpq is not on PATH unless someone deliberately put it there.

Both runners share the schema_migrations table and hash the same bytes, so a
schema half-applied by one is finished correctly by the other.

    python db/migrate.py --status
    python db/migrate.py --seed
    python db/migrate.py --bundle > schema.sql     # for the Supabase SQL editor

Connection comes from DATABASE_URL: exported env var first, then db/.env, then
../.env — the resolution order db/migrate.sh uses.

Needs one Postgres driver, either of two: pip install "psycopg[binary]", or the
asyncpg already in requirements.txt, which is used as a fallback.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from pathlib import Path

DB_DIR = Path(__file__).resolve().parent
MIGRATIONS_DIR = DB_DIR / "migrations"
SEEDS_DIR = DB_DIR / "seeds"
RESET_FILE = DB_DIR / "reset.sql"

DEFAULT_URL = "postgresql://incident:incident@localhost:5432/incident_response"

BOOKKEEPING = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


# --- connection string ------------------------------------------------------


def _parse_env_file(path: Path) -> dict[str, str]:
    """Just enough .env: KEY=VALUE, optional `export`, # comments, quoted values."""
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        line = re.sub(r"^export\s+", "", line)
        key, sep, value = line.partition("=")
        if not sep:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def resolve_database_url() -> str:
    exported = os.environ.get("DATABASE_URL")
    if exported:
        return exported
    # First file that exists wins, matching migrate.sh's `break`.
    for candidate in (DB_DIR / ".env", DB_DIR.parent / ".env"):
        if candidate.is_file():
            url = _parse_env_file(candidate).get("DATABASE_URL")
            if url:
                return url
            break
    return DEFAULT_URL


def redact(url: str) -> str:
    """Never print the password: this runs in CI logs and over people's shoulders."""
    return re.sub(r"(://[^:/@]+):[^@]*@", r"\1:***@", url)


# --- drivers ----------------------------------------------------------------
#
# Every statement here is DDL with no parameters, which both drivers send over
# the simple query protocol — the one that accepts a multi-statement script.
# Prepared statements are switched off so the Supabase transaction pooler
# (port 6543) works as well as a direct or session-pooler connection.
#
# Both connects are bounded. The most common Supabase misconfiguration — taking
# the direct connection string on an IPv4-only network — does not refuse the
# connection, it black-holes it, and a migrator that hangs forever with no output
# is the least diagnosable failure this script could have.
CONNECT_TIMEOUT = 15


class Psycopg:
    name = "psycopg"

    def __init__(self, url: str) -> None:
        import psycopg

        self._conn = psycopg.connect(
            url, autocommit=True, prepare_threshold=None, connect_timeout=CONNECT_TIMEOUT
        )

    def execute(self, sql: str) -> None:
        self._conn.execute(sql)

    def scalar(self, sql: str):
        row = self._conn.execute(sql).fetchone()
        return None if row is None else row[0]

    def rows(self, sql: str) -> list[tuple]:
        return self._conn.execute(sql).fetchall()

    def transaction(self):
        return self._conn.transaction()

    def close(self) -> None:
        self._conn.close()


class Asyncpg:
    """asyncpg driven synchronously — one event loop for the whole run."""

    name = "asyncpg"

    def __init__(self, url: str) -> None:
        import asyncio

        import asyncpg

        self._loop = asyncio.new_event_loop()
        # asyncpg accepts postgres:// and postgresql://, but not the bare
        # `postgres` scheme some dashboards hand out.
        dsn = re.sub(r"^postgres://", "postgresql://", url)
        self._conn = self._run(
            asyncpg.connect(dsn, statement_cache_size=0, timeout=CONNECT_TIMEOUT)
        )

    def _run(self, coro):
        return self._loop.run_until_complete(coro)

    def execute(self, sql: str) -> None:
        self._run(self._conn.execute(sql))

    def scalar(self, sql: str):
        return self._run(self._conn.fetchval(sql))

    def rows(self, sql: str) -> list[tuple]:
        return [tuple(r.values()) for r in self._run(self._conn.fetch(sql))]

    def transaction(self):
        outer = self

        class _Tx:
            def __enter__(self):
                self._tx = outer._conn.transaction()
                outer._run(self._tx.start())
                return self

            def __exit__(self, exc_type, exc, tb):
                if exc_type is None:
                    outer._run(self._tx.commit())
                else:
                    outer._run(self._tx.rollback())
                return False

        return _Tx()

    def close(self) -> None:
        self._run(self._conn.close())
        self._loop.close()


def connect(url: str):
    missing = []
    for driver in (Psycopg, Asyncpg):
        try:
            return driver(url)
        except ImportError as exc:
            missing.append("  {}: not installed ({})".format(driver.name, exc))
        except Exception as exc:  # a real connection failure — do not mask it
            raise SystemExit(
                "error: cannot connect to {}\n"
                "       {}: {}\n"
                "hint: on Supabase use Project Settings > Database > Connection string\n"
                "      and prefer the SESSION POOLER - the direct connection is IPv6-only on\n"
                "      most projects, so it times out instead of failing. The password is the\n"
                "      database password, not the anon or service_role key. See db/SUPABASE.md."
                .format(redact(url), driver.name, exc)
            ) from exc
    raise SystemExit(
        "error: no Postgres driver available.\n"
        + "\n".join(missing)
        + '\nfix:  pip install "psycopg[binary]"'
    )


# --- helpers ----------------------------------------------------------------


def checksum_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sql_files(directory: Path) -> list[Path]:
    return sorted(directory.glob("*.sql"))


def quote(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def bundle() -> str:
    """Every migration, in order, as one script to paste into the SQL editor."""
    header = [
        "-- Generated by `python db/migrate.py --bundle`. Edit db/migrations/, not this.",
        "-- Records its own schema_migrations rows, so the migrator agrees with it",
        "-- afterwards instead of trying to replay everything.",
        "",
        BOOKKEEPING.strip(),
    ]
    parts = list(header)
    for path in sql_files(MIGRATIONS_DIR) + [SEEDS_DIR / "001_agents.sql"]:
        parts += [
            "",
            "-- " + "=" * 74,
            "-- {}/{}".format(path.parent.name, path.name),
            "-- " + "=" * 74,
            "",
            path.read_text(encoding="utf-8").rstrip(),
        ]
        if path.parent.name == "migrations":
            parts.append(
                "INSERT INTO schema_migrations (filename, checksum) VALUES ({}, {}) "
                "ON CONFLICT (filename) DO NOTHING;".format(quote(path.name), quote(checksum_of(path)))
            )
    return "\n".join(parts) + "\n"


# --- main -------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--status", action="store_true",
                        help="report applied / pending / modified, then exit")
    parser.add_argument("--seed", nargs="?", const="*", metavar="GLOB",
                        help="after migrating, run db/seeds/GLOB.sql (default: all of them)")
    parser.add_argument("--reset", action="store_true",
                        help="DESTRUCTIVE: drop everything, then replay from 001")
    parser.add_argument("-y", "--yes", action="store_true", help="skip the --reset confirmation")
    parser.add_argument("--bundle", action="store_true",
                        help="print the whole schema as one script and exit (no connection needed)")
    args = parser.parse_args()

    if args.bundle:
        sys.stdout.write(bundle())
        return 0

    migrations = sql_files(MIGRATIONS_DIR)
    if not migrations:
        raise SystemExit("error: no .sql files in {}".format(MIGRATIONS_DIR))

    url = resolve_database_url()
    db = connect(url)
    try:
        print("database: {}".format(redact(url)))
        print("postgres: {}  (via {})".format(db.scalar("SHOW server_version"), db.name))

        if args.reset:
            if not args.yes:
                print("\nWARNING: this DROPS every table, view, type and row created by db/migrations/.")
                print("         Target: {}".format(redact(url)))
                if input("Type 'reset' to continue: ").strip() != "reset":
                    print("aborted.")
                    return 1
            print("--> reset.sql")
            with db.transaction():
                db.execute(RESET_FILE.read_text(encoding="utf-8"))

        db.execute(BOOKKEEPING)
        applied = dict(db.rows("SELECT filename, checksum FROM schema_migrations"))

        if args.status:
            print("\n{:<10} {}".format("STATE", "MIGRATION"))
            for path in migrations:
                recorded = applied.get(path.name)
                if recorded is None:
                    print("{:<10} {}".format("pending", path.name))
                elif recorded != checksum_of(path):
                    print("{:<10} {}  (file changed since it was applied)".format("MODIFIED", path.name))
                else:
                    print("{:<10} {}".format("applied", path.name))
            return 0

        count = 0
        for path in migrations:
            recorded = applied.get(path.name)
            if recorded is not None:
                if recorded != checksum_of(path):
                    print("!!  {} already applied but the file has changed.".format(path.name))
                    print("    Add a new migration instead of editing this one (or use --reset locally).")
                else:
                    print("==  {} (already applied)".format(path.name))
                continue

            print("--> {}".format(path.name))
            # The migration and its bookkeeping row commit together, so a failure
            # applies nothing and the next run retries it from scratch.
            with db.transaction():
                db.execute(path.read_text(encoding="utf-8"))
                db.execute(
                    "INSERT INTO schema_migrations (filename, checksum) VALUES ({}, {})"
                    .format(quote(path.name), quote(checksum_of(path)))
                )
            count += 1

        print("applied {} new migration(s).".format(count))

        if args.seed:
            seeds = sorted(SEEDS_DIR.glob("{}.sql".format(args.seed)))
            if not seeds:
                print("!!  no seeds matched db/seeds/{}.sql".format(args.seed))
            for path in seeds:
                print("--> seed {}".format(path.name))
                with db.transaction():
                    db.execute(path.read_text(encoding="utf-8"))

        print("\ntables:")
        for (name,) in db.rows(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
        ):
            print("  {}".format(name))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
