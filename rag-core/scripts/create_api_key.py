"""Issue an API key from the command line.

    python -m scripts.create_api_key "incident-agent" read write

The raw key is printed once and never stored — only its SHA-256 hash is.
"""

from __future__ import annotations

import asyncio
import sys

from app.db import close_pool, run_migrations
from app.security import create_api_key


async def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)
    name = sys.argv[1]
    scopes = sys.argv[2:] or ["read"]

    await run_migrations()
    raw, key_id = await create_api_key(name, scopes)
    print(f"id:     {key_id}")
    print(f"name:   {name}")
    print(f"scopes: {', '.join(scopes)}")
    print(f"key:    {raw}")
    print("\nStore it now — it cannot be recovered.")
    await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
