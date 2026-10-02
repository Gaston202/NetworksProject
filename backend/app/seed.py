"""Demo seed data — idempotent: skips if the seed is complete, detects and
heals a partially-written seed (a mid-seed failure used to be misreported as
"already present" because only the admin row was checked).

Run:  .venv/Scripts/python -m app.seed        (from the backend/ directory)
Accounts and password come from SEED_PASSWORD in .env (default: hms-demo-1234).

Three-role scope (ADR-0007): admin, doctor, patient. No nurse/pharmacist/meds.
Atlas is the only database (ADR-0004): indexes are ensured here and at app
startup; there is no schema/migration step.
"""
import asyncio
from datetime import datetime, timedelta

from app.core.config import settings
from app.core.security import hash_password
from app.db.indexes import ensure_indexes
from app.db.mongo import db, reserve_ids, utcnow
from app.domain import UserRole

DEPARTMENTS = ["Cardiology", "Pediatrics", "General Medicine"]

DOCTORS = [
    ("Dr. Amina Haddad", "amina.haddad@hms.example.com", "Cardiology", "Interventional cardiology"),
    ("Dr. Omar Benali", "omar.benali@hms.example.com", "Cardiology", "General cardiology"),
    ("Dr. Salma Trabelsi", "salma.trabelsi@hms.example.com", "Pediatrics", "Neonatal care"),
]

STAFF = [
    ("Ghassen Admin", "admin@hms.example.com", UserRole.ADMIN),
]

PATIENTS = [
    ("Sami Patient", "patient@hms.example.com"),
    ("Leila Mansour", "leila.mansour@hms.example.com"),
]

# Slot windows per day (start hour, hours): 09:00-12:00 and 14:00-16:00,
# 30-minute slots. Single source of truth for both the seed loop and the
# expected-total-slots count in the partial-seed check.
SLOT_WINDOWS = ((9, 3), (14, 2))
SLOTS_DAYS = 7

SEED_COUNTS = {
    "users": len(STAFF) + len(DOCTORS) + len(PATIENTS),
    "departments": len(DEPARTMENTS),
    "doctor_profiles": len(DOCTORS),
    "patient_profiles": len(PATIENTS),
    "availability_slots": (SLOTS_DAYS * len(DOCTORS)
                           * sum(hours * 2 for _, hours in SLOT_WINDOWS)),
}


def _user_doc(_id: int, full_name: str, email: str, password_hash: str,
              role: str) -> dict:
    return {
        "_id": _id,
        "full_name": full_name,
        "email": email,
        "password_hash": password_hash,
        "role": role,
        "is_active": True,
        "created_at": utcnow(),
    }


async def seed() -> None:
    await ensure_indexes(db)
    if await db["users"].find_one({"email": "admin@hms.example.com"}):
        # A legit install only ever GROWS these counts (no deletion endpoints
        # for the seeded rows), so anything below the seed minimum means a
        # mid-seed failure — reset the seeded collections and redo it fully.
        partial = []
        for name, expected in SEED_COUNTS.items():
            count = await db[name].count_documents({})
            if count < expected:
                partial.append(f"{name}: {count} < {expected}")
        if partial:
            print("Partial seed detected - resetting and re-seeding:")
            print(f"    {', '.join(partial)}")
            for name in [*SEED_COUNTS, "counters"]:
                await db[name].drop()
        else:
            print("Seed data already present - nothing to do.")
            return

    password = hash_password(settings.seed_password)

    dept_ids = await reserve_ids("departments", len(DEPARTMENTS))
    departments = [
        {"_id": _id, "name": name}
        for _id, name in zip(dept_ids, DEPARTMENTS)
    ]
    await db["departments"].insert_many(departments)
    dept_id_by_name = {d["name"]: d["_id"] for d in departments}

    user_ids = await reserve_ids(
        "users", len(STAFF) + len(DOCTORS) + len(PATIENTS))
    ids = iter(user_ids)
    staff_users = [
        _user_doc(next(ids), full_name, email, password, role.value)
        for full_name, email, role in STAFF
    ]
    doctor_users = [
        (_user_doc(next(ids), full_name, email, password, UserRole.DOCTOR.value),
         dept_name, specialty)
        for full_name, email, dept_name, specialty in DOCTORS
    ]
    patient_users = [
        _user_doc(next(ids), full_name, email, password, UserRole.PATIENT.value)
        for full_name, email in PATIENTS
    ]
    await db["users"].insert_many(
        staff_users + [user for user, _, _ in doctor_users] + patient_users)

    profile_ids = await reserve_ids("doctor_profiles", len(doctor_users))
    doctor_profiles = [
        {
            "_id": profile_id,
            "user_id": user["_id"],
            "department_id": dept_id_by_name[dept_name],
            "specialty": specialty,
        }
        for profile_id, (user, dept_name, specialty) in zip(profile_ids, doctor_users)
    ]
    await db["doctor_profiles"].insert_many(doctor_profiles)

    patient_profile_ids = await reserve_ids("patient_profiles", len(patient_users))
    patient_profiles = [
        {
            "_id": profile_id,
            "user_id": patient["_id"],
            "date_of_birth": None,
            "phone": "+216-55-000-000",
            "address": None,
        }
        for profile_id, patient in zip(patient_profile_ids, patient_users)
    ]
    await db["patient_profiles"].insert_many(patient_profiles)

    # Slots: today + 6 days, 09:00-12:00 and 14:00-16:00, 30 minutes each.
    # Every doctor gets slots every day so any doctor is bookable for the demo.
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    windows: list[tuple[int, datetime, datetime]] = []
    doctor_ids = [profile["_id"] for profile in doctor_profiles]
    for day in range(SLOTS_DAYS):
        base = today + timedelta(days=day)
        for window_start_hour, window_hours in SLOT_WINDOWS:
            for half in range(window_hours * 2):
                start = base + timedelta(hours=window_start_hour, minutes=30 * half)
                for doctor_id in doctor_ids:
                    windows.append((doctor_id, start, start + timedelta(minutes=30)))

    slot_ids = await reserve_ids("availability_slots", len(windows))
    slots = [
        {"_id": slot_id, "doctor_id": doctor_id, "starts_at": start, "ends_at": end}
        for slot_id, (doctor_id, start, end) in zip(slot_ids, windows)
    ]
    await db["availability_slots"].insert_many(slots)

    print(f"Seeded: {len(departments)} departments, "
          f"{len(staff_users) + len(doctor_users)} staff, "
          f"{len(patient_users)} patients, {len(slots)} slots "
          f"(consultation fee: {settings.consultation_fee})")
    print(f"Demo password for every seeded account: {settings.seed_password}")


if __name__ == "__main__":
    asyncio.run(seed())