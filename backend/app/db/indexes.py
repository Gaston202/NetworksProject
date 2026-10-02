"""Index bootstrap (spec §3): idempotent create_index calls, run at startup.

Unique indexes carry the invariants the former SQL stack's constraints
carried (§4):
email, department name, one profile per user, exact-duplicate slot windows,
one active appointment per slot (sparse — cancelled docs drop the field),
one invoice per appointment.
"""
from motor.motor_asyncio import AsyncIOMotorDatabase


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db["users"].create_index("email", unique=True)
    await db["departments"].create_index("name", unique=True)
    await db["doctor_profiles"].create_index("user_id", unique=True)
    await db["patient_profiles"].create_index("user_id", unique=True)
    await db["availability_slots"].create_index(
        [("doctor_id", 1), ("starts_at", 1)], unique=True)
    await db["appointments"].create_index("slot_id", unique=True, sparse=True)
    await db["appointments"].create_index("patient_id")
    await db["appointments"].create_index("doctor_id")
    await db["invoices"].create_index("appointment_id", unique=True)