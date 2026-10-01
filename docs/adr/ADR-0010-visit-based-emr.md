# ADR-0010: Medical records — visit-based consultations (EMR-lite)

- **Status:** Accepted (revised 2026-10-01 — vitals removed with the nurse role;
  prescriptions are free text)
- **Date:** 2026-09-25 (revised 2026-10-01)
- **Deciders:** Project owner, Claude

## Context

EMR depth: minimal free-text notes, visit-based records, or a full patient chart
(allergies, history, attachments). Originally the visit flow had a nurse record
vitals before the doctor's consultation; the 2026-10-01 role cut (ADR-0007) removed
the nurse, and the owner chose to drop vitals entirely rather than absorb them.

## Decision

**Visit-based.** A `Consultation` record is attached to each appointment. The
clinical flow per appointment:

1. **Doctor** records **diagnosis** (text), **notes** (text), and optionally a
   **prescription** — free text (medications + dosage + instructions); no structured
   items (ADR-0013 withdrawal)
2. A patient's record timeline = their consultations, newest first

No vitals table, no chart header (allergies/history/attachments) in v1.

## Consequences

- One clinical write per visit, owned by the appointment's doctor — simpler write
  rules than the original nurse→doctor two-step (vital checks were the RBAC demo
  beat; the doctor/patient ownership checks replace it).
- The consultation is complete when written; there is no second clinical role to
  fill in context before it.
- If time allows, a `Patient.allergies` free-text field is a cheap, defensible
  addition — flag it in the report if added.

## Related

- [ADR-0008](ADR-0008-module-scope-v1.md)
- [ADR-0009](ADR-0009-appointment-model.md)