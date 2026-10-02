"""Registration, login, and current-user endpoints (ADR-0006)."""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.api.deps import get_current_user, require_role
from app.core.security import create_access_token, hash_password, verify_password
from app.db.mongo import date_to_dt, get_db, next_id, strip_id, utcnow
from app.domain import UserRole
from app.schemas import LoginIn, RegisterIn, StaffCreateIn, TokenOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterIn,
                   db: AsyncIOMotorDatabase = Depends(get_db)) -> TokenOut:
    """Public self-registration. Always creates a Patient account (ADR-0007)."""
    if await db["users"].find_one({"email": payload.email}):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    password_hash = await run_in_threadpool(hash_password, payload.password)
    user = {
        "_id": await next_id("users"),
        "full_name": payload.full_name,
        "email": payload.email,
        "password_hash": password_hash,
        "role": UserRole.PATIENT.value,
        "is_active": True,
        "created_at": utcnow(),
    }
    try:
        await db["users"].insert_one(user)
    except DuplicateKeyError:
        # Lost the email race - the pre-check above yields the same 409 first.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Email already registered") from None
    await db["patient_profiles"].insert_one({
        "_id": await next_id("patient_profiles"),
        "user_id": user["_id"],
        "date_of_birth": date_to_dt(payload.date_of_birth),
        "phone": payload.phone,
        "address": payload.address,
    })
    return _token_for(user)


@router.post("/login", response_model=TokenOut)
async def login(payload: LoginIn,
                db: AsyncIOMotorDatabase = Depends(get_db)) -> TokenOut:
    user = await db["users"].find_one({"email": payload.email})
    valid = user is not None and await run_in_threadpool(
        verify_password, payload.password, user["password_hash"])
    if not valid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    # Checked after the password so the message doesn't reveal which emails exist.
    if not user["is_active"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is deactivated")
    return _token_for(user)


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)) -> dict:
    return strip_id(user)


@router.post(
    "/staff",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)
async def create_staff(payload: StaffCreateIn,
                       db: AsyncIOMotorDatabase = Depends(get_db)) -> dict:
    """Admin creates staff accounts. Role must not be 'patient' (use /register)."""
    if payload.role == UserRole.PATIENT.value:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Use /auth/register for patients"
        )
    try:
        role = UserRole(payload.role)
    except ValueError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown role"
        ) from None
    if await db["users"].find_one({"email": payload.email}):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    password_hash = await run_in_threadpool(hash_password, payload.password)
    user = {
        "_id": await next_id("users"),
        "full_name": payload.full_name,
        "email": payload.email,
        "password_hash": password_hash,
        "role": role.value,
        "is_active": True,
        "created_at": utcnow(),
    }
    try:
        await db["users"].insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Email already registered") from None
    if role == UserRole.DOCTOR:
        await db["doctor_profiles"].insert_one({
            "_id": await next_id("doctor_profiles"),
            "user_id": user["_id"],
            "department_id": payload.department_id,
            "specialty": payload.specialty,
        })
    return strip_id(user)


def _token_for(user: dict) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(user["_id"], user["role"]),
        role=user["role"],
        full_name=user["full_name"],
    )