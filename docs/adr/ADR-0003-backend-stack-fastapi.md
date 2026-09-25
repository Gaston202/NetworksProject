# ADR-0003: Backend stack — Python + FastAPI

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

Candidate stacks for the Ubuntu Server VM: Node.js + Express (the owner's primary
stack), Python + FastAPI, Python + Django (+DRF).

## Decision

**FastAPI**, served by uvicorn under systemd.

Rationale:

- Auto-generated OpenAPI/Swagger UI at `/docs` is a strong live-demo asset.
- Pydantic enforces request/response validation at the boundary.
- Async-friendly, lightweight footprint for a small VM.

## Consequences

- Domain models use SQLModel or SQLAlchemy + Pydantic schemas.
- Migrations via Alembic.
- The owner will be learning Python backend idioms rather than Node patterns —
  trade-off accepted for the demo value of Swagger.
- Runtime is managed as a `systemd` service (`hms-api.service`), not a bare shell.

## Related

- [ADR-0002](ADR-0002-deployment-topology-two-vms.md)
- [ADR-0004](ADR-0004-database-postgresql.md)