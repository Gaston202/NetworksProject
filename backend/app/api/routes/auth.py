"""Registration, login, and current-user endpoints (ADR-0006)."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.core.security import create_access_token, hash_password, verify_password
from app.db.base import get_db
from app.models import DoctorProfile, PatientProfile, User, UserRole
from app.schemas import LoginIn, RegisterIn, StaffCreateIn, TokenOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterIn, db: Session = Depends(get_db)) -> TokenOut:
    """Public self-registration. Always creates a Patient account (ADR-0007)."""
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(
        full_name=payload.full_name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=UserRole.PATIENT.value,
    )
    user.patient_profile = PatientProfile(
        date_of_birth=payload.date_of_birth,
        phone=payload.phone,
        address=payload.address,
    )
    db.add(user)
    db.commit()
    return _token_for(user)


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)) -> TokenOut:
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return _token_for(user)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.post(
    "/staff",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)
def create_staff(payload: StaffCreateIn, db: Session = Depends(get_db)) -> User:
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
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(
        full_name=payload.full_name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=role.value,
    )
    if role == UserRole.DOCTOR:
        user.doctor_profile = DoctorProfile(
            department_id=payload.department_id, specialty=payload.specialty
        )
    db.add(user)
    db.commit()
    return user


def _token_for(user: User) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(user.id, user.role),
        role=user.role,
        full_name=user.full_name,
    )