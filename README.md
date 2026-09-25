# Hospital Management System (HMS)

A two-VM hospital management system for a networks course: a FastAPI + PostgreSQL
backend on Ubuntu Server, a React SPA served by nginx on Ubuntu Desktop, talking
over a VirtualBox NAT network.

**Status:** planning complete (ADRs + domain model done) — implementation not
started. See the [roadmap](docs/roadmap.md).

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/domain-model.md](docs/domain-model.md) | Entities, relationships, invariants |
| [docs/glossary.md](docs/glossary.md) | Ubiquitous language — the terms the code must use |
| [docs/adr/](docs/adr/) | 15 architecture decision records (accepted) |
| [docs/network-topology.md](docs/network-topology.md) | VMs, IPs, ports, traffic flows (graded) |
| [docs/demo-walkthrough.md](docs/demo-walkthrough.md) | Live demo script (graded) |
| [docs/roadmap.md](docs/roadmap.md) | 4-week build order with exit criteria |

## The one-paragraph pitch

Patients book doctor slots from a department browser; nurses record vitals; doctors
consult and prescribe; pharmacists dispense against stock; invoices are derived
automatically from the visit. Five roles, JWT auth, PostgreSQL, all demonstrated
across two Ubuntu VMs over plain HTTP.

## Layout (planned)

```
backend/    FastAPI + uvicorn + SQLAlchemy + Alembic
frontend/   React + Vite + TypeScript + Tailwind (static build for nginx)
deploy/     provisioning + deploy scripts per VM
docs/       the documents above
```

See [ADR-0015](docs/adr/ADR-0015-monorepo-layout.md) for the rationale.