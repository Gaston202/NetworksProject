"""Display-name lookups for list/detail responses.

Appointments and invoices store profile ids only (no name copies, spec §5.1),
so responses resolve names with batched id-maps: a fixed handful of queries per
response regardless of row count — never one query per row.
"""
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.db.mongo import strip_id


async def _by_id(db: AsyncIOMotorDatabase, collection: str, ids: set) -> dict:
    if not ids:
        return {}
    docs = await db[collection].find({"_id": {"$in": list(ids)}}).to_list(length=None)
    return {doc["_id"]: doc for doc in docs}


async def appointment_names(db: AsyncIOMotorDatabase,
                            appointments: list[dict]) -> dict[int, dict]:
    """appointment _id -> {patient_name, doctor_name, department_name}."""
    patients = await _by_id(db, "patient_profiles", {a["patient_id"] for a in appointments})
    doctors = await _by_id(db, "doctor_profiles", {a["doctor_id"] for a in appointments})
    users = await _by_id(db, "users", {p["user_id"] for p in [*patients.values(), *doctors.values()]})
    departments = await _by_id(db, "departments", {
        d["department_id"] for d in doctors.values() if d.get("department_id") is not None})

    def user_name(profile: dict | None) -> str | None:
        user = users.get(profile["user_id"]) if profile else None
        return user["full_name"] if user else None

    names = {}
    for appointment in appointments:
        doctor = doctors.get(appointment["doctor_id"])
        department = departments.get(doctor.get("department_id")) if doctor else None
        names[appointment["_id"]] = {
            "patient_name": user_name(patients.get(appointment["patient_id"])),
            "doctor_name": user_name(doctor),
            "department_name": department["name"] if department else None,
        }
    return names


async def invoices_out(db: AsyncIOMotorDatabase, invoices: list[dict]) -> list[dict]:
    """Invoice docs -> InvoiceOut dicts with the visit's names and start time."""
    appointments = await _by_id(db, "appointments", {i["appointment_id"] for i in invoices})
    names = await appointment_names(db, list(appointments.values()))
    out = []
    for invoice in invoices:
        appointment = appointments.get(invoice["appointment_id"])
        data = strip_id(invoice)
        data.update(names.get(invoice["appointment_id"], {}))
        data["visit_starts_at"] = appointment["starts_at"] if appointment else None
        out.append(data)
    return out
