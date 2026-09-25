"""Availability slots and appointments (ADR-0009)."""
from datetime import datetime
from enum import Enum as StdEnum
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import DoctorProfile
    from app.models.clinical import Consultation, Vitals
    from app.models.billing import Invoice


class AppointmentStatus(str, StdEnum):
    BOOKED = "booked"
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
    # ADR-0009 invariant 1: one appointment per slot, enforced at the DB level.
    __table_args__ = (UniqueConstraint("slot_id", name="uq_appointments_slot"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    slot_id: Mapped[int] = mapped_column(ForeignKey("availability_slots.id"), unique=True)
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
    vitals: Mapped["Vitals | None"] = relationship(back_populates="appointment", uselist=False)
    invoice: Mapped["Invoice | None"] = relationship(back_populates="appointment", uselist=False)