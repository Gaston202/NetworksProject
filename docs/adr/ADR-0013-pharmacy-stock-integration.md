# ADR-0013: Pharmacy — dispensing with full stock integration

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

Pharmacy depth: dispensing-only, stock tracked separately, or dispensing coupled to
stock. The pharmacist role exists (ADR-0007), so the module must justify it.

## Decision

**Full stock integration.** The `Medication` entity carries name, unit price, and
`stock_quantity` with a `low_stock_threshold`.

Workflow:

1. Pharmacist opens a prescription (from a consultation) and marks it
   **dispensed**.
2. Each dispensed item **decrements stock atomically**.
3. Dispensing an item with **zero stock is refused** by the backend.
4. Stock below the threshold raises a low-stock warning in the pharmacist UI.
5. Dispensed items are added to the visit's invoice (ADR-0012).

Stock inflows: Pharmacist (or Admin) records a restock (add quantity) — no purchase
orders in v1.

## Consequences

- Stock decrement and prescription status change share one transaction — a
  concurrency/demonstration point (can't oversell stock).
- No stock movement ledger in v1: current quantity only, restocks overwrite upward.
  Acceptable; noted as a v2 improvement (append-only `stock_movements` table).

## Related

- [ADR-0010](ADR-0010-visit-based-emr.md)
- [ADR-0012](ADR-0012-billing-auto-invoice.md)