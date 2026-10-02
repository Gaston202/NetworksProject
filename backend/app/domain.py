"""Domain enums (unchanged values from the old SQLA models — API parity).

MongoDB stores plain strings; these classes exist for validation and to keep
`UserRole(role)`-style parsing in routes readable.
"""
from enum import Enum as StdEnum


class UserRole(str, StdEnum):
    ADMIN = "admin"
    DOCTOR = "doctor"
    PATIENT = "patient"


class AppointmentStatus(str, StdEnum):
    BOOKED = "booked"
    CONSULTED = "consulted"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class InvoiceStatus(str, StdEnum):
    UNPAID = "unpaid"
    PAID = "paid"