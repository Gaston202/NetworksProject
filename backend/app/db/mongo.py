"""MongoDB wiring (MongoDB Atlas via Motor — spec §3/§5).

A module-scoped pooled client outlives requests; `get_db` yields the same
database handle to every handler. Integer ids are minted from the `counters`
collection so API paths, schemas, and the frontend keep working unchanged.
"""
from collections.abc import AsyncGenerator
from datetime import date, datetime, time, timezone

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ReturnDocument

from app.core.config import settings

# Bounded server selection so an unreachable Atlas surfaces in ~10 s
# (/health -> 503) instead of hanging the request for the 30 s default.
client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=10_000)
db: AsyncIOMotorDatabase = client[settings.mongodb_db]


async def get_db() -> AsyncGenerator[AsyncIOMotorDatabase, None]:
    """Yield the module-scoped database handle to an async handler."""
    yield db


async def reserve_ids(collection: str, count: int) -> list[int]:
    """Reserve `count` ids for `collection` with one atomic $inc on counters.

    E.g. reserve 10 -> [41, 42, ..., 50]; callers assign them sequentially.
    """
    counter = await db["counters"].find_one_and_update(
        {"_id": collection},
        {"$inc": {"n": count}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    # `n` is the highest id ever issued for this collection: the first-ever
    # reserve yields [1, 2] (matching the API's one-based demo ids), then
    # consecutive reserves continue the sequence.
    first = counter["n"] - count + 1
    return list(range(first, first + count))


async def next_id(collection: str) -> int:
    return (await reserve_ids(collection, 1))[0]


def strip_id(doc: dict) -> dict:
    """Rename Mongo's `_id` to the API contract's `id`, keeping field order."""
    return {"id": doc["_id"], **{k: v for k, v in doc.items() if k != "_id"}}


def utcnow() -> datetime:
    """Application-generated naive-UTC clock (matches today's serialization)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def date_to_dt(value: date | None) -> datetime | None:
    """Store a user-supplied `date` as UTC midnight (pymongo can't encode date)."""
    if value is None:
        return None
    return datetime.combine(value, time.min)