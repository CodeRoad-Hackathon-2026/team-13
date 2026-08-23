"""The service catalogue.

Exists because the dashboard's service filter has to offer real `services.id`
values: the list endpoint compares the chosen one against a UUID column, so a
name or a slug cannot stand in for it.
"""

from __future__ import annotations

from typing import Any

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import connection
from app.queries import services as q

router = APIRouter(tags=["services"])


@router.get("/services")
async def list_services(conn: asyncpg.Connection = Depends(connection)) -> dict[str, Any]:
    rows = await conn.fetch(q.LIST)
    return {"services": [{"id": str(r["id"]), "name": r["name"]} for r in rows]}
