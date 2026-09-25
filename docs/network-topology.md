# HMS Network Topology

Graded deliverable: how the system's machines are networked. Addresses per
[ADR-0005](adr/ADR-0005-virtualbox-network-mode.md), services per
[ADR-0002](adr/ADR-0002-deployment-topology-two-vms.md).

## Diagram

```mermaid
flowchart LR
    HOST["Windows host<br/>VirtualBox"]

    subgraph NATNET["VirtualBox NAT Network — 10.0.2.0/24"]
        direction TB
        SRV["hms-server — Ubuntu Server<br/>10.0.2.10"]
        DESK["hms-desktop — Ubuntu Desktop<br/>10.0.2.20"]
    end

    BROWSER["Browser<br/>(host or desktop VM)"]

    HOST == "manages + provisions both VMs" --> NATNET
    BROWSER -- "HTTP GET :80 → SPA" --> DESK
    DESK == "nginx serves static build" --> DESK
    BROWSER -- "HTTP REST + JWT :8000" --> SRV
    SRV == "localhost only :5432" --> PG[("PostgreSQL<br/>on hms-server")]
```

## Components

| Machine | OS | IP | Runs | Ports |
|---------|----|----|------|-------|
| `hms-server` | Ubuntu Server LTS | `10.0.2.10` | FastAPI (uvicorn via systemd), PostgreSQL | `8000` (API), `5432` (localhost only) |
| `hms-desktop` | Ubuntu Desktop LTS | `10.0.2.20` | nginx, static SPA build | `80` |
| Windows host | Windows 11 | gateway | VirtualBox, dev environment | optional forwards: `8888→10.0.2.10:8000`, `8080→10.0.2.20:80` |

## Traffic flows

1. **Browser → `hms-desktop:80`** — plain HTTP GET. nginx returns the React SPA's
   static files; client-side routes fall back to `index.html`.
2. **Browser → `hms-server:8000`** — plain HTTP REST calls carrying
   `Authorization: Bearer <JWT>`. CORS on the backend whitelists `http://10.0.2.20`.
3. **`hms-server` → localhost:5432** — the database is never exposed to the network.

## Talking points for the demo

- The frontend and backend are **separate machines** — show `ip a` on each VM and
  `ping 10.0.2.10` from the desktop.
- Show the raw HTTP traffic once (browser devtools Network tab, or `curl -v`
  against the API) — request/response over the NAT network is the graded behavior.
- Swagger UI at `http://10.0.2.10:8000/docs` demonstrates the API surface directly.
- Same-origin vs cross-origin: nginx serving static files and the API on a different
  origin is why CORS exists — mention it while showing a request succeed.

## Known limitations (report material)

- Plain HTTP, no TLS — acceptable for the course (ADR-0002); JWTs travel unencrypted.
- Single NAT network; no redundancy, no load balancing.
- Optional host port-forwards are for convenience, not part of the graded path.