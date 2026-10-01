"""Billing: invoices derived from completed visits (ADR-0012).

Invoices are never hand-authored: completion of an appointment derives the
invoice (see the appointments module); this module only reads and marks paid.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.db.base import get_db
from app.models import Appointment, Invoice, InvoiceStatus, PatientProfile, User, UserRole
from app.schemas import InvoiceOut

router = APIRouter()


@router.get("/invoices", response_model=list[InvoiceOut], tags=["billing"])
def list_invoices(status_filter: str | None = None,
                  db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    """Admin sees all invoices; a patient only their own (per-row ownership)."""
    if user.role == UserRole.ADMIN.value:
        query = db.query(Invoice)
        if status_filter:
            query = query.filter(Invoice.status == status_filter)
        return query.order_by(Invoice.created_at.desc()).all()
    if user.role == UserRole.PATIENT.value:
        profile = db.query(PatientProfile).filter(
            PatientProfile.user_id == user.id).first()
        if profile is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Account has no patient profile")
        query = db.query(Invoice).join(
            Appointment, Appointment.id == Invoice.appointment_id
        ).filter(Appointment.patient_id == profile.id)
        if status_filter:
            query = query.filter(Invoice.status == status_filter)
        return query.order_by(Invoice.created_at.desc()).all()
    raise HTTPException(
        status.HTTP_403_FORBIDDEN, "Requires one of: admin, patient")


@router.patch("/invoices/{invoice_id}/paid", response_model=InvoiceOut,
              tags=["billing"])
def mark_paid(invoice_id: int, db: Session = Depends(get_db),
              _admin: User = Depends(require_role(UserRole.ADMIN))):
    """Admin marks an unpaid invoice paid; `unpaid → paid` in one direction,
    no partial payments (ADR-0012)."""
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")
    if invoice.status == InvoiceStatus.PAID.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Invoice already paid")
    invoice.status = InvoiceStatus.PAID.value
    db.commit()
    db.refresh(invoice)
    return invoice