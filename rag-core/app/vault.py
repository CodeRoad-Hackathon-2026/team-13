"""Encrypted secret vault for connector credentials.

Connector tokens have to come from somewhere. Two mechanisms exist, and they
resolve in this order:

1. **The vault** — a token pasted into the UI, encrypted with AES-256-GCM under
   ``SECRETS_KEY`` and stored in Postgres. Adding a Slack source becomes a form,
   not an ``.env`` edit plus a worker restart.
2. **The worker environment** — the original ``${VAR}`` mechanism, kept intact
   so existing source configs keep working and so a deployment that would rather
   inject secrets through its orchestrator still can.

Both are referenced with the same ``${NAME}`` syntax in a source config. The
vault wins, which is what makes "paste it in the UI" work without rewriting
configs that already name an environment variable.

What the vault deliberately does not do: hand a secret back. There is no
endpoint that decrypts to a caller. ``hint`` (the last four characters) is what
makes a token identifiable in a list, and it is the only part ever returned.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
from typing import Any, Iterable, Mapping

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from app.config import settings
from app.db import get_pool

logger = logging.getLogger(__name__)

NONCE_BYTES = 12  # AES-GCM standard; anything else costs performance for nothing.

# A fixed salt is acceptable only because it protects a single value that the
# operator generated, not a user-chosen password. Generate the key with
# `make secrets-key` and this branch never runs.
_KDF_SALT = b"rag-core/secrets/v1"


class VaultError(RuntimeError):
    """The vault is unusable: no key, wrong key, or corrupt ciphertext."""


def _key_material() -> bytes | None:
    # Read through settings, not os.environ: the key is normally set in .env,
    # which pydantic-settings loads but which never reaches the process env.
    raw = (settings.secrets_key or "").strip()
    if not raw:
        return None
    # The documented form: 32 bytes, urlsafe-base64.
    try:
        decoded = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        if len(decoded) == 32:
            return decoded
    except (ValueError, base64.binascii.Error):
        pass
    # Anything else is treated as a passphrase rather than failing the boot.
    # Weaker than a generated key, and said so in docs/setup.md.
    logger.warning(
        "SECRETS_KEY is not a 32-byte base64 key; deriving one from it. "
        "Generate a proper key with `make secrets-key`."
    )
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=_KDF_SALT, iterations=200_000)
    return kdf.derive(raw.encode())


def vault_enabled() -> bool:
    return _key_material() is not None


def _cipher() -> tuple[AESGCM, str]:
    key = _key_material()
    if key is None:
        raise VaultError(
            "SECRETS_KEY is not set, so secrets cannot be stored. Either set it "
            "(`make secrets-key`) or reference credentials as ${VAR} from the "
            "worker environment."
        )
    # Fingerprint, not the key: lets a row say which key encrypted it without
    # storing anything that helps decrypt it.
    key_id = hashlib.sha256(b"keyid" + key).hexdigest()[:12]
    return AESGCM(key), key_id


def encrypt(name: str, plaintext: str) -> tuple[bytes, bytes, str]:
    aes, key_id = _cipher()
    nonce = os.urandom(NONCE_BYTES)
    # The name is authenticated but not encrypted, so a ciphertext moved to a
    # different row fails to decrypt instead of silently becoming another token.
    ciphertext = aes.encrypt(nonce, plaintext.encode(), name.encode())
    return ciphertext, nonce, key_id


def decrypt(name: str, ciphertext: bytes, nonce: bytes, key_id: str) -> str:
    aes, current_key_id = _cipher()
    if key_id and key_id != current_key_id:
        raise VaultError(
            f"secret '{name}' was encrypted with a different SECRETS_KEY "
            f"(stored {key_id}, current {current_key_id}). Restore the previous "
            f"key or re-enter the secret."
        )
    try:
        return aes.decrypt(nonce, bytes(ciphertext), name.encode()).decode()
    except InvalidTag as exc:  # noqa: PERF203
        raise VaultError(
            f"secret '{name}' failed to decrypt — the key changed or the row is corrupt"
        ) from exc


def hint_of(plaintext: str) -> str:
    """The tail of a secret, which is how a human tells two tokens apart."""
    return plaintext[-4:] if len(plaintext) >= 8 else ""


class TrackingVault(dict):
    """A vault mapping that remembers which secrets were actually read.

    Used to keep ``last_used_at`` honest: a secret that no source references is
    then visibly stale in the UI, which is the signal for deleting it.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.used: set[str] = set()

    def __getitem__(self, key: str) -> str:
        value = super().__getitem__(key)
        self.used.add(key)
        return value


# ------------------------------------------------------------------ storage
async def put_secret(name: str, value: str, description: str | None = None) -> dict:
    ciphertext, nonce, key_id = encrypt(name, value)
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO secrets (name, description, ciphertext, nonce, hint, key_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (name) DO UPDATE SET
                description = COALESCE(EXCLUDED.description, secrets.description),
                ciphertext  = EXCLUDED.ciphertext,
                nonce       = EXCLUDED.nonce,
                hint        = EXCLUDED.hint,
                key_id      = EXCLUDED.key_id,
                updated_at  = now()
            RETURNING name, description, hint, created_at, updated_at, last_used_at
            """,
            name,
            description,
            ciphertext,
            nonce,
            hint_of(value),
            key_id,
        )
    return dict(row)


async def list_secrets() -> list[dict]:
    """Metadata only. There is no code path that returns a plaintext secret."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.name, s.description, s.hint, s.created_at, s.updated_at,
                   s.last_used_at,
                   COALESCE(u.used_by, ARRAY[]::TEXT[]) AS used_by
            FROM secrets s
            LEFT JOIN LATERAL (
                SELECT array_agg(DISTINCT src.name) AS used_by
                FROM sources src
                WHERE src.config::text LIKE '%${' || s.name || '}%'
            ) u ON true
            ORDER BY s.name
            """
        )
    return [dict(r) for r in rows]


async def delete_secret(name: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        deleted = await conn.fetchval(
            "DELETE FROM secrets WHERE name = $1 RETURNING name", name
        )
    return deleted is not None


async def load_vault() -> TrackingVault:
    """Decrypt every secret for a poll cycle.

    Loaded in one query rather than per-reference: a source config can name
    several secrets, and the alternative is a round trip inside the string
    substitution loop.

    A single undecryptable row does not fail the whole load — the source that
    actually references it fails with a clear ``MissingSecret`` instead, which
    keeps one bad row from stopping every other source.
    """
    if not vault_enabled():
        return TrackingVault()
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT name, ciphertext, nonce, key_id FROM secrets")
    vault = TrackingVault()
    for row in rows:
        try:
            vault[row["name"]] = decrypt(
                row["name"], row["ciphertext"], row["nonce"], row["key_id"]
            )
        except VaultError as exc:
            logger.error("skipping secret %s: %s", row["name"], exc)
    return vault


async def mark_used(names: Iterable[str]) -> None:
    names = list(names)
    if not names:
        return
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE secrets SET last_used_at = now() WHERE name = ANY($1::text[])", names
        )


def redact(config: Any, vault: Mapping[str, str] | None = None) -> Any:
    """Strip anything that looks like a live credential out of a config tree.

    ``GET /v1/sources`` returns configs so the UI can populate its edit form.
    A config *should* only ever hold ``${NAME}`` references, but nothing stops
    an API caller from POSTing a literal token, and returning it would leak it
    to every reader of the endpoint.
    """
    secret_values = set(vault.values()) if vault else set()
    if isinstance(config, str):
        return "••••••" if config and config in secret_values else config
    if isinstance(config, dict):
        return {
            k: ("••••••" if _looks_secret(k) and not _is_reference(v) else redact(v, vault))
            for k, v in config.items()
        }
    if isinstance(config, list):
        return [redact(v, vault) for v in config]
    return config


_SECRET_KEY_HINTS = ("token", "secret", "password", "api_key", "apikey", "credential")


def _looks_secret(key: str) -> bool:
    lowered = key.lower()
    return any(hint in lowered for hint in _SECRET_KEY_HINTS)


def _is_reference(value: Any) -> bool:
    """A ``${NAME}`` placeholder is safe to show — it names a secret, is not one."""
    return isinstance(value, str) and value.startswith("${") and value.endswith("}")
