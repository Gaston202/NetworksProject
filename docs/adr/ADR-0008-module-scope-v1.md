# ADR-0008: Module scope for v1

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

A full HMS has many modules. V1 needed a scoped, demo-defensible set. Registration +
JWT login is implied in every option (ADR-0006/0007).

## Decision

V1 ships **four modules**:

1. **Appointments & scheduling** — availability slots, self-booking (ADR-0009)
2. **Medical records (EMR-lite)** — visit-based consultations (ADR-0010)
3. **Pharmacy** — prescriptions, dispensing, stock inventory
4. **Billing & invoicing** — invoices per visit

Out of scope for v1 (revisit after demo): lab tests, ward/bed management, patient
messaging, reporting dashboards, multi-branch support.

## Consequences

- The demo narrative covers the full visit lifecycle: book → vitals → consult →
  prescribe → dispense → pay. That is a strong end-to-end story for a networks demo.
- Four modules × five roles is a lot of UI; the frontend needs role-based navigation
  from day one.
- Scope discipline: features are only added by amending this ADR, never silently.

## Related

- [ADR-0009](ADR-0009-appointment-model.md)
- [ADR-0010](ADR-0010-visit-based-emr.md)