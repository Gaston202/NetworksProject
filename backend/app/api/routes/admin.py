"""Admin management: users and patients directory (ADR-0007).

Staff account creation is `POST /auth/staff` (auth module); this module adds
listing, updating, and deactivating accounts, plus the patients list used for
walk-in booking. Directory joins are two-query id-maps (spec §5.1) — rename-safe.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import require_role
from app.db.mongo import get_db, strip_id
from app.domain import UserRole
from app.schemas import PatientOut, UserOut, UserUpdateIn

router = APIRouter()


@router.get("/users", response_model=list[UserOut], tags=["admin"])
async def list_users(role: str | None = Query(default=None),
                     active: bool | None = Query(default=None),
                     db: AsyncIOMotorDatabase = Depends(get_db),
                     _admin: dict = Depends(require_role(UserRole.ADMIN))):
    query: dict = {}
    if role is not None:
        try:
            UserRole(role)
        except ValueError:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown role") from None
        query["role"] = role
    if active is not None:
        query["is_active"] = active
    return [
        strip_id(doc) async for doc in db["users"].find(query).sort("created_at", 1)
    ]


@router.patch("/users/{user_id}", response_model=UserOut, tags=["admin"])
async def update_user(user_id: int, payload: UserUpdateIn,
                      db: AsyncIOMotorDatabase = Depends(get_db),
                      _admin: dict = Depends(require_role(UserRole.ADMIN))):
    """Rename a user, move a doctor between departments, update a specialty, or
    (de)activate the account. `department_id`/`specialty` apply to doctors only
    and are rejected otherwise."""
    user = await db["users"].find_one({"_id": user_id})
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    profile_updates: dict = {}
    if payload.department_id is not None or payload.specialty is not None:
        if user["role"] != UserRole.DOCTOR.value:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "department_id/specialty apply to doctor accounts only")
        profile = await db["doctor_profiles"].find_one({"user_id": user_id})
        if profile is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Doctor account has no doctor profile")
        if payload.department_id is not None:
            profile_updates["department_id"] = payload.department_id
        if payload.specialty is not None:
            profile_updates["specialty"] = payload.specialty
    user_updates: dict = {}
    if payload.full_name is not None:
        user_updates["full_name"] = payload.full_name
    if payload.is_active is not None:
        user_updates["is_active"] = payload.is_active
    if profile_updates:
        await db["doctor_profiles"].update_one(
            {"user_id": user_id}, {"$set": profile_updates})
    if user_updates:
        await db["users"].update_one({"_id": user_id}, {"$set": user_updates})
    return strip_id(await db["users"].find_one({"_id": user_id}))


@router.get("/patients", response_model=list[PatientOut], tags=["admin"])
async def list_patients(db: AsyncIOMotorDatabase = Depends(get_db),
                        _admin: dict = Depends(require_role(UserRole.ADMIN))):
    """Patients directory: the walk-in booking target list (`patient_id` in
    `POST /appointments`). Sorted by full_name in memory — the join is two
    queries per spec §5.1, so renames flow through with no stale copies."""
    profiles = await db["patient_profiles"].find().to_list(length=None)
    user_ids = [profile["user_id"] for profile in profiles]
    by_id = {
        user["_id"]: user for user in
        (await db["users"].find({"_id": {"$in": user_ids}}).to_list(length=None))
    }
    patients = [
        PatientOut(
            id=profile["_id"],
            full_name=by_id[profile["user_id"]]["full_name"],
            email=by_id[profile["user_id"]]["email"],
            phone=profile.get("phone"),
            date_of_birth=profile.get("date_of_birth"),
        )
        for profile in profiles if profile["user_id"] in by_id
    ]
    patients.sort(key=lambda patient: patient.full_name)
    return patients