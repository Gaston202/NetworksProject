"""Shared FastAPI dependencies: DB handle, current user, role guards (ADR-0006/0007)."""
from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import decode_access_token
from app.db.mongo import get_db
from app.domain import UserRole

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = await db["users"].find_one({"_id": int(payload["sub"])})
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    if not user["is_active"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is deactivated")
    return user


def require_role(*allowed: UserRole) -> Callable:
    """Dependency factory: endpoint runs only for users with one of `allowed` roles.

    Usage: admin = Depends(require_role(UserRole.ADMIN))  # admin is a dict
    """
    allowed_set = {r.value for r in allowed}

    def guard(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in allowed_set:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Requires one of: {', '.join(sorted(allowed_set))}",
            )
        return user

    return guard