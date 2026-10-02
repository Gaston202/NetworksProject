# ADR-0016: Lab topology — one server, two role clients, nginx reverse proxy

- **Status:** Accepted (supersedes [ADR-0002](ADR-0002-deployment-topology-two-vms.md)
  and [ADR-0005](ADR-0005-virtualbox-network-mode.md); amends the serving part of
  [ADR-0011](ADR-0011-frontend-react-vite-static-spa.md))
- **Date:** 2026-10-02
- **Deciders:** Project owner, Claude

## Context

The course defines the evaluated setup as **one server and two clients**: each
client is a user of a different role (e.g. a doctor and a patient) interacting
with the same system at the same time. Grading tiers:

- **Pass** — VirtualBox infrastructure + networks ready, HTTP server running,
  at least 5 working HTTP status-code scenarios.
- **Good** — the same demo across 3 physical laptops on a mobile hotspot.
- **Prestigious** — a man-in-the-middle simulation (details given in class).

The VMs actually built differ from ADR-0002/0005 (two VMs on NAT Network
`hmsnet`, 10.0.2.x): they are `LabServer`, `Client`, `Client2` on a VirtualBox
**Internal Network** `intnet` (192.168.100.0/24), with the clients on DHCP.

## Decision

| Machine | Adapters | Address | Role |
|---------|----------|---------|------|
| `LabServer` (Ubuntu Server) | 1: NAT · 2: Internal Network `intnet` | NAT: DHCP · `enp0s8`: **192.168.100.10/24 static** | nginx :80 + FastAPI on 127.0.0.1:8000 |
| `Client`, `Client2` (Ubuntu Desktop) | Internal Network `intnet` | DHCP (e.g. 192.168.100.102) | Browser only — one logs in as doctor, one as patient |

1. **nginx on LabServer is the single entry point (reverse proxy).**
   `/` serves the built SPA; `/api/`, `/docs`, `/openapi.json` are proxied to
   uvicorn on `127.0.0.1:8000`. The browser sees one origin, so **no CORS is
   involved** and client IPs never need to be known — DHCP clients are fine.
2. **uvicorn binds to loopback.** Port 8000 is unreachable from the network.
3. **Two adapters, two jobs.** NAT gives outbound internet (MongoDB Atlas on
   TCP/27017, apt) and the host's ssh port-forward (`127.0.0.1:2222 → 22`);
   `intnet` carries client traffic and nothing else.
4. **Firewall (ufw): deny incoming by default.** Allow `22/tcp` on the NAT
   adapter only and `80/tcp` on the intnet adapter only.
5. **The SPA is built on the Windows host** (empty `VITE_API_BASE_URL` → relative
   `/api` calls) and copied to LabServer with `scp`; the server needs no Node.

## Consequences

- One machine serves both tiers; the "separate machines" story is now
  client ↔ server rather than frontend VM ↔ backend VM — which is exactly the
  role-based client/server interaction the course grades.
- `CORS_ORIGINS` only matters for local development (`http://localhost:5173`).
- Clients need nothing installed — any browser on `intnet` works.
- Swagger UI (`/docs`) loads its JS/CSS from a public CDN, so it renders only in
  a browser with internet access; the API itself does not need it.
- **Good tier deferred:** a hotspot demo needs LabServer reachable from other
  physical laptops (e.g. a Bridged adapter on the Wi-Fi card, with a matching
  ufw rule). To be decided after the class session.
- **Prestigious tier deferred** until the instructions are given in class.

## Related

- [ADR-0001](ADR-0001-project-purpose-and-evaluation.md) — evaluation criteria
- [ADR-0004](ADR-0004-database-postgresql.md) — MongoDB Atlas (the outbound leg)
- [network-topology.md](../network-topology.md) — diagram and flows
