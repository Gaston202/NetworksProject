# ADR-0007: User roles and RBAC — three personas

- **Status:** Accepted (revised 2026-10-01 — was five personas; scope cut in place,
  see below)
- **Date:** 2026-09-25 (revised 2026-10-01)
- **Deciders:** Project owner, Claude

## Context

First-version role scope. The owner originally specified five roles: doctors,
patients, administration, nurses, and pharmacist (no receptionist persona —
front-desk duties fall to Admin). On 2026-10-01 the owner cut the scope to three
roles: doctors, patients, and administration — removing all nurse (vitals) and
pharmacist (pharmacy/stock/dispensing) work to focus remaining effort on the server
and a reliable demo (per ADR-0001: feature breadth is subordinate to the demo).

## Decision

| Role | Primary capabilities |
|------|---------------------|
| **Admin** | Register/manage users, departments, schedule management, front-desk (walk-in) booking, billing |
| **Doctor** | View/manage own appointments, write consultations, prescribe (free text) |
| **Patient** | Register, book/manage own appointments, view own records |

- RBAC is enforced server-side (FastAPI role guards); the frontend hides/disables UI
  per role but is never the source of truth.
- One role per user account (no multi-role accounts in v1).

## Consequences

- Three login personas to seed for the demo (one demo account per role).
- A patient's data access is restricted to their own records — a per-row ownership
  check, not just a role check (worth demonstrating in the report).
- No receptionist role: appointment scheduling on behalf of walk-ins is an Admin
  capability.
- Vitals recording and pharmacy work have no owner in v1 — both were removed
  entirely rather than absorbed (see ADR-0008, ADR-0013).
- Deactivated accounts (`User.is_active = false`, set by Admin) are refused at
  authentication time.

## Related

- [ADR-0006](ADR-0006-authentication-jwt.md)
- [ADR-0008](ADR-0008-module-scope-v1.md)