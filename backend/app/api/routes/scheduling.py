"""Departments, doctors, slots, and appointments (ADR-0007/0008/0009).

All ownership rules are per-row: patient appointments only through their own
profile id, doctor consultation writes only for their own appointments
(domain-model invariant 3/4). Slot exclusivity is enforced by the unique
*sparse* index on `appointments.slot_id`; cancelling `$unset`s the field, so a
cancelled appointment releases its slot (spec §4 row 2). Booking copies the
slot's times onto the appointment, so displays need no joins.
"""
import asyncio
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import BulkWriteError, DuplicateKeyError, PyMongoError

from app.api.deps import get_current_user, require_role
from app.core.config import settings
from app.db.mongo import get_db, next_id, reserve_ids, strip_id, utcnow
from app.domain import AppointmentStatus, InvoiceStatus, UserRole
from app.schemas import (
    AppointmentCreateIn,
    AppointmentDetailOut,
    AppointmentOut,
    DepartmentCreateIn,
    DepartmentOut,
    DepartmentRenameIn,
    DoctorOut,
    SlotBulkIn,
    SlotOut,
)

router = APIRouter()


# --- Helpers ---------------------------------------------------------------

async def _patient_profile_id(db: AsyncIOMotorDatabase, user: dict) -> int:
    """Profile id of the logged-in patient; patients without a profile can't act."""
    profile = await db["patient_profiles"].find_one({"user_id": user["_id"]})
    if profile is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Account has no patient profile")
    return profile["_id"]


async def _doctor_profile_id(db: AsyncIOMotorDatabase, user: dict) -> int:
    profile = await db["doctor_profiles"].find_one({"user_id": user["_id"]})
    if profile is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Account has no doctor profile")
    return profile["_id"]


async def _slot_or_404(db: AsyncIOMotorDatabase, slot_id: int) -> dict:
    slot = await db["availability_slots"].find_one({"_id": slot_id})
    if slot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Slot not found")
    return slot


async def _appointment_or_404(db: AsyncIOMotorDatabase, appointment_id: int) -> dict:
    appointment = await db["appointments"].find_one({"_id": appointment_id})
    if appointment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")
    return appointment


def _consultation_out(appointment: dict) -> dict | None:
    """Embedded consultation → ConsultationOut shape; id == appointment_id."""
    consultation = appointment.get("consultation")
    if consultation is None:
        return None
    return {
        "id": appointment["_id"],
        "appointment_id": appointment["_id"],
        "diagnosis": consultation["diagnosis"],
        "notes": consultation.get("notes"),
        "prescription": consultation.get("prescription"),
        "created_at": consultation["created_at"],
    }


async def _out(db: AsyncIOMotorDatabase, appointment: dict, detail: bool) -> dict:
    """Appointment dict; slot times were copied at booking, so no joins are needed.

    Cancelled appointments lost `slot_id` (it was $unset) but kept
    `original_slot_id` — the response keeps an int slot_id either way.
    """
    data = strip_id(appointment)
    data["slot_id"] = appointment.get("slot_id",
                                      appointment.get("original_slot_id"))
    if detail:
        data["consultation"] = _consultation_out(appointment)
        invoice = await db["invoices"].find_one({"appointment_id": appointment["_id"]})
        data["invoice"] = strip_id(invoice) if invoice else None
    return data


# --- Departments (managed by Admin) ----------------------------------------

@router.get("/departments", response_model=list[DepartmentOut],
            tags=["scheduling"],
            summary="List departments (authenticated users)")
async def list_departments(db: AsyncIOMotorDatabase = Depends(get_db),
                           _user: dict = Depends(get_current_user)):
    return [
        DepartmentOut(**strip_id(doc))
        async for doc in db["departments"].find().sort("name", 1)
    ]


@router.post("/departments", response_model=DepartmentOut,
             status_code=status.HTTP_201_CREATED, tags=["scheduling"])
async def create_department(payload: DepartmentCreateIn,
                            db: AsyncIOMotorDatabase = Depends(get_db),
                            _admin: dict = Depends(require_role(UserRole.ADMIN))):
    if await db["departments"].find_one({"name": payload.name}):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Department name already exists")
    department = {"_id": await next_id("departments"), "name": payload.name}
    try:
        await db["departments"].insert_one(department)
    except DuplicateKeyError:  # lost the name race
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Department name already exists") from None
    return strip_id(department)


@router.patch("/departments/{department_id}", response_model=DepartmentOut,
              tags=["scheduling"])
async def rename_department(department_id: int, payload: DepartmentRenameIn,
                            db: AsyncIOMotorDatabase = Depends(get_db),
                            _admin: dict = Depends(require_role(UserRole.ADMIN))):
    department = await db["departments"].find_one({"_id": department_id})
    if department is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")
    if await db["departments"].find_one(
            {"name": payload.name, "_id": {"$ne": department_id}}):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Department name already exists")
    await db["departments"].update_one(
        {"_id": department_id}, {"$set": {"name": payload.name}})
    return strip_id(
        await db["departments"].find_one({"_id": department_id}))


@router.delete("/departments/{department_id}",
               status_code=status.HTTP_204_NO_CONTENT, tags=["scheduling"])
async def delete_department(department_id: int,
                            db: AsyncIOMotorDatabase = Depends(get_db),
                            _admin: dict = Depends(require_role(UserRole.ADMIN))):
    """Invariant 6: a department with doctors assigned can't be deleted."""
    department = await db["departments"].find_one({"_id": department_id})
    if department is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")
    if await db["doctor_profiles"].count_documents(
            {"department_id": department_id}, limit=1):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Department has doctors assigned - reassign them first")
    await db["departments"].delete_one({"_id": department_id})


# --- Doctors (booking browse) ----------------------------------------------

@router.get("/doctors", response_model=list[DoctorOut], tags=["scheduling"])
async def list_doctors(department_id: int | None = None,
                       db: AsyncIOMotorDatabase = Depends(get_db),
                       _user: dict = Depends(get_current_user)):
    """Doctor directory for the booking flow (ADR-0007). Two-query id-maps per
    spec §5.1: profiles + users (+ departments for display), no name copies."""
    profile_query: dict = {}
    if department_id is not None:
        profile_query["department_id"] = department_id
    profiles = await db["doctor_profiles"].find(profile_query).to_list(length=None)
    user_ids = [profile["user_id"] for profile in profiles]
    dept_ids = list({
        profile["department_id"] for profile in profiles
        if profile.get("department_id") is not None})
    users_by_id = {
        user["_id"]: user for user in
        (await db["users"].find({"_id": {"$in": user_ids}}).to_list(length=None))}
    depts_by_id = {
        dept["_id"]: dept for dept in
        (await db["departments"].find({"_id": {"$in": dept_ids}}).to_list(length=None))}
    doctors = []
    for profile in profiles:
        user = users_by_id[profile["user_id"]]
        department = depts_by_id.get(profile.get("department_id"))
        doctors.append(DoctorOut(
            id=profile["_id"],
            full_name=user["full_name"],
            email=user["email"],
            department_id=profile.get("department_id"),
            department_name=department["name"] if department else None,
            specialty=profile.get("specialty"),
        ))
    return doctors


# --- Slots ------------------------------------------------------------------

@router.get("/doctors/{doctor_id}/slots", response_model=list[SlotOut],
            tags=["scheduling"])
async def list_doctor_slots(doctor_id: int,
                            free_only: bool = Query(default=False, alias="free"),
                            db: AsyncIOMotorDatabase = Depends(get_db),
                            _user: dict = Depends(get_current_user)):
    """Slots for one doctor. `?free=true` returns only bookable slots."""
    if await db["doctor_profiles"].find_one({"_id": doctor_id}) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Doctor not found")
    slots = await db["availability_slots"].find(
        {"doctor_id": doctor_id}).sort("starts_at", 1).to_list(length=None)
    # An appointment holds its slot_id until cancellation $unsets it — a slot
    # id present in any appointment doc means that slot is occupied.
    booked_slot_ids = {
        appointment["slot_id"] for appointment in
        (await db["appointments"].find(
            {"slot_id": {"$exists": True}}).to_list(length=None))}
    return [
        SlotOut(
            id=slot["_id"], doctor_id=slot["doctor_id"],
            starts_at=slot["starts_at"], ends_at=slot["ends_at"],
            is_free=slot["_id"] not in booked_slot_ids,
        )
        for slot in slots
        if not free_only or slot["_id"] not in booked_slot_ids
    ]


@router.post("/doctors/{doctor_id}/slots",
             response_model=list[SlotOut],
             status_code=status.HTTP_201_CREATED, tags=["scheduling"])
async def create_slots(doctor_id: int, payload: SlotBulkIn,
                       db: AsyncIOMotorDatabase = Depends(get_db),
                       user: dict = Depends(get_current_user)):
    """Bulk-create a daily window of slots. Admin may target any doctor; a doctor
    may only target their own availability (ADR-0009)."""
    if user["role"] == UserRole.DOCTOR.value:
        own = await _doctor_profile_id(db, user)
        if own != doctor_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Doctors may only create their own slots")
    elif user["role"] != UserRole.ADMIN.value:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Requires one of: admin, doctor")
    if await db["doctor_profiles"].find_one({"_id": doctor_id}) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Doctor not found")

    windows: list[tuple[datetime, datetime]] = []
    for day in range(payload.days):
        base = datetime.combine(payload.first_date, datetime.min.time()) \
            + timedelta(days=day, hours=payload.start_hour, minutes=payload.start_minute)
        step = timedelta(minutes=payload.slot_minutes)
        for offset in range(int(payload.hours_per_day * 60) // payload.slot_minutes):
            start = base + offset * step
            windows.append((start, start + step))
    if not windows:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Window yields no slots")

    # One query covers the whole requested span; the per-slot overlap loop is
    # replaced by checking the created windows against the fetched overlap set
    # in ascending order (same first-conflict message as the SQLA version).
    overlapping = await db["availability_slots"].find({
        "doctor_id": doctor_id,
        "starts_at": {"$lt": windows[-1][1]},
        "ends_at": {"$gt": windows[0][0]},
    }).to_list(length=None)
    for start, end in windows:
        if any(existing["starts_at"] < end and existing["ends_at"] > start
               for existing in overlapping):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Slot range {start:%Y-%m-%d %H:%M} overlaps existing slots - "
                "nothing created")

    slot_ids = await reserve_ids("availability_slots", len(windows))
    slots = [
        {"_id": slot_id, "doctor_id": doctor_id, "starts_at": start, "ends_at": end}
        for slot_id, (start, end) in zip(slot_ids, windows)
    ]
    try:
        await db["availability_slots"].insert_many(slots)
    except BulkWriteError as exc:
        # insert_many reports even a duplicate key as BulkWriteError, and it
        # runs ordered: everything before the failed document is persisted.
        # Keep the pre-check's promise ("nothing created") by deleting the
        # batch back out — its ids were minted here and the pre-check just
        # passed, so no other writer can hold them (spec §4 row 6).
        await db["availability_slots"].delete_many(
            {"_id": {"$in": list(slot_ids)}})
        if not any(error.get("code") == 11000
                   for error in exc.details.get("writeErrors", [])):
            raise
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Slot range {windows[0][0]:%Y-%m-%d %H:%M} overlaps existing slots - "
            "nothing created") from None
    return [SlotOut(**strip_id(slot), is_free=True) for slot in slots]


# --- Appointments -----------------------------------------------------------

@router.post("/appointments", response_model=AppointmentOut,
             status_code=status.HTTP_201_CREATED, tags=["appointments"])
async def book_appointment(payload: AppointmentCreateIn,
                           db: AsyncIOMotorDatabase = Depends(get_db),
                           user: dict = Depends(get_current_user)):
    """Patients self-book; Admin books walk-ins by patient id (ADR-0009).

    Past slots are bookable on purpose — it is how the historic completed
    visit for the demo gets produced.
    """
    if user["role"] == UserRole.PATIENT.value:
        patient_id = await _patient_profile_id(db, user)
    elif user["role"] == UserRole.ADMIN.value:
        if payload.patient_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "patient_id is required when booking as Admin (walk-in)")
        patient_id = payload.patient_id
        if await db["patient_profiles"].find_one({"_id": patient_id}) is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "Patient not found")
    else:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Requires one of: admin, patient")

    slot = await _slot_or_404(db, payload.slot_id)
    # The sparse unique index means a `slot_id` on ANY appointment doc equals
    # "occupied" — no status filter, matching spec §4 row 2.
    if await db["appointments"].find_one({"slot_id": payload.slot_id}):
        raise HTTPException(status.HTTP_409_CONFLICT, "Slot taken - pick another")

    appointment = {
        "_id": await next_id("appointments"),
        "slot_id": payload.slot_id,
        "patient_id": patient_id,
        "doctor_id": slot["doctor_id"],
        "status": AppointmentStatus.BOOKED.value,
        "starts_at": slot["starts_at"],   # copied: displays never join slots
        "ends_at": slot["ends_at"],
        "created_at": utcnow(),
    }
    try:
        await db["appointments"].insert_one(appointment)
    except DuplicateKeyError:
        # Invariant 2: a lost booking race returns "slot taken", never a duplicate.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Slot taken - pick another") from None
    return await _out(db, appointment, detail=False)


@router.get("/appointments", response_model=list[AppointmentOut],
            tags=["appointments"])
async def list_appointments(
        status_filter: str | None = Query(default=None, alias="status"),
        db: AsyncIOMotorDatabase = Depends(get_db),
        user: dict = Depends(get_current_user)):
    """Role-scoped list: patients see their own, doctors their own, Admin all.
    Sorted by the copied `starts_at` (newest first) — the SQLA join's sort."""
    query: dict = {}
    if user["role"] == UserRole.PATIENT.value:
        query["patient_id"] = await _patient_profile_id(db, user)
    elif user["role"] == UserRole.DOCTOR.value:
        query["doctor_id"] = await _doctor_profile_id(db, user)
    elif user["role"] != UserRole.ADMIN.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    if status_filter:
        query["status"] = status_filter
    rows = await db["appointments"].find(query).sort(
        "starts_at", -1).to_list(length=None)
    return [AppointmentOut(**await _out(db, doc, detail=False)) for doc in rows]


@router.get("/appointments/{appointment_id}", response_model=AppointmentDetailOut,
            tags=["appointments"])
async def get_appointment(appointment_id: int,
                          db: AsyncIOMotorDatabase = Depends(get_db),
                          user: dict = Depends(get_current_user)):
    """Full appointment view (slot times + consultation + invoice).

    Ownership is checked per row: a patient may read only their own.
    """
    appointment = await _appointment_or_404(db, appointment_id)
    if user["role"] == UserRole.PATIENT.value:
        if appointment["patient_id"] != await _patient_profile_id(db, user):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Patients may only view their own appointments")
    elif user["role"] == UserRole.DOCTOR.value:
        if appointment["doctor_id"] != await _doctor_profile_id(db, user):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Doctors may only view their own appointments")
    elif user["role"] != UserRole.ADMIN.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    return await _out(db, appointment, detail=True)


@router.patch("/appointments/{appointment_id}/cancel", response_model=AppointmentOut,
              tags=["appointments"])
async def cancel_appointment(appointment_id: int,
                             db: AsyncIOMotorDatabase = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    """Patients cancel their own future appointments; Admin cancels for anyone.

    Cancelling frees the slot for rebooking (sparse index + `$unset slot_id`)
    and is only possible while the visit has not been completed. The slot id is
    preserved as `original_slot_id` so responses keep an int `slot_id`.
    """
    appointment = await _appointment_or_404(db, appointment_id)
    if user["role"] == UserRole.PATIENT.value:
        if appointment["patient_id"] != await _patient_profile_id(db, user):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Patients may only cancel their own appointments")
        if appointment["status"] != AppointmentStatus.BOOKED.value:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Patients may only cancel while the appointment is booked")
    elif user["role"] == UserRole.ADMIN.value:
        if appointment["status"] in (AppointmentStatus.COMPLETED.value,
                                     AppointmentStatus.CANCELLED.value):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Appointment already {appointment['status']}")
    else:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")

    await db["appointments"].update_one(
        {"_id": appointment_id},
        {"$set": {"status": AppointmentStatus.CANCELLED.value,
                  "original_slot_id": appointment["slot_id"]},
         "$unset": {"slot_id": ""}})
    return await _out(
        db, await db["appointments"].find_one({"_id": appointment_id}),
        detail=False)


@router.patch("/appointments/{appointment_id}/complete",
              response_model=AppointmentDetailOut, tags=["appointments"])
async def complete_appointment(appointment_id: int,
                               db: AsyncIOMotorDatabase = Depends(get_db),
                               user: dict = Depends(get_current_user)):
    """Doctor-only transition `booked|consulted → completed`, which derives the
    invoice (ADR-0012, invariant 5) — invoice total is the configured fee and
    is created exactly once (unique `invoices.appointment_id` index; spec §4
    row 3 replaces the SQL transaction's atomicity with the guarded update +
    unique index)."""
    if user["role"] != UserRole.DOCTOR.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requires role: doctor")
    appointment = await _appointment_or_404(db, appointment_id)
    if appointment["doctor_id"] != await _doctor_profile_id(db, user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Not your appointment")
    if appointment["status"] not in (AppointmentStatus.BOOKED.value,
                                     AppointmentStatus.CONSULTED.value):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Appointment already {appointment['status']} - nothing to complete")

    result = await db["appointments"].update_one(
        {"_id": appointment_id,
         "status": {"$in": [AppointmentStatus.BOOKED.value,
                            AppointmentStatus.CONSULTED.value]}},
        {"$set": {"status": AppointmentStatus.COMPLETED.value}})
    if result.matched_count != 1:
        # Lost the guarded race: report the current status, like the re-read
        # after the SQLA rollback did.
        current = await db["appointments"].find_one({"_id": appointment_id})
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Appointment already {current['status']} - nothing to complete")
    invoice = {
        "_id": await next_id("invoices"),
        "appointment_id": appointment_id,
        "patient_id": appointment["patient_id"],  # internal; not in InvoiceOut
        "total": settings.consultation_fee,
        "status": InvoiceStatus.UNPAID.value,
        "created_at": utcnow(),
    }
    # The status move and the invoice are two awaits with no transaction, so
    # brief Atlas hiccups between them used to strand a completed appointment
    # without its derived invoice, with no repair path. Retry instead — the
    # unique invoices.appointment_id index keeps each retry idempotent.
    for attempt in range(3):
        try:
            await db["invoices"].insert_one(invoice)
            break
        except DuplicateKeyError:
            # Invoice already derived by a concurrent completion — keep one.
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Appointment already completed") from None
        except PyMongoError:
            if attempt == 2:
                raise
            await asyncio.sleep(0.5)
    return await _out(
        db, await db["appointments"].find_one({"_id": appointment_id}),
        detail=True)