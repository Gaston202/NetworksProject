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

- Data access is **Motor** (async MongoDB driver, ADR-0004); Pydantic enforces request/response shapes at the boundary; endpoints are `async def`.
- No schema migrations: `app/db/indexes.py` ensures MongoDB's unique indexes at startup (idempotent).
- The owner will be learning Python backend idioms rather than Node patterns —
  trade-off accepted for the demo value of Swagger.
- Runtime is managed as a `systemd` service (`hms-api.service`), not a bare shell.

## Related

- [ADR-0002](ADR-0002-deployment-topology-two-vms.md)
- [ADR-0004](ADR-0004-database-postgresql.md)