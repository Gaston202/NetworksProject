from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import PyMongoError

from app.db.mongo import get_db
from app.schemas import HealthOut

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthOut)
async def health(db: AsyncIOMotorDatabase = Depends(get_db)) -> HealthOut:
    """Liveness + Atlas reachability: 200 from http://192.168.100.10/api/health on a client."""
    try:
        await db.client.admin.command("ping")
    except PyMongoError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Database unreachable") from None
    return HealthOut(status="ok", service="hms-api", version="0.1.0")