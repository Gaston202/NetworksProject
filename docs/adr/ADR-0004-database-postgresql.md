# ADR-0004: Database — MongoDB Atlas

- **Status:** Accepted (reverses the 2026-09-25 PostgreSQL decision — edited in place)
- **Date:** 2026-09-25 (original); reversed 2026-10-02
- **Deciders:** Project owner, Claude

## Context

Hospital data (patients, appointments, prescriptions, staff) is strongly relational
in its original framing: candidates were PostgreSQL, MongoDB, MySQL/MariaDB.
PostgreSQL was chosen 2026-09-25 (co-located on the VM, SQLAlchemy + Alembic,
transactional invariants). On 2026-10-02 the owner reversed the decision on two
grounds: **simpler VM operations** (the database becomes a connection string — no
install, service, or snapshot tooling on `hms-server`) and **learning MongoDB** in
a real codebase, within the three-week demo window.

## Decision

**MongoDB Atlas** (cluster `cluster0.bgop6.mongodb.net`, `mongodb+srv://`), the
single database for development and deployment — no local fallback. FastAPI
accesses it via **Motor** (async driver) with all endpoints `async def`. Integer
ids are minted from a `counters` collection so API paths, Pydantic schemas, the
frontend, and the e2e suite are unchanged. No multi-document transactions
(Atlas M0): invariants ride single-document atomicity + unique indexes:

| Invariant (from domain-model §) | Enforcement now |
|---|---|
| Slot exclusivity (1/2) | `appointments.slot_id` unique **sparse** index; cancel = one atomic update setting `status=cancelled` and `$unset`ting `slot_id` (the slot keeps `original_slot_id` for responses) |
| One consultation per appointment, while booked (4) | one atomic guarded update (`status: "booked"`, `consultation: { $exists: false }`) embedding the subdocument |
| Invoice derived exactly once (5) | unique `invoices.appointment_id` index after the guarded completion update; duplicate → `409 "Appointment already completed"` |
| Email / department-name / one-profile-per-user uniqueness | plain unique indexes; `DuplicateKeyError` → the same 409s |
| Overlapping slot pre-check (§4 row 6) | same pre-check, plus the unique `{doctor_id, starts_at}` index as a new exact-duplicate race guard |

## Consequences

- No server-side schema or migrations: `app/db/indexes.py` ensures the indexes
  idempotently at startup.
- The database leaves the VM: deployment needs outbound TCP/27017 with TLS + SRV
  discovery, and the VM's public IP must be in the Atlas network allow-list
  (`0.0.0.0/0` is the documented demo-day fallback).
- `pg_dump/pg_restore` snapshots become "drop `hms` + re-seed"; `mongodump`
  remains optional.
- Accepted denormalizations (documented, spec §3): slot times copied onto
  appointments at booking (join-free displays), `invoices.patient_id` copied at
  completion (dissolves the billing join — not exposed in the response), and the
  consultation embedded in the appointment. No copies of user names/emails —
  directory joins are two-query id-maps, so renames flow through.
- Two writes in register/staff (user, then profile) are not one transaction in
  Atlas M0: a crash between them leaves a profile-less user, blocked only by the
  email unique index. Accepted demo-scope limitation, same class as ADR-0002's
  plain-HTTP note.
- `e2e_smoke.py` (31 assertions) is the acceptance harness; it passed unchanged
  immediately after the migration.

## Related

- [ADR-0003](ADR-0003-backend-stack-fastapi.md)