# ADR-0010: Medical records — visit-based consultations (EMR-lite)

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

EMR depth: minimal free-text notes, visit-based records, or a full patient chart
(allergies, history, attachments).

## Decision

**Visit-based.** A `Consultation` record is attached to each appointment. The
clinical flow per appointment:

1. **Nurse** records **vitals** (blood pressure, temperature, pulse, weight, …)
2. **Doctor** records **diagnosis** (text), **notes** (text), and optionally a
   **prescription** (list of medications + dosage + duration)
3. A patient's record timeline = their consultations, newest first

No chart header (allergies/history/attachments) in v1.

## Consequences

- Vitals and consultation are separate writes by separate roles — good RBAC demo.
- A prescription is created in the context of a consultation, which is what the
  pharmacist sees when dispensing (ADR-0011 scope).
- If time allows, a `Patient.allergies` free-text field is a cheap, defensible
  addition — flag it in the report if added.

## Related

- [ADR-0008](ADR-0008-module-scope-v1.md)
- [ADR-0009](ADR-0009-appointment-model.md)