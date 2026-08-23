"""Name -> id lookup against the `agents` table.

The registry is seeded by db/seeds/001_agents.sql. An agent whose name is not
there is a bug, not something to create on the fly: agent_runs.agent_id is
ON DELETE RESTRICT precisely so run history stays attributable to a known
agent, and silently inserting one would let a typo fork the history.
"""

from __future__ import annotations

import asyncpg

_cache: dict[str, str] = {}


class UnknownAgent(LookupError):
    def __init__(self, name: str) -> None:
        super().__init__(
            f"agent {name!r} is not in the registry — add it to db/seeds/001_agents.sql"
        )
        self.name = name


async def agent_id_for(conn: asyncpg.Connection, name: str) -> str:
    cached = _cache.get(name)
    if cached is not None:
        return cached

    row = await conn.fetchval("SELECT id FROM agents WHERE name = $1 AND is_active", name)
    if row is None:
        raise UnknownAgent(name)

    _cache[name] = str(row)
    return str(row)


def reset_cache() -> None:
    """Only for tests — the registry does not change while the service runs."""
    _cache.clear()
