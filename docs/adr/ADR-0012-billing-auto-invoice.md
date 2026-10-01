# ADR-0012: Billing — automatic invoice per visit

- **Status:** Accepted (revised 2026-10-01 — line items removed; invoice total is
  the consultation fee)
- **Date:** 2026-09-25 (revised 2026-10-01)
- **Deciders:** Project owner, Claude

## Context

Billing options: automatic per-visit invoice, manual admin invoices, or a flat
per-visit fee. Originally invoices had line items (consultation fee + dispensed
medications). The 2026-10-01 role cut withdrew the pharmacy module (ADR-0013), so
the only charge source left is the consultation fee — a single-row line-items table
became dead weight.

## Decision

**An `Invoice` is created automatically when an appointment is completed.** It is a
single row: `appointment_id` (unique), `total`, `status`, `created_at`.

- `total` = the configured consultation fee (settings/seed).
- Invoice statuses: `unpaid` → `paid` (Admin marks paid; no partial payments in v1).
- No `invoice_line_items` table in the three-role scope.

## Consequences

- Billing is *derived* from the visit, not authored by hand — one less screen, and
  the demo shows modules integrating (appointment completes → invoice appears).
- Admin gets a billing view: invoices, mark-paid action.
- Fee changes between visits are fine — each invoice stores its own total
  (`price captured on the invoice`, same spirit as the old price-at-dispense rule).
- Re-adding charge sources in v2 means re-introducing a line-items table.

## Related

- [ADR-0013](ADR-0013-pharmacy-stock-integration.md)
- [ADR-0008](ADR-0008-module-scope-v1.md)