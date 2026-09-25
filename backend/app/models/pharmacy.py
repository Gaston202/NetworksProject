"""Pharmacy: medications, prescription items, dispensing (ADR-0013)."""
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.clinical import Consultation


class Medication(Base):
    __tablename__ = "medications"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), unique=True)
    unit_price: Mapped[float] = mapped_column(Numeric(10, 2))
    stock_quantity: Mapped[int] = mapped_column(Integer, default=0)
    low_stock_threshold: Mapped[int] = mapped_column(Integer, default=10)

    prescription_items: Mapped[list["PrescriptionItem"]] = relationship(back_populates="medication")


class PrescriptionItem(Base):
    __tablename__ = "prescription_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    consultation_id: Mapped[int] = mapped_column(
        ForeignKey("consultations.id"), index=True
    )
    medication_id: Mapped[int] = mapped_column(ForeignKey("medications.id"), index=True)
    dose: Mapped[str] = mapped_column(String(60))       # e.g. "500 mg"
    frequency: Mapped[str] = mapped_column(String(60))  # e.g. "3x daily"
    duration: Mapped[str] = mapped_column(String(60))   # e.g. "7 days"

    consultation: Mapped["Consultation"] = relationship(back_populates="prescription_items")
    medication: Mapped[Medication] = relationship(back_populates="prescription_items")
    dispense_record: Mapped["DispenseRecord | None"] = relationship(
        back_populates="prescription_item", uselist=False, cascade="all, delete-orphan"
    )


class DispenseRecord(Base):
    __tablename__ = "dispense_records"
    __table_args__ = (
        UniqueConstraint("prescription_item_id", name="uq_dispense_records_item"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    prescription_item_id: Mapped[int] = mapped_column(
        ForeignKey("prescription_items.id"), unique=True
    )
    pharmacist_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    price_at_dispense: Mapped[float] = mapped_column(Numeric(10, 2))
    dispensed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    prescription_item: Mapped[PrescriptionItem] = relationship(back_populates="dispense_record")