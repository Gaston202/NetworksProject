"""Pydantic request/response schemas. Per-module schemas will grow here."""
from datetime import date as date_t, datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field

from app.core.security import BCRYPT_MAX_BYTES


def _within_bcrypt_limit(password: str) -> str:
    """Characters aren't bytes: 'é' counts 2, so measure the UTF-8 encoding."""
    if len(password.encode("utf-8")) > BCRYPT_MAX_BYTES:
        raise ValueError(f"Password must be at most {BCRYPT_MAX_BYTES} bytes")
    return password


NewPassword = Annotated[str, Field(min_length=8, max_length=128),
                        AfterValidator(_within_bcrypt_limit)]


# --- Auth (ADR-0006) ---

class RegisterIn(BaseModel):
    """Public registration — always creates a Patient (ADR-0007)."""
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: NewPassword
    date_of_birth: date_t | None = None
    phone: str | None = None
    address: str | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    full_name: str


class UserOut(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}


class StaffCreateIn(BaseModel):
    """Admin-only staff account creation."""
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: NewPassword
    role: str  # admin | doctor
    department_id: int | None = None
    specialty: str | None = None


# --- Self-service profile (any signed-in user) ---

def _blank_to_none(value: str | None) -> str | None:
    """An empty field clears the stored value."""
    if value is None:
        return None
    value = value.strip()
    return value or None


Phone = Annotated[str | None, Field(default=None, max_length=32,
                                    pattern=r"^[0-9+()\-\s]*$"),
                  AfterValidator(_blank_to_none)]
Address = Annotated[str | None, Field(default=None, max_length=200),
                    AfterValidator(_blank_to_none)]


class ProfileUpdateIn(BaseModel):
    """What a user may change about themselves. Email, role, department and
    activation stay admin-controlled; unknown fields are rejected (422) so a
    smuggled `role` can never be silently accepted."""
    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: Phone = None      # patients only
    address: Address = None  # patients only


class PasswordChangeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(max_length=128)
    new_password: NewPassword


class ProfileOut(BaseModel):
    """The signed-in user's own account + role-specific details."""
    id: int
    full_name: str
    email: EmailStr
    role: str
    created_at: datetime
    # Patients
    phone: str | None = None
    address: str | None = None
    date_of_birth: datetime | None = None
    # Doctors
    department_name: str | None = None
    specialty: str | None = None


# --- Scheduling: departments, doctors, slots, appointments (ADR-0009) ---

class DepartmentCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class DepartmentRenameIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class DepartmentOut(BaseModel):
    id: int
    name: str


class DoctorOut(BaseModel):
    """`id` is the doctor_profile id (used in slot/appointment paths)."""
    id: int
    full_name: str
    email: EmailStr
    department_id: int | None
    department_name: str | None = None
    specialty: str | None


class SlotBulkIn(BaseModel):
    """Bulk window creation (ADR-0009): split one daily window into slots."""
    first_date: date_t
    days: int = Field(default=1, ge=1, le=60)
    start_hour: int = Field(ge=0, le=23)
    start_minute: int = Field(default=0, ge=0, le=59)
    hours_per_day: float = Field(gt=0, le=12)
    slot_minutes: int = Field(default=30, ge=10, le=120)


class SlotOut(BaseModel):
    id: int
    doctor_id: int
    starts_at: datetime
    ends_at: datetime
    is_free: bool

    model_config = {"from_attributes": True}


class AppointmentCreateIn(BaseModel):
    slot_id: int
    # Admin-only: book a walk-in for a specific patient (ADR-0007).
    patient_id: int | None = None


class AppointmentOut(BaseModel):
    id: int
    slot_id: int
    patient_id: int
    doctor_id: int
    status: str
    starts_at: datetime
    ends_at: datetime
    created_at: datetime
    # Display names, resolved per response (app/api/display.py).
    patient_name: str | None = None
    doctor_name: str | None = None
    department_name: str | None = None


class AppointmentDetailOut(AppointmentOut):
    consultation: "ConsultationOut | None" = None
    invoice: "InvoiceOut | None" = None


# --- Clinical (ADR-0010) ---

class ConsultationCreateIn(BaseModel):
    diagnosis: str = Field(min_length=1)
    notes: str | None = None
    prescription: str | None = None


class ConsultationOut(BaseModel):
    id: int
    appointment_id: int
    diagnosis: str
    notes: str | None
    prescription: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Billing (ADR-0012) ---

class InvoiceOut(BaseModel):
    id: int
    appointment_id: int
    total: float
    status: str
    created_at: datetime
    # The visit this invoice bills, for display (app/api/display.py).
    patient_name: str | None = None
    doctor_name: str | None = None
    department_name: str | None = None
    visit_starts_at: datetime | None = None

    model_config = {"from_attributes": True}


# --- Admin management (ADR-0007) ---

class UserUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    department_id: int | None = None   # doctors only; ignored otherwise
    specialty: str | None = None       # doctors only; ignored otherwise
    is_active: bool | None = None


class PatientOut(BaseModel):
    """`id` is the patient_profile id (walk-in booking targets it)."""
    id: int
    full_name: str
    email: EmailStr
    phone: str | None
    date_of_birth: date_t | None

    model_config = {"from_attributes": True}


# --- Health (Week 1 exit criterion) ---

class HealthOut(BaseModel):
    status: str
    service: str
    version: str


# Forward references in AppointmentDetailOut are defined later in this module.
AppointmentDetailOut.model_rebuild()