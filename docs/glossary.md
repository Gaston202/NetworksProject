# HMS Glossary — Ubiquitous Language

The single source of truth for domain terms in code, API paths, UI, and docs. When
code says `Consultation`, docs say *consultation* — never "medical record entry."

Three-role scope (ADR-0007): `admin`, `doctor`, `patient` — cut 2026-10-01 from the
original five-role plan (nurse and pharmacist work removed).

## People

| Term | Meaning |
|------|---------|
| **User** | Any authenticated account. Has exactly one **Role**. |
| **Role** | One of: `admin`, `doctor`, `patient`. Enforced server-side (ADR-0007). |
| **Admin** | Manages users, departments, walk-in booking, invoices. Acts as front desk. |
| **Doctor** | Clinical staff member. Belongs to one Department, owns Availability Slots, writes Consultations. |
| **Patient** | Person receiving care. Books own appointments; sees only their own data. |

## Organization

| Term | Meaning |
|------|---------|
| **Department** | Hospital unit (e.g., Cardiology) grouping doctors. Managed by Admin. |

## Scheduling

| Term | Meaning |
|------|---------|
| **Availability Slot** | A doctor's bookable time window (one patient max). Created by the doctor (or Admin on their behalf). |
| **Appointment** | A patient's booking of one slot. Cannot exist without its slot, patient, and doctor. |
| **Appointment status** | `booked` → `consulted` → `completed` \| `cancelled` \| `no_show`. Cancelled appointments free their slot. |

## Clinical

| Term | Meaning |
|------|---------|
| **Visit** | Informal term for the appointment + its clinical record, end to end. |
| **Consultation** | The doctor's clinical record of a visit: diagnosis (text), notes (text), optional Prescription (free text). One per appointment. |
| **Prescription** | Medication instructions written as free text on a consultation — no items, no stock tracking in the three-role scope (ADR-0013). |

## Billing

| Term | Meaning |
|------|---------|
| **Invoice** | Auto-created per completed appointment; its total is the consultation fee. Never hand-authored. |
| **Invoice status** | `unpaid` → `paid` (Admin action). No partial payments in v1. |

## Antonym rule

"Record" alone is ambiguous — say **Consultation** (clinical content of a visit) or
**Patient** (the person). "Booking" and "Appointment" mean the same thing; use
**Appointment** in code and API paths.