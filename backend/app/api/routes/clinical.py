"""Clinical records: consultations written by doctors (ADR-0010).

Prescriptions are free text on the consultation (pharmacy withdrawn from v1,
ADR-0013). Only the appointment's own doctor may write its consultation
(domain-model invariant 4).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_sqla as get_current_user, \
    require_role_sqla as require_role
from app.db.base import get_db
from app.models import (
    Appointment,
    AppointmentStatus,
    Consultation,
    DoctorProfile,
    PatientProfile,
    User,
    UserRole,
)
from app.schemas import ConsultationCreateIn, ConsultationOut

router = APIRouter()


def _doctor_profile_id(db: Session, user: User) -> int:
    profile = db.query(DoctorProfile).filter(DoctorProfile.user_id == user.id).first()
    if profile is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Account has no doctor profile")
    return profile.id


@router.post("/appointments/{appointment_id}/consultation",
             response_model=ConsultationOut,
             status_code=status.HTTP_201_CREATED, tags=["clinical"])
def write_consultation(appointment_id: int, payload: ConsultationCreateIn,
                       db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """Doctor writes the consultation (diagnosis + notes + optional Rx text) for
    their own appointment; the appointment moves `booked → consulted`. One
    consultation per appointment (unique constraint)."""
    if user.role != UserRole.DOCTOR.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requires role: doctor")
    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")
    if appointment.doctor_id != _doctor_profile_id(db, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your appointment")
    if appointment.status != AppointmentStatus.BOOKED.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Appointment is {appointment.status} - consultations are written "
            "while booked")

    consultation = Consultation(
        appointment_id=appointment.id,
        diagnosis=payload.diagnosis,
        notes=payload.notes,
        prescription=payload.prescription,
    )
    appointment.status = AppointmentStatus.CONSULTED.value
    db.add(consultation)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Appointment already has a consultation") from None
    db.refresh(consultation)
    return consultation


@router.get("/consultations", response_model=list[ConsultationOut],
            tags=["clinical"])
def list_consultations(db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """Role-scoped timeline, newest first: a patient reads only their own
    consultations (the patient-record view, ADR-0010)."""
    if user.role == UserRole.PATIENT.value:
        profile = db.query(PatientProfile).filter(
            PatientProfile.user_id == user.id).first()
        if profile is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Account has no patient profile")
        query = db.query(Consultation).join(
            Appointment, Appointment.id == Consultation.appointment_id
        ).filter(Appointment.patient_id == profile.id)
    elif user.role == UserRole.DOCTOR.value:
        profile = db.query(DoctorProfile).filter(
            DoctorProfile.user_id == user.id).first()
        if profile is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Account has no doctor profile")
        query = db.query(Consultation).join(
            Appointment, Appointment.id == Consultation.appointment_id
        ).filter(Appointment.doctor_id == profile.id)
    elif user.role == UserRole.ADMIN.value:
        query = db.query(Consultation)
    else:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    return query.order_by(Consultation.created_at.desc()).all()