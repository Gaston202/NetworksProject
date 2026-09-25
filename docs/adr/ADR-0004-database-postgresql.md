# ADR-0004: Database — PostgreSQL

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

Hospital data (patients, appointments, prescriptions, staff) is strongly relational
with referential-integrity requirements. Candidates: PostgreSQL, MongoDB,
MySQL/MariaDB.

## Decision

**PostgreSQL**, installed on the same `hms-server` VM as the backend API. FastAPI
accesses it via SQLAlchemy/SQLModel. Schema changes are managed with Alembic
migrations.

## Consequences

- Foreign keys, constraints, and transactions are available where the domain needs
  them (e.g., an appointment cannot exist without its patient and doctor).
- Demo snapshots are cheap: `pg_dump` / `pg_restore` to seed or reset state.
- The database runs co-located with the API, so only the backend VM needs the
  PostgreSQL port — it stays off the network to other VMs.
- MongoDB's schema flexibility was rejected as unnecessary for this domain.

## Related

- [ADR-0003](ADR-0003-backend-stack-fastapi.md)