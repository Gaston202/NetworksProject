from fastapi import APIRouter

from app.schemas import HealthOut

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    """Week 1 exit criterion: 200 from http://10.0.2.10:8000/api/health across the VMs."""
    return HealthOut(status="ok", service="hms-api", version="0.1.0")