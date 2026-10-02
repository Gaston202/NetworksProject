"""Departments, doctors, slots, and appointments (ADR-0007/0008/0009).

All ownership rules are per-row: patient appointments only through their own
profile id, doctor consultation writes only for their own appointments
(domain-model invariant 3/4). Booking is race-safe via the DB's partial unique
index on active appointments (invariant 1/2).
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_sqla as get_current_user, \
    require_role_sqla as require_role
from app.core.config import settings
from app.db.base import get_db
from app.models import (
    Appointment,
    AppointmentStatus,
    AvailabilitySlot,
    Department,
    DoctorProfile,
    Invoice,
    InvoiceStatus,
    PatientProfile,
    User,
    UserRole,
)
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

def _patient_profile_id(db: Session, user: User) -> int:
    """Profile id of the logged-in patient; patients without a profile can't act."""
    profile = db.query(PatientProfile).filter(
        PatientProfile.user_id == user.id).first()
    if profile is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Account has no patient profile")
    return profile.id


def _doctor_profile_id(db: Session, user: User) -> int:
    profile = db.query(DoctorProfile).filter(
        DoctorProfile.user_id == user.id).first()
    if profile is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Account has no doctor profile")
    return profile.id


def _slot_or_404(db: Session, slot_id: int) -> AvailabilitySlot:
    slot = db.get(AvailabilitySlot, slot_id)
    if slot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Slot not found")
    return slot


def _appointment_or_404(db: Session, appointment_id: int) -> Appointment:
    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")
    return appointment


def _out(db: Session, appointment: Appointment, detail: bool) -> dict:
    """Appointment dict with slot times, and relations when `detail`."""
    slot = db.get(AvailabilitySlot, appointment.slot_id)
    data = {
        "id": appointment.id,
        "slot_id": appointment.slot_id,
        "patient_id": appointment.patient_id,
        "doctor_id": appointment.doctor_id,
        "status": appointment.status,
        "starts_at": slot.starts_at,
        "ends_at": slot.ends_at,
        "created_at": appointment.created_at,
    }
    if detail:
        data["consultation"] = appointment.consultation
        data["invoice"] = appointment.invoice
    return data


# --- Departments (managed by Admin) ----------------------------------------

@router.get("/departments", response_model=list[DepartmentOut],
            tags=["scheduling"],
            summary="List departments (authenticated users)")
def list_departments(db: Session = Depends(get_db),
                     _user: User = Depends(get_current_user)):
    return db.query(Department).order_by(Department.name).all()


@router.post("/departments", response_model=DepartmentOut,
             status_code=status.HTTP_201_CREATED, tags=["scheduling"])
def create_department(payload: DepartmentCreateIn, db: Session = Depends(get_db),
                      _admin: User = Depends(require_role(UserRole.ADMIN))):
    if db.query(Department).filter(Department.name == payload.name).first():
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Department name already exists")
    department = Department(name=payload.name)
    db.add(department)
    db.commit()
    db.refresh(department)
    return department


@router.patch("/departments/{department_id}", response_model=DepartmentOut,
              tags=["scheduling"])
def rename_department(department_id: int, payload: DepartmentRenameIn,
                      db: Session = Depends(get_db),
                      _admin: User = Depends(require_role(UserRole.ADMIN))):
    department = db.get(Department, department_id)
    if department is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")
    clash = db.query(Department).filter(
        Department.name == payload.name, Department.id != department_id).first()
    if clash:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Department name already exists")
    department.name = payload.name
    db.commit()
    db.refresh(department)
    return department


@router.delete("/departments/{department_id}",
               status_code=status.HTTP_204_NO_CONTENT, tags=["scheduling"])
def delete_department(department_id: int, db: Session = Depends(get_db),
                      _admin: User = Depends(require_role(UserRole.ADMIN))):
    """Invariant 6: a department with doctors assigned can't be deleted."""
    department = db.get(Department, department_id)
    if department is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")
    if db.query(DoctorProfile).filter(
            DoctorProfile.department_id == department_id).first():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Department has doctors assigned - reassign them first")
    db.delete(department)
    db.commit()


# --- Doctors (booking browse) ----------------------------------------------

@router.get("/doctors", response_model=list[DoctorOut], tags=["scheduling"])
def list_doctors(department_id: int | None = None,
                 db: Session = Depends(get_db),
                 _user: User = Depends(get_current_user)):
    """Doctor directory for the booking flow (ADR-0007)."""
    query = db.query(DoctorProfile, User).join(User, User.id == DoctorProfile.user_id)
    if department_id is not None:
        query = query.filter(DoctorProfile.department_id == department_id)
    return [
        DoctorOut(
            id=profile.id,
            full_name=user.full_name,
            email=user.email,
            department_id=profile.department_id,
            department_name=profile.department.name if profile.department else None,
            specialty=profile.specialty,
        )
        for profile, user in query.all()
    ]


# --- Slots ------------------------------------------------------------------

@router.get("/doctors/{doctor_id}/slots", response_model=list[SlotOut],
            tags=["scheduling"])
def list_doctor_slots(doctor_id: int,
                      free_only: bool = Query(default=False, alias="free"),
                      db: Session = Depends(get_db),
                      _user: User = Depends(get_current_user)):
    """Slots for one doctor. `?free=true` returns only bookable slots."""
    if db.get(DoctorProfile, doctor_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Doctor not found")
    query = db.query(AvailabilitySlot).filter(
        AvailabilitySlot.doctor_id == doctor_id
    ).order_by(AvailabilitySlot.starts_at)
    if free_only:
        booked = [row[0] for row in db.query(Appointment.slot_id)
                  .filter(Appointment.status != AppointmentStatus.CANCELLED.value)]
        query = query.filter(AvailabilitySlot.id.not_in(booked))
    booked_slot_ids = set(
        row[0] for row in db.query(Appointment.slot_id)
        .filter(Appointment.status != AppointmentStatus.CANCELLED.value))
    return [
        SlotOut(
            id=slot.id, doctor_id=slot.doctor_id,
            starts_at=slot.starts_at, ends_at=slot.ends_at,
            is_free=slot.id not in booked_slot_ids,
        )
        for slot in query.all()
    ]


def _overlaps(db: Session, doctor_profile_id: int,
              starts: datetime, ends: datetime) -> bool:
    """True if any existing slot overlaps [starts, ends) for this doctor."""
    return db.query(AvailabilitySlot).filter(
        AvailabilitySlot.doctor_id == doctor_profile_id,
        AvailabilitySlot.starts_at < ends,
        AvailabilitySlot.ends_at > starts).first() is not None


@router.post("/doctors/{doctor_id}/slots",
             response_model=list[SlotOut],
             status_code=status.HTTP_201_CREATED, tags=["scheduling"])
def create_slots(doctor_id: int, payload: SlotBulkIn, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    """Bulk-create a daily window of slots. Admin may target any doctor; a doctor
    may only target their own availability (ADR-0009)."""
    if user.role == UserRole.DOCTOR.value:
        own = _doctor_profile_id(db, user)
        if own != doctor_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Doctors may only create their own slots")
    elif user.role != UserRole.ADMIN.value:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Requires one of: admin, doctor")
    if db.get(DoctorProfile, doctor_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Doctor not found")

    slots: list[AvailabilitySlot] = []
    for day in range(payload.days):
        base = datetime.combine(payload.first_date, datetime.min.time()) \
            + timedelta(days=day, hours=payload.start_hour, minutes=payload.start_minute)
        step = timedelta(minutes=payload.slot_minutes)
        for offset in range(int(payload.hours_per_day * 60) // payload.slot_minutes):
            start = base + offset * step
            slots.append(AvailabilitySlot(
                doctor_id=doctor_id, starts_at=start, ends_at=start + step))
    if not slots:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Window yields no slots")
    for slot in slots:
        if _overlaps(db, doctor_id, slot.starts_at, slot.ends_at):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Slot range {slot.starts_at:%Y-%m-%d %H:%M} overlaps existing slots - "
                "nothing created")
    db.add_all(slots)
    db.commit()
    return [
        SlotOut(id=slot.id, doctor_id=slot.doctor_id,
                starts_at=slot.starts_at, ends_at=slot.ends_at, is_free=True)
        for slot in slots
    ]


# --- Appointments -----------------------------------------------------------

@router.post("/appointments", response_model=AppointmentOut,
             status_code=status.HTTP_201_CREATED, tags=["appointments"])
def book_appointment(payload: AppointmentCreateIn, db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)):
    """Patients self-book; Admin books walk-ins by patient id (ADR-0009).

    Past slots are bookable on purpose — it is how the historic completed
    visit for the demo gets produced.
    """
    if user.role == UserRole.PATIENT.value:
        patient_id = _patient_profile_id(db, user)
    elif user.role == UserRole.ADMIN.value:
        if payload.patient_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "patient_id is required when booking as Admin (walk-in)")
        patient_id = payload.patient_id
        if db.get(PatientProfile, patient_id) is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "Patient not found")
    else:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Requires one of: admin, patient")

    slot = _slot_or_404(db, payload.slot_id)
    if db.query(Appointment).filter(
            Appointment.slot_id == payload.slot_id,
            Appointment.status != AppointmentStatus.CANCELLED.value).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Slot taken - pick another")

    appointment = Appointment(
        slot_id=payload.slot_id,
        patient_id=patient_id,
        doctor_id=slot.doctor_id,
        status=AppointmentStatus.BOOKED.value,
    )
    db.add(appointment)
    try:
        db.commit()
    except IntegrityError:
        # Invariant 2: a lost booking race returns "slot taken", never a duplicate.
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Slot taken - pick another") from None
    db.refresh(appointment)
    return _out(db, appointment, detail=False)


@router.get("/appointments", response_model=list[AppointmentOut],
            tags=["appointments"])
def list_appointments(status_filter: str | None = Query(default=None, alias="status"),
                      db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Role-scoped list: patients see their own, doctors their own, Admin all."""
    query = db.query(Appointment, AvailabilitySlot).join(
        AvailabilitySlot, AvailabilitySlot.id == Appointment.slot_id)
    if user.role == UserRole.PATIENT.value:
        profile = db.query(PatientProfile).filter(
            PatientProfile.user_id == user.id).first()
        if profile is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Account has no patient profile")
        query = query.filter(Appointment.patient_id == profile.id)
    elif user.role == UserRole.DOCTOR.value:
        profile = db.query(DoctorProfile).filter(
            DoctorProfile.user_id == user.id).first()
        if profile is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Account has no doctor profile")
        query = query.filter(Appointment.doctor_id == profile.id)
    elif user.role != UserRole.ADMIN.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    if status_filter:
        query = query.filter(Appointment.status == status_filter)
    rows = query.order_by(AvailabilitySlot.starts_at.desc()).all()
    return [
        AppointmentOut(**_out(db, appointment, detail=False))
        for appointment, _slot in rows
    ]


@router.get("/appointments/{appointment_id}", response_model=AppointmentDetailOut,
            tags=["appointments"])
def get_appointment(appointment_id: int, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    """Full appointment view (slot times + consultation + invoice).

    Ownership is checked per row: a patient may read only their own.
    """
    appointment = _appointment_or_404(db, appointment_id)
    if user.role == UserRole.PATIENT.value:
        if appointment.patient_id != _patient_profile_id(db, user):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Patients may only view their own appointments")
    elif user.role == UserRole.DOCTOR.value:
        if appointment.doctor_id != _doctor_profile_id(db, user):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Doctors may only view their own appointments")
    elif user.role != UserRole.ADMIN.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    return _out(db, appointment, detail=True)


@router.patch("/appointments/{appointment_id}/cancel", response_model=AppointmentOut,
              tags=["appointments"])
def cancel_appointment(appointment_id: int, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """Patients cancel their own future appointments; Admin cancels for anyone.

    Cancelling frees the slot for rebooking (partial unique index) and is only
    possible while the visit has not been completed.
    """
    appointment = _appointment_or_404(db, appointment_id)
    if user.role == UserRole.PATIENT.value:
        if appointment.patient_id != _patient_profile_id(db, user):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Patients may only cancel their own appointments")
        if appointment.status != AppointmentStatus.BOOKED.value:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Patients may only cancel while the appointment is booked")
    elif user.role == UserRole.ADMIN.value:
        if appointment.status in (AppointmentStatus.COMPLETED.value,
                                  AppointmentStatus.CANCELLED.value):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Appointment already {appointment.status}")
    else:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")

    appointment.status = AppointmentStatus.CANCELLED.value
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Slot taken - pick another") from None
    db.refresh(appointment)
    return _out(db, appointment, detail=False)


@router.patch("/appointments/{appointment_id}/complete",
              response_model=AppointmentDetailOut, tags=["appointments"])
def complete_appointment(appointment_id: int, db: Session = Depends(get_db),
                         user: User = Depends(get_current_user)):
    """Doctor-only transition `booked|consulted → completed`, which derives the
    invoice (ADR-0012, invariant 5) in the same transaction: invoice total is the
    configured consultation fee, created exactly once (unique constraint on
    appointment_id)."""
    if user.role != UserRole.DOCTOR.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requires role: doctor")
    appointment = _appointment_or_404(db, appointment_id)
    if appointment.doctor_id != _doctor_profile_id(db, user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Not your appointment")
    if appointment.status not in (AppointmentStatus.BOOKED.value,
                                  AppointmentStatus.CONSULTED.value):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Appointment already {appointment.status} - nothing to complete")

    appointment.status = AppointmentStatus.COMPLETED.value
    db.add(Invoice(appointment_id=appointment.id,
                   total=settings.consultation_fee,
                   status=InvoiceStatus.UNPAID.value))
    try:
        db.commit()
    except IntegrityError:
        # Invoice already derived by a concurrent completion — keep one invoice.
        db.rollback()
        db.refresh(appointment)
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Appointment already completed") from None
    db.refresh(appointment)
    return _out(db, appointment, detail=True)