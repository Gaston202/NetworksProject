"""Pydantic request/response schemas. Per-module schemas will grow here."""
from datetime import date as date_t, datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.user import UserRole


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
    role: str  # admin | doctor | nurse | pharmacist
    department_id: int | None = None
    specialty: str | None = None


# --- Health (Week 1 exit criterion) ---

class HealthOut(BaseModel):
    status: str
    service: str
    version: str