"""Clinical records: consultations written by doctors (ADR-0010).

The consultation is an embedded subdocument on the appointment (spec §3) —
1:1, write-once, always displayed with it. The write is one atomic guarded
update, so "one consultation per appointment, while booked" needs no
separate collection or second write (spec §4 row 4).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user
from app.db.mongo import get_db, utcnow
from app.domain import AppointmentStatus, UserRole
from app.schemas import ConsultationCreateIn, ConsultationOut

router = APIRouter()


# `_consultation_out` and the profile-id helper mirror scheduling.py's — same
# shapes (embedding means clinical reads run on appointments, not a collection).

async def _doctor_profile_id(db: AsyncIOMotorDatabase, user: dict) -> int:
    profile = await db["doctor_profiles"].find_one({"user_id": user["_id"]})
    if profile is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Account has no doctor profile")
    return profile["_id"]


def _consultation_out(appointment: dict) -> dict:
    consultation = appointment["consultation"]
    return {
        "id": appointment["_id"],
        "appointment_id": appointment["_id"],
        "diagnosis": consultation["diagnosis"],
        "notes": consultation.get("notes"),
        "prescription": consultation.get("prescription"),
        "created_at": consultation["created_at"],
    }


@router.post("/appointments/{appointment_id}/consultation",
             response_model=ConsultationOut,
             status_code=status.HTTP_201_CREATED, tags=["clinical"])
async def write_consultation(appointment_id: int, payload: ConsultationCreateIn,
                             db: AsyncIOMotorDatabase = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    """Doctor writes the consultation (diagnosis + notes + optional Rx text) for
    their own appointment; the appointment moves `booked → consulted`. One
    consultation per appointment (the guarded update's `$exists: false` check)."""
    if user["role"] != UserRole.DOCTOR.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requires role: doctor")
    appointment = await db["appointments"].find_one({"_id": appointment_id})
    if appointment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")
    if appointment["doctor_id"] != await _doctor_profile_id(db, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your appointment")
    if appointment["status"] != AppointmentStatus.BOOKED.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Appointment is {appointment['status']} - consultations are written "
            "while booked")

    consultation = {
        "diagnosis": payload.diagnosis,
        "notes": payload.notes,
        "prescription": payload.prescription,
        "created_at": utcnow(),
    }
    result = await db["appointments"].update_one(
        {"_id": appointment_id,
         "status": AppointmentStatus.BOOKED.value,
         "consultation": {"$exists": False}},
        {"$set": {"status": AppointmentStatus.CONSULTED.value,
                  "consultation": consultation}})
    if result.matched_count != 1:
        # Lost the guarded race — produce exactly the conflicts the unique
        # constraint produced in PostgreSQL (spec §4 row 4).
        current = await db["appointments"].find_one({"_id": appointment_id})
        if current["status"] != AppointmentStatus.CONSULTED.value:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Appointment is {current['status']} - consultations are written "
                "while booked")
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Appointment already has a consultation")
    return ConsultationOut(id=appointment_id, appointment_id=appointment_id,
                           **consultation)


@router.get("/consultations", response_model=list[ConsultationOut],
            tags=["clinical"])
async def list_consultations(db: AsyncIOMotorDatabase = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    """Role-scoped timeline, newest first: a patient reads only their own
    consultations (the patient-record view, ADR-0010)."""
    if user["role"] == UserRole.PATIENT.value:
        profile = await db["patient_profiles"].find_one({"user_id": user["_id"]})
        if profile is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Account has no patient profile")
        query: dict = {"patient_id": profile["_id"],
                       "consultation": {"$exists": True}}
    elif user["role"] == UserRole.DOCTOR.value:
        profile = await db["doctor_profiles"].find_one({"user_id": user["_id"]})
        if profile is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Account has no doctor profile")
        query = {"doctor_id": profile["_id"], "consultation": {"$exists": True}}
    elif user["role"] == UserRole.ADMIN.value:
        query = {"consultation": {"$exists": True}}
    else:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    rows = await db["appointments"].find(query).sort(
        "consultation.created_at", -1).to_list(length=None)
    return [_consultation_out(row) for row in rows]