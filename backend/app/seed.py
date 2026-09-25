"""Demo seed data — idempotent (safe to re-run; skips if the admin exists).

Run:  python -m app.seed        (from the backend/ directory)
Accounts and password come from SEED_PASSWORD in .env (default: hms-demo-1234).
"""
from datetime import datetime, timedelta

from app.core.config import settings
from app.core.security import hash_password
from app.db.base import Base, SessionLocal, engine
from app.models import (
    AvailabilitySlot,
    Department,
    DoctorProfile,
    Medication,
    PatientProfile,
    User,
    UserRole,
)

DEPARTMENTS = ["Cardiology", "Pediatrics", "General Medicine"]

DOCTORS = [
    ("Dr. Amina Haddad", "amina.haddad@hms.example.com", "Cardiology", "Interventional cardiology"),
    ("Dr. Omar Benali", "omar.benali@hms.example.com", "Cardiology", "General cardiology"),
    ("Dr. Salma Trabelsi", "salma.trabelsi@hms.example.com", "Pediatrics", "Neonatal care"),
]

STAFF = [
    ("Ghassen Admin", "admin@hms.example.com", UserRole.ADMIN),
    ("Nour Nurse", "nurse@hms.example.com", UserRole.NURSE),
    ("Youssef Pharmacist", "pharmacist@hms.example.com", UserRole.PHARMACIST),
]

PATIENTS = [
    ("Sami Patient", "patient@hms.example.com"),
    ("Leila Mansour", "leila.mansour@hms.example.com"),
]

MEDICATIONS = [
    # (name, unit_price, stock_quantity, low_stock_threshold)
    ("Paracetamol 500mg", 2.50, 200, 20),
    ("Amoxicillin 250mg", 5.00, 80, 15),
    ("Ibuprofen 400mg", 3.20, 120, 20),
    ("Omeprazole 20mg", 6.75, 8, 10),   # below threshold -> low-stock warning
    ("Ventolin inhaler", 12.00, 25, 5),
    ("Insulin glargine", 45.00, 0, 3),  # zero stock -> dispensing must refuse
]

CONSULTATION_FEE = 25.00  # stored here; billing (week 3) reads it from settings


def seed() -> None:
    # Dev convenience: create tables if missing (no-op where Alembic already ran).
    # Schema *changes* go through Alembic, never through this call — see README.
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == "admin@hms.example.com").first():
            print("Seed data already present - nothing to do.")
            return

        password = hash_password(settings.seed_password)
        departments = {name: Department(name=name) for name in DEPARTMENTS}
        db.add_all(departments.values())

        for full_name, email, role in STAFF:
            db.add(User(full_name=full_name, email=email,
                        password_hash=password, role=role.value))

        doctors: list[DoctorProfile] = []
        for full_name, email, dept_name, specialty in DOCTORS:
            user = User(full_name=full_name, email=email,
                        password_hash=password, role=UserRole.DOCTOR.value)
            profile = DoctorProfile(department=departments[dept_name], specialty=specialty)
            user.doctor_profile = profile
            db.add(user)
            doctors.append(profile)

        for full_name, email in PATIENTS:
            user = User(full_name=full_name, email=email,
                        password_hash=password, role=UserRole.PATIENT.value)
            user.patient_profile = PatientProfile(phone="+216-55-000-000")
            db.add(user)

        for name, price, stock, threshold in MEDICATIONS:
            db.add(Medication(name=name, unit_price=price,
                              stock_quantity=stock, low_stock_threshold=threshold))

        db.commit()  # profiles need ids before slot creation

        # Slots: today + 6 days, 09:00-12:00 and 14:00-16:00, 30 minutes each.
        # Every doctor gets slots every day so any doctor is bookable for the demo.
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        slots: list[AvailabilitySlot] = []
        for day in range(7):
            base = today + timedelta(days=day)
            for window_start_hour, window_hours in ((9, 3), (14, 2)):
                for half in range(window_hours * 2):
                    start = base + timedelta(hours=window_start_hour, minutes=30 * half)
                    for doctor in doctors:
                        slots.append(AvailabilitySlot(
                            doctor_id=doctor.id,
                            starts_at=start,
                            ends_at=start + timedelta(minutes=30),
                        ))
        db.add_all(slots)
        db.commit()

        print(f"Seeded: {len(departments)} departments, {len(doctors) + len(STAFF)} staff, "
              f"{len(PATIENTS)} patients, {len(MEDICATIONS)} medications, {len(slots)} slots")
        print(f"Demo password for every seeded account: {settings.seed_password}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()