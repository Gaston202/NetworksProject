"""Clinical records: consultations written by the doctor — ADR-0010."""
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.scheduling import Appointment


class Consultation(Base):
    __tablename__ = "consultations"
    __table_args__ = (UniqueConstraint("appointment_id", name="uq_consultations_appointment"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_id: Mapped[int] = mapped_column(
        ForeignKey("appointments.id"), unique=True, index=True
    )
    diagnosis: Mapped[str] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Free text in v1: prescription (medication/dose/instructions), per the pharmacy
    # withdrawal note in ADR-0013 — no structured items, no stock tracking.
    prescription: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    appointment: Mapped["Appointment"] = relationship(back_populates="consultation")