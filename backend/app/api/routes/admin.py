"""Admin management: users and patients directory (ADR-0007).

Staff account creation is `POST /auth/staff` (auth module); this module adds
listing, updating, and deactivating accounts, plus the patients list used for
walk-in booking.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.base import get_db
from app.models import PatientProfile, User, UserRole
from app.schemas import PatientOut, UserOut, UserUpdateIn

router = APIRouter()


@router.get("/users", response_model=list[UserOut], tags=["admin"])
def list_users(role: str | None = Query(default=None),
               active: bool | None = Query(default=None),
               db: Session = Depends(get_db),
               _admin: User = Depends(require_role(UserRole.ADMIN))):
    query = db.query(User)
    if role is not None:
        try:
            query = query.filter(User.role == UserRole(role).value)
        except ValueError:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown role") from None
    if active is not None:
        query = query.filter(User.is_active == active)
    return query.order_by(User.created_at).all()


@router.patch("/users/{user_id}", response_model=UserOut, tags=["admin"])
def update_user(user_id: int, payload: UserUpdateIn,
                db: Session = Depends(get_db),
                _admin: User = Depends(require_role(UserRole.ADMIN))):
    """Rename a user, move a doctor between departments, update a specialty, or
    (de)activate the account. `department_id`/`specialty` apply to doctors only
    and are rejected otherwise."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    if payload.department_id is not None or payload.specialty is not None:
        if user.role != UserRole.DOCTOR.value:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "department_id/specialty apply to doctor accounts only")
    if payload.department_id is not None:
        if user.doctor_profile is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Doctor account has no doctor profile")
        user.doctor_profile.department_id = payload.department_id
    if payload.specialty is not None:
        user.doctor_profile.specialty = payload.specialty
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.is_active is not None:
        user.is_active = payload.is_active
    db.commit()
    db.refresh(user)
    return user


@router.get("/patients", response_model=list[PatientOut], tags=["admin"])
def list_patients(db: Session = Depends(get_db),
                  _admin: User = Depends(require_role(UserRole.ADMIN))):
    """Patients directory: the walk-in booking target list (`patient_id` in
    `POST /appointments`)."""
    profiles = db.query(PatientProfile).join(
        User, User.id == PatientProfile.user_id
    ).order_by(User.full_name).all()
    return [
        PatientOut(
            id=profile.id,
            full_name=profile.user.full_name,
            email=profile.user.email,
            phone=profile.phone,
            date_of_birth=profile.date_of_birth,
        )
        for profile in profiles
    ]