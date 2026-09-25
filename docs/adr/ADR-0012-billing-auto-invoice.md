# ADR-0012: Billing — automatic invoice per visit

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

Billing options: automatic per-visit invoice, manual admin invoices, or a flat
per-visit fee.

## Decision

**An `Invoice` is created automatically when an appointment is completed.** Line
items:

1. **Consultation fee** — added automatically (a configured default fee).
2. **Dispensed medications** — each dispensed prescription item adds a line item at
   the medication's current price.

Invoice statuses: `unpaid` → `paid` (Admin marks paid; no partial payments in v1).

## Consequences

- Billing is *derived* from the visit, not authored by hand — one less screen, and
  the demo shows modules integrating (appointment → dispense → invoice).
- Medication price is captured at dispense time onto the invoice line (later price
  changes don't rewrite history).
- Admin gets a billing dashboard: unpaid invoices, mark-paid action.
- If no dispensing happened, the invoice is just the consultation fee.

## Related

- [ADR-0013](ADR-0013-pharmacy-stock-integration.md)
- [ADR-0008](ADR-0008-module-scope-v1.md)