"""Billing: invoices derived from completed visits (ADR-0012).

Invoices are never hand-authored: completion of an appointment derives the
invoice (see the appointments module); this module only reads and marks paid.
The `patient_id` filter uses the denormalized field completion wrote — no join.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, require_role
from app.db.mongo import get_db, strip_id
from app.domain import InvoiceStatus, UserRole
from app.schemas import InvoiceOut

router = APIRouter()


async def _patient_profile_id(db: AsyncIOMotorDatabase, user: dict) -> int:
    profile = await db["patient_profiles"].find_one({"user_id": user["_id"]})
    if profile is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Account has no patient profile")
    return profile["_id"]


@router.get("/invoices", response_model=list[InvoiceOut], tags=["billing"])
async def list_invoices(status_filter: str | None = None,
                        db: AsyncIOMotorDatabase = Depends(get_db),
                        user: dict = Depends(get_current_user)):
    """Admin sees all invoices; a patient only their own (per-row ownership)."""
    query: dict = {}
    if user["role"] == UserRole.PATIENT.value:
        query["patient_id"] = await _patient_profile_id(db, user)
    elif user["role"] != UserRole.ADMIN.value:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Requires one of: admin, patient")
    if status_filter:
        query["status"] = status_filter
    return [
        strip_id(doc) async for doc in db["invoices"].find(query).sort("created_at", -1)
    ]


@router.patch("/invoices/{invoice_id}/paid", response_model=InvoiceOut,
              tags=["billing"])
async def mark_paid(invoice_id: int,
                    db: AsyncIOMotorDatabase = Depends(get_db),
                    _admin: dict = Depends(require_role(UserRole.ADMIN))):
    """Admin marks an unpaid invoice paid; `unpaid → paid` in one direction,
    no partial payments (ADR-0012)."""
    invoice = await db["invoices"].find_one({"_id": invoice_id})
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")
    if invoice["status"] == InvoiceStatus.PAID.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Invoice already paid")
    await db["invoices"].update_one(
        {"_id": invoice_id}, {"$set": {"status": InvoiceStatus.PAID.value}})
    return strip_id(await db["invoices"].find_one({"_id": invoice_id}))