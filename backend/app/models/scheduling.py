"""Availability slots and appointments (ADR-0009)."""
from datetime import datetime
from enum import Enum as StdEnum
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import DoctorProfile
    from app.models.clinical import Consultation
    from app.models.billing import Invoice


class AppointmentStatus(str, StdEnum):
    BOOKED = "booked"
    CONSULTED = "consulted"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class AvailabilitySlot(Base):
    __tablename__ = "availability_slots"

    id: Mapped[int] = mapped_column(primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctor_profiles.id"), index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime)

    doctor: Mapped["DoctorProfile"] = relationship(back_populates="slots")
    appointment: Mapped["Appointment | None"] = relationship(
        back_populates="slot", uselist=False, cascade="all, delete-orphan"
    )


class Appointment(Base):
    __tablename__ = "appointments"
    # ADR-0009 invariant 1: at most one *active* appointment per slot (DB level).
    # A cancelled appointment releases its slot, so uniqueness holds only while
    # the status is not 'cancelled' — a partial unique index works on both
    # SQLite and PostgreSQL.
    __table_args__ = (
        Index(
            "uq_appointments_active_slot",
            "slot_id",
            unique=True,
            sqlite_where=text("status <> 'cancelled'"),
            postgresql_where=text("status <> 'cancelled'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    slot_id: Mapped[int] = mapped_column(ForeignKey("availability_slots.id"), index=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patient_profiles.id"), index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctor_profiles.id"), index=True)
    status: Mapped[str] = mapped_column(
        Enum(*[s.value for s in AppointmentStatus], name="appointment_status",
             native_enum=False, length=20),
        default=AppointmentStatus.BOOKED.value,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    slot: Mapped[AvailabilitySlot] = relationship(back_populates="appointment")
    consultation: Mapped["Consultation | None"] = relationship(
        back_populates="appointment", uselist=False
    )
    invoice: Mapped["Invoice | None"] = relationship(back_populates="appointment", uselist=False)