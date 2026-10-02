from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import PyMongoError

from app.db.mongo import get_db
from app.schemas import HealthOut

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthOut)
async def health(db: AsyncIOMotorDatabase = Depends(get_db)) -> HealthOut:
    """Week 1 exit criterion: 200 from http://10.0.2.10:8000/api/health across the VMs."""
    try:
        await db.client.admin.command("ping")
    except PyMongoError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Database unreachable") from None
    return HealthOut(status="ok", service="hms-api", version="0.1.0")