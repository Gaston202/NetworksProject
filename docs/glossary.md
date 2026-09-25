# HMS Glossary — Ubiquitous Language

The single source of truth for domain terms in code, API paths, UI, and docs. When
code says `Consultation`, docs say *consultation* — never "medical record entry."

## People

| Term | Meaning |
|------|---------|
| **User** | Any authenticated account. Has exactly one **Role**. |
| **Role** | One of: `admin`, `doctor`, `nurse`, `pharmacist`, `patient`. Enforced server-side (ADR-0007). |
| **Admin** | Manages users, departments, walk-in booking, invoices. Acts as front desk. |
| **Doctor** | Clinical staff member. Belongs to one Department, owns Availability Slots, writes Consultations. |
| **Nurse** | Clinical staff member. Records Vitals for an appointment. |
| **Pharmacist** | Dispenses Prescriptions and manages Medication stock. |
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
| **Appointment status** | `booked` → `completed` \| `cancelled` \| `no_show`. Cancelled appointments free their slot. |

## Clinical

| Term | Meaning |
|------|---------|
| **Visit** | Informal term for the appointment + its clinical record, end to end. |
| **Consultation** | The doctor's clinical record of a visit: diagnosis (text), notes (text), optional Prescription. One per appointment. |
| **Vitals** | Nurse-recorded measurements for an appointment: blood pressure, temperature, pulse, weight, etc. |
| **Prescription** | The medication list attached to a consultation. |
| **Prescription Item** | One medication in a prescription: medication, dose, frequency, duration. |
| **Dispensing** | Pharmacist fulfilling a prescription item; decrements stock and bills the item (ADR-0012/0013). |

## Pharmacy

| Term | Meaning |
|------|---------|
| **Medication** | Stockable drug: name, unit price, stock quantity, low-stock threshold. |
| **Restock** | Adding quantity to a medication's stock. |
| **Low stock** | Quantity at or below its threshold — surfaced as a warning, not a block. |

## Billing

| Term | Meaning |
|------|---------|
| **Invoice** | Auto-created per completed appointment. Never hand-authored. |
| **Invoice Line Item** | One charged entry: the consultation fee, or one dispensed medication at its price at dispense time. |
| **Invoice status** | `unpaid` → `paid` (Admin action). No partial payments in v1. |

## Antonym rule

"Record" alone is ambiguous — say **Consultation** (clinical content of a visit) or
**Patient** (the person). "Booking" and "Appointment" mean the same thing; use
**Appointment** in code and API paths.