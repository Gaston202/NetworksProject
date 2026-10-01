# ADR-0013: Pharmacy — dispensing with full stock integration

- **Status:** Withdrawn (2026-10-01 — module left v1 scope with the role cut)
- **Date:** 2026-09-25 (withdrawn 2026-10-01)
- **Deciders:** Project owner, Claude

## Context

Pharmacy depth: dispensing-only, stock tracked separately, or dispensing coupled to
stock. The original plan accepted full stock integration to justify the pharmacist
role (ADR-0007). On 2026-10-01 the owner cut the roles to admin/doctor/patient —
the pharmacist was removed, and with it the module's only reason to exist.

## Decision (record of withdrawal)

**Full stock integration was accepted on 2026-09-25: the `Medication` entity carried
name, unit price, and `stock_quantity` with a low-stock threshold; dispensing
decremented stock atomically; zero stock was refused; dispensed items invoiced at
price-at-dispense time (ADR-0012).**

**Withdrawn 2026-10-01 with the three-role cut (ADR-0007):** the entire module is
removed from v1 — `medications`, `prescription_items` and `dispense_records` tables
dropped, no dispensing, no stock tracking. Prescriptions survive as free text on the
consultation (ADR-0010).

## Consequences

- No stock-honesty invariant in v1; the slot race and the atomic auto-invoice are
  the demo's concurrency talking points now.
- A structured prescription system (items, dispensing, stock) can be re-adopted in
  v2 by amending ADR-0008 — the withdrawn record above describes the accepted shape.
- The invoice simplifies to the consultation fee only (ADR-0012).

## Related

- [ADR-0007](ADR-0007-user-roles-and-rbac.md)
- [ADR-0008](ADR-0008-module-scope-v1.md)
- [ADR-0012](ADR-0012-billing-auto-invoice.md)