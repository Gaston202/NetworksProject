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


# --- Transitional SQLAlchemy copies (removed when the SQLA stack is deleted) ---
# Only the not-yet-converted route modules (scheduling, clinical, billing) use
# these until Tasks 5-7 land.

from sqlalchemy.orm import Session  # noqa: E402

from app.db.base import get_db as get_db_sqla  # noqa: E402
from app.models import User  # noqa: E402


def get_current_user_sqla(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: Session = Depends(get_db_sqla),
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = session.get(User, int(payload["sub"]))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    if not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is deactivated")
    return user


def require_role_sqla(*allowed: UserRole) -> Callable:
    allowed_set = {r.value for r in allowed}

    def guard(user: User = Depends(get_current_user_sqla)) -> User:
        if user.role not in allowed_set:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Requires one of: {', '.join(sorted(allowed_set))}",
            )
        return user

    return guard