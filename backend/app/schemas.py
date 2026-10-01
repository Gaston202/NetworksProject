"""Pydantic request/response schemas. Per-module schemas will grow here."""
from datetime import date as date_t, datetime

from pydantic import BaseModel, EmailStr, Field


# --- Auth (ADR-0006) ---

class RegisterIn(BaseModel):
    """Public registration — always creates a Patient (ADR-0007)."""
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
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
    password: str = Field(min_length=8, max_length=128)
    role: str  # admin | doctor
    department_id: int | None = None
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