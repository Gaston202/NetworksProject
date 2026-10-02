"""Reset helper: drop every collection (Atlas M0 readWrite users may not
dropDatabase), then re-seed with `python -m app.seed`.

Run:  .venv/Scripts/python scripts/reset_demo.py   (from the backend/ directory)
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from app.db.mongo import client, db  # noqa: E402


async def reset():
    for name in await db.list_collection_names():
        await db[name].drop()
        print("dropped", name)


asyncio.run(reset())
client.close()