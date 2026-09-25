"""Billing: invoices derived from completed visits (ADR-0012)."""
from datetime import datetime
from enum import Enum as StdEnum
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.scheduling import Appointment


class InvoiceStatus(str, StdEnum):
    UNPAID = "unpaid"
    PAID = "paid"


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (UniqueConstraint("appointment_id", name="uq_invoices_appointment"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_id: Mapped[int] = mapped_column(
        ForeignKey("appointments.id"), unique=True, index=True
    )
    total: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    status: Mapped[str] = mapped_column(
        Enum(*[s.value for s in InvoiceStatus], name="invoice_status",
             native_enum=False, length=20),
        default=InvoiceStatus.UNPAID.value,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    appointment: Mapped["Appointment"] = relationship(back_populates="invoice")
    line_items: Mapped[list["InvoiceLineItem"]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan"
    )


class InvoiceLineItem(Base):
    __tablename__ = "invoice_line_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), index=True)
    description: Mapped[str] = mapped_column(String(255))
    amount: Mapped[float] = mapped_column(Numeric(10, 2))

    invoice: Mapped[Invoice] = relationship(back_populates="line_items")