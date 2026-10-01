"""Import every model so Alembic and the mappers see the full schema."""
from app.models.user import Department, DoctorProfile, PatientProfile, User, UserRole
from app.models.scheduling import Appointment, AppointmentStatus, AvailabilitySlot
from app.models.clinical import Consultation
from app.models.billing import Invoice, InvoiceStatus

__all__ = [
    "User", "UserRole", "Department", "DoctorProfile", "PatientProfile",
    "Appointment", "AppointmentStatus", "AvailabilitySlot",
    "Consultation", "Invoice", "InvoiceStatus",
]