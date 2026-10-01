# HMS Domain Model

Entities, relationships, and invariants for v1 in the three-role scope (ADR-0007,
ADR-0008). Terms are defined in the [glossary](glossary.md).

## Entity map

```mermaid
erDiagram
    USER ||--o| DOCTOR_PROFILE : "may have"
    USER ||--o| PATIENT_PROFILE : "may have"
    DEPARTMENT ||--o{ DOCTOR_PROFILE : "groups"
    DOCTOR_PROFILE ||--o{ AVAILABILITY_SLOT : "offers"
    AVAILABILITY_SLOT ||--o| APPOINTMENT : "holds at most one"
    PATIENT_PROFILE ||--o{ APPOINTMENT : "books"
    APPOINTMENT ||--o| CONSULTATION : "produces"
    APPOINTMENT ||--o| INVOICE : "billed by"
```

## Entities

| Entity | Key fields | Notes |
|--------|-----------|-------|
| `User` | id, full_name, email, password_hash, role, is_active | All three roles are users. |
| `DoctorProfile` | user_id, department_id, specialty | 1:1 with a doctor User. |
| `PatientProfile` | user_id, date_of_birth, phone, address | 1:1 with a patient User. |
| `Department` | id, name | Owned by Admin. |
| `AvailabilitySlot` | id, doctor_id, starts_at, ends_at | Generated from a doctor's schedule. |
| `Appointment` | id, slot_id (unique), patient_id, doctor_id, status | Status: `booked`/`consulted`/`completed`/`cancelled`/`no_show`. |
| `Consultation` | id, appointment_id, diagnosis, notes, prescription | Written by the appointment's doctor; prescription is free text. |
| `Invoice` | id, appointment_id (unique), total, status | Created on `completed`; total = consultation fee; status `unpaid`/`paid`. |

## Invariants (enforced by the backend + database)

1. **Slot exclusivity** — one appointment per slot (unique constraint).
2. **Booking race safety** — booking happens in a transaction; a lost race returns
   "slot taken," never a duplicate.
3. **Ownership** — a patient reads only their own appointments, consultations,
   invoices (per-row check, not just role check).
4. **Clinical write rules** — only the appointment's own doctor writes its
   consultation.
5. **Derived billing** — invoices exist only because a visit completed; the total is
   the consultation fee; no hand-authored invoices.
6. **Referential safety** — a department with doctors can't be deleted; a slot with
   an appointment can't be deleted.

## Visit lifecycle (the demo's happy path)

```mermaid
stateDiagram-v2
    [*] --> SlotOffered: doctor defines availability
    SlotOffered --> Booked: patient (or admin) books
    Booked --> Cancelled: cancelled (slot freed)
    Booked --> Consulted: doctor writes consultation + Rx text
    Consulted --> Completed: appointment completed (slot consumed)
    Completed --> Invoiced: invoice auto-created (consultation fee)
    Invoiced --> Paid: admin marks paid
    Paid --> [*]
```

## Cross-cutting

- **Auth** — JWT with role claim; endpoint guards per role (ADR-0006).
- **Patient self-visibility** — enforced in query filters, not just route guards.
- **Audit trail** — out of scope for v1; consultation and invoice timestamps are the
  only historical records. Flag as v2 work.