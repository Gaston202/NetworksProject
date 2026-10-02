# Hospital Management System (HMS)

A client–server hospital management system for a networks course: one Ubuntu
Server VM (`LabServer`) runs nginx (React SPA + reverse proxy) in front of a
FastAPI backend backed by MongoDB Atlas; two Ubuntu Desktop clients, one per user
role, use it over a VirtualBox internal network (ADR-0016).

**Status:** building. Auth core, schema, and seed are done; the three-role server
API (appointments, clinical, billing, admin) is in progress — see the
[roadmap](docs/roadmap.md).

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/domain-model.md](docs/domain-model.md) | Entities, relationships, invariants |
| [docs/glossary.md](docs/glossary.md) | Ubiquitous language — the terms the code must use |
| [docs/adr/](docs/adr/) | 16 architecture decision records (ADR-0013 withdrawn 2026-10-01; ADR-0016 supersedes 0002/0005) |
| [docs/network-topology.md](docs/network-topology.md) | VMs, IPs, ports, traffic flows (graded) |
| [docs/demo-walkthrough.md](docs/demo-walkthrough.md) | Live demo script (graded) |
| [docs/roadmap.md](docs/roadmap.md) | 4-week build order with exit criteria |

## The one-paragraph pitch

Patients book doctor slots from a department browser (walking patients are booked
into the same system by the front desk); doctors consult and prescribe; invoices
are derived automatically from the visit. Three roles — admin, doctor, patient —
JWT auth, MongoDB Atlas, demonstrated with two role clients hitting one server over plain HTTP.

## Layout (planned)

```
backend/    FastAPI + uvicorn + Motor (MongoDB Atlas)
frontend/   React + Vite + TypeScript + Tailwind (static build for nginx)
deploy/     provisioning + deploy scripts per VM
docs/       the documents above
```

See [ADR-0015](docs/adr/ADR-0015-monorepo-layout.md) for the rationale.