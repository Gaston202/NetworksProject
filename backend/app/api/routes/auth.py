"""Registration, login, and current-user endpoints (ADR-0006)."""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.api.deps import get_current_user, require_role
from app.core.security import create_access_token, hash_password, verify_password
from app.db.mongo import date_to_dt, get_db, next_id, strip_id, utcnow
from app.domain import UserRole
from app.schemas import (
    LoginIn,
    PasswordChangeIn,
    ProfileOut,
    ProfileUpdateIn,
    RegisterIn,
    StaffCreateIn,
    TokenOut,
    UserOut,
)

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


async def _profile_out(db: AsyncIOMotorDatabase, user: dict) -> ProfileOut:
    data = strip_id(user)
    if user["role"] == UserRole.PATIENT.value:
        profile = await db["patient_profiles"].find_one({"user_id": user["_id"]}) or {}
        data.update(phone=profile.get("phone"), address=profile.get("address"),
                    date_of_birth=profile.get("date_of_birth"))
    elif user["role"] == UserRole.DOCTOR.value:
        profile = await db["doctor_profiles"].find_one({"user_id": user["_id"]}) or {}
        department = (await db["departments"].find_one({"_id": profile["department_id"]})
                      if profile.get("department_id") is not None else None)
        data.update(specialty=profile.get("specialty"),
                    department_name=department["name"] if department else None)
    return ProfileOut(**data)


@router.get("/me/profile", response_model=ProfileOut)
async def my_profile(db: AsyncIOMotorDatabase = Depends(get_db),
                     user: dict = Depends(get_current_user)) -> ProfileOut:
    return await _profile_out(db, user)


@router.patch("/me", response_model=ProfileOut)
async def update_my_profile(payload: ProfileUpdateIn,
                            db: AsyncIOMotorDatabase = Depends(get_db),
                            user: dict = Depends(get_current_user)) -> ProfileOut:
    """Self-service edit: name for everyone; phone/address for patients (the
    only role with a contact record). Only fields present in the body change."""
    changes = payload.model_dump(exclude_unset=True)
    contact = {key: changes.pop(key) for key in ("phone", "address") if key in changes}
    if contact and user["role"] != UserRole.PATIENT.value:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Only patient accounts have phone and address")
    if changes.get("full_name") is not None:
        await db["users"].update_one(
            {"_id": user["_id"]}, {"$set": {"full_name": changes["full_name"].strip()}})
    if contact:
        await db["patient_profiles"].update_one({"user_id": user["_id"]}, {"$set": contact})
    return await _profile_out(db, await db["users"].find_one({"_id": user["_id"]}))


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_my_password(payload: PasswordChangeIn,
                             db: AsyncIOMotorDatabase = Depends(get_db),
                             user: dict = Depends(get_current_user)) -> None:
    """Requires the current password, so a stolen token alone can't take over
    the account. Existing tokens stay valid until they expire (stateless JWT)."""
    if not await run_in_threadpool(
            verify_password, payload.current_password, user["password_hash"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if payload.new_password == payload.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "New password must differ from the current one")
    password_hash = await run_in_threadpool(hash_password, payload.new_password)
    await db["users"].update_one(
        {"_id": user["_id"]}, {"$set": {"password_hash": password_hash}})


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