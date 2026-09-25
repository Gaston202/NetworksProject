"""Clinical records: consultations (doctor) and vitals (nurse) — ADR-0010."""
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.scheduling import Appointment
    from app.models.pharmacy import PrescriptionItem


class Consultation(Base):
    __tablename__ = "consultations"
    __table_args__ = (UniqueConstraint("appointment_id", name="uq_consultations_appointment"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_id: Mapped[int] = mapped_column(
        ForeignKey("appointments.id"), unique=True, index=True
    )
    diagnosis: Mapped[str] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    appointment: Mapped["Appointment"] = relationship(back_populates="consultation")
    prescription_items: Mapped[list["PrescriptionItem"]] = relationship(
        back_populates="consultation"
    )


class Vitals(Base):
    __tablename__ = "vitals"
    __table_args__ = (UniqueConstraint("appointment_id", name="uq_vitals_appointment"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_id: Mapped[int] = mapped_column(
        ForeignKey("appointments.id"), unique=True, index=True
    )
    blood_pressure: Mapped[str | None] = mapped_column(String(10))  # "120/80"
    temperature_c: Mapped[float | None]
    pulse_bpm: Mapped[int | None]
    weight_kg: Mapped[float | None]
    recorded_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    appointment: Mapped["Appointment"] = relationship(back_populates="vitals")