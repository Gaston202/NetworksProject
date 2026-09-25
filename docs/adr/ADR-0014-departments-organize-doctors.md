# ADR-0014: Departments organize doctors

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

Should doctors be a flat searchable list, or grouped into hospital departments
(Cardiology, Pediatrics, …)?

## Decision

**`Department` is a first-class entity.** Admin creates/manages departments; each
doctor belongs to exactly one department; patients browse departments → doctors →
free slots when booking.

## Consequences

- One more admin screen and one more booking filter — accepted for a more realistic
  domain model.
- A doctor belongs to one department only in v1 (no multi-department doctors).
- Department deletion with assigned doctors is blocked (or requires reassignment) —
  referential integrity is demonstrated, not assumed.

## Related

- [ADR-0009](ADR-0009-appointment-model.md)