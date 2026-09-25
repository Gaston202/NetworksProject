"""Import every model so Alembic and the mappers see the full schema."""
from app.models.user import Department, DoctorProfile, PatientProfile, User, UserRole
from app.models.scheduling import Appointment, AppointmentStatus, AvailabilitySlot
from app.models.clinical import Consultation, Vitals
from app.models.pharmacy import DispenseRecord, Medication, PrescriptionItem
from app.models.billing import Invoice, InvoiceLineItem, InvoiceStatus

__all__ = [
    "User", "UserRole", "Department", "DoctorProfile", "PatientProfile",
    "Appointment", "AppointmentStatus", "AvailabilitySlot",
    "Consultation", "Vitals",
    "Medication", "PrescriptionItem", "DispenseRecord",
    "Invoice", "InvoiceLineItem", "InvoiceStatus",
]