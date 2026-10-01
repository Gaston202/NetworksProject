# ADR-0008: Module scope for v1

- **Status:** Accepted (revised 2026-10-01 — Pharmacy module withdrawn; was four
  modules, now three)
- **Date:** 2026-09-25 (revised 2026-10-01)
- **Deciders:** Project owner, Claude

## Context

A full HMS has many modules. V1 needed a scoped, demo-defensible set. Registration +
JWT login is implied in every option (ADR-0006/0007). The original list had four
modules including Pharmacy. On 2026-10-01 the owner cut the roles to admin/doctor/
patient (ADR-0007) — Pharmacy existed to justify the pharmacist role, so it was
withdrawn with it.

## Decision

V1 ships **three modules**:

1. **Appointments & scheduling** — availability slots, self-booking (ADR-0009)
2. **Medical records (EMR-lite)** — visit-based consultations (ADR-0010)
3. **Billing & invoicing** — invoices per visit (ADR-0012)

The **Pharmacy module is withdrawn** (ADR-0013): prescriptions become free text on
the consultation, with no medication entities and no stock tracking.

Out of scope for v1 (revisit after demo): lab tests, ward/bed management, patient
messaging, reporting dashboards, multi-branch support — and pharmacy.

## Consequences

- The demo narrative covers the visit lifecycle: book → consult → prescribe (text)
  → complete → pay. That is a strong end-to-end story for a networks demo.
- Three modules × three roles keeps the frontend small enough to finish inside the
  remaining time.
- Scope discipline: features are only added by amending this ADR, never silently.

## Related

- [ADR-0009](ADR-0009-appointment-model.md)
- [ADR-0010](ADR-0010-visit-based-emr.md)