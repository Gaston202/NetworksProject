# ADR-0015: Repository layout — monorepo

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

Two candidate layouts: one monorepo with `backend/`, `frontend/`, `deploy/`, or two
separate repositories mirroring the two VMs.

## Decision

**Monorepo:**

```
NetworksProject/
├── backend/          # FastAPI app (Python package)
├── frontend/         # React + Vite + TS + Tailwind SPA
├── deploy/           # provisioning + deploy scripts per VM
├── docs/             # ADRs, glossary, domain model, network topology, demo script
└── README.md
```

## Consequences

- One clone gives a grader everything; one commit history tells the project story.
- Cross-cutting changes (e.g., API contract tweak + UI update) land in one commit.
- CI, if added, scopes jobs by path (`backend/**`, `frontend/**`).
- The two-VM deployment is unaffected — each VM only receives its subfolder's
  artifacts.

## Related

- [ADR-0002](ADR-0002-deployment-topology-two-vms.md)