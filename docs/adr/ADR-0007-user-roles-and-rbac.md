# ADR-0007: User roles and RBAC — five personas

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

First-version role scope. The owner specified five roles: doctors, patients,
administration, nurses, and pharmacist (no receptionist persona — front-desk duties
fall to Admin).

## Decision

| Role | Primary capabilities |
|------|---------------------|
| **Admin** | Register/manage users, departments, schedule management, front-desk booking |
| **Doctor** | View/manage own appointments, write consultations, prescribe |
| **Nurse** | Record vitals, triage support, view assigned patients |
| **Pharmacist** | View prescriptions, dispense, manage pharmacy stock |
| **Patient** | Register, book/manage own appointments, view own records |

- RBAC is enforced server-side (FastAPI role guards); the frontend hides/disables UI
  per role but is never the source of truth.
- One role per user account (no multi-role accounts in v1).

## Consequences

- Five login personas to seed for the demo (one demo account per role).
- A patient's data access is restricted to their own records — a per-row ownership
  check, not just a role check (worth demonstrating in the report).
- No receptionist role: appointment scheduling on behalf of walk-ins is an Admin
  capability.

## Related

- [ADR-0006](ADR-0006-authentication-jwt.md)