# ADR-0002: Deployment topology — two Ubuntu VMs on VirtualBox

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

The system needs a frontend and a backend that can be demonstrated as separate
machines talking over a network, on a single host machine running VirtualBox.

## Decision

Two VMs:

| VM | OS | Role | Serves |
|----|----|------|--------|
| `hms-server` | Ubuntu Server (LTS) | Backend + database | FastAPI REST API over HTTP + PostgreSQL |
| `hms-desktop` | Ubuntu Desktop (LTS) | Frontend | Static frontend build served over HTTP (nginx); browser clients open it |

The frontend is a web application (not a desktop-native app). It calls the backend
REST API over the virtual network. Development happens on the Windows host; the VMs
receive built/deployed artifacts.

## Consequences

- The backend must allow cross-origin requests from the frontend's origin (CORS) —
  or the two must be reverse-proxied to appear same-origin (decision deferred).
- Two deployment paths are needed: `deploy-backend.sh` (Ubuntu Server) and
  `deploy-frontend.sh` (Ubuntu Desktop).
- Ubuntu Desktop needs no backend dependencies; Ubuntu Server needs no GUI.
- The network mode linking the VMs is decided separately (ADR-0005).

## Related

- [ADR-0001](ADR-0001-project-purpose-and-evaluation.md)
- [ADR-0003](ADR-0003-backend-stack-fastapi.md)