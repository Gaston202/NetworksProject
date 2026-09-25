# ADR-0009: Appointment model — availability slots + self-booking

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

Three candidate flows: patients self-book from doctor-defined slots, Admin books for
everyone, or a request-then-confirm queue.

## Decision

**Doctors define availability slots** (a date + start/end time, or a recurring
schedule that generates slot rows). **Patients book themselves** into a free slot.
**Admin can also book** on behalf of walk-ins.

Invariants:

- A slot holds at most one appointment (uniqueness constraint).
- A patient can see only their own appointments (ownership check).
- Cancellation frees the slot; the appointment keeps history (status changes, no row
  deletion).

Appointment statuses: `booked`, `completed`, `cancelled`, `no_show`.

## Consequences

- Slot generation: v1 keeps it simple — doctor creates slot rows explicitly
  (optionally in bulk: "Mon 09:00–12:00 for next 4 weeks").
- Double-booking is prevented at the database level, not just the UI.
- The booking race (two patients, one slot) is handled by the unique constraint +
  transaction, a nice concurrency talking point for the report.

## Related

- [ADR-0007](ADR-0007-user-roles-and-rbac.md)
- [ADR-0008](ADR-0008-module-scope-v1.md)