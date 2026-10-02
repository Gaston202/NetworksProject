# Request Flow — how a request crosses the system

How one HTTP request travels from a client VM through LabServer to MongoDB Atlas
and back. Four scenarios, each showing a different component's job. An interactive,
step-by-step version exists for presenting (private claude.ai artifact *HMS Request
Path*). Topology: [ADR-0016](adr/ADR-0016-lab-topology-server-plus-two-clients.md);
deployment details: [labserver-setup-log.md](labserver-setup-log.md).

## Components

```mermaid
flowchart LR
    subgraph CLIENT["Client VM · 192.168.100.102 (DHCP)"]
        B["Firefox / curl"]
    end
    subgraph SRV["LabServer · Ubuntu Server 24.04"]
        direction LR
        UFW["Firewall<br/>ufw · netfilter"]
        NG["nginx 1.28.3<br/>:80"]
        FS[("/var/www/hms<br/>SPA files")]
        UV["uvicorn<br/>127.0.0.1:8000"]
        subgraph APP["FastAPI app"]
            direction TB
            CORS["CORSMiddleware"] --> AUTH["get_current_user"] --> ROLE["role check"] --> H["route handler"]
        end
        MO["Motor<br/>async driver"]
    end
    AT[("MongoDB Atlas<br/>TLS :27017")]

    B -- "HTTP :80 · intnet · enp0s8" --> UFW --> NG
    NG -- "/ (static)" --> FS
    NG -- "/api/* · loopback · HTTP/1.0" --> UV --> CORS
    H --> MO -- "enp0s3 → VirtualBox NAT · TLS" --> AT
```

| Component | Job | Where it's configured |
|-----------|-----|-----------------------|
| **Firewall** (ufw) | Kernel firewall: lets in 80 on `enp0s8` and 22 on `enp0s3` and silently drops everything else | `deploy/server-provision.sh` |
| **nginx** | Single entry point: serves the SPA files and reverse-proxies `/api/`, `/docs`, `/openapi.json` | `deploy/nginx-setup.sh` |
| **uvicorn** | ASGI server: parses HTTP into Python requests; listens on loopback only | `deploy/hms-api.service` |
| **CORSMiddleware** | Cross-origin rules. Deployed traffic is same-origin, so it only matters for the Vite dev server | `backend/app/main.py` |
| **get_current_user** | Verifies the JWT signature and expiry, then loads the user from Atlas → 401 on failure | `backend/app/api/deps.py` |
| **role check** | `require_role(...)` or a per-route branch → 403 for the wrong role | `backend/app/api/deps.py`, route modules |
| **route handler** | The business logic: reads and writes documents | `backend/app/api/routes/*.py` |
| **Motor** | Async MongoDB driver with a pooled TLS connection to Atlas | `backend/app/db/mongo.py` |

## 1. Load the page — `GET /`

nginx answers on its own; the API is never involved.

```mermaid
sequenceDiagram
    autonumber
    participant B as Client (Firefox)
    participant F as Firewall
    participant N as nginx :80
    participant D as /var/www/hms
    B->>F: TCP SYN → 192.168.100.10:80 (intnet)
    F->>N: rule "80/tcp on enp0s8 ALLOW IN" matches
    B->>N: GET / HTTP/1.1
    N->>D: location / → try_files $uri $uri/ /index.html
    N-->>B: 200 OK, index.html (476 B, 322 B gzipped)
    B->>N: GET /assets/index-B6nbbxpG.js, index-XfOpEThg.css
    N-->>B: 200 + Cache-Control: max-age=604800 / public, immutable
    Note over B: React starts and draws /login in the browser
```

## 2. Log in — `POST /api/auth/login`

```mermaid
sequenceDiagram
    autonumber
    participant B as Client (Firefox)
    participant N as nginx :80
    participant U as uvicorn 127.0.0.1:8000
    participant A as FastAPI
    participant M as MongoDB Atlas
    B->>N: POST /api/auth/login {email, password} (plain HTTP)
    N->>U: proxy over loopback, HTTP/1.0 + X-Forwarded-For: 192.168.100.102
    U->>A: ASGI request (client IP from X-Forwarded-For)
    A->>A: CORSMiddleware passes, LoginIn validated (422 if malformed)
    A->>M: find_one users {email} over TLS via NAT
    M-->>A: user document with password_hash
    A->>A: bcrypt verify in thread pool (401 if wrong), is_active (401)
    A->>A: create_access_token: HS256 {sub, role, exp +60 min}
    A-->>B: 200 {access_token, token_type: bearer, role, full_name}
    Note over B: token saved in localStorage, sent as Authorization: Bearer on every call
```

## 3. Book a slot — `POST /api/appointments` (main trace)

```mermaid
sequenceDiagram
    autonumber
    participant B as Client (patient)
    participant N as nginx
    participant U as uvicorn
    participant A as FastAPI
    participant M as MongoDB Atlas
    B->>N: POST /api/appointments {slot_id} + Authorization: Bearer JWT
    N->>U: proxied unchanged over loopback (nginx doesn't read the token)
    U->>A: route → book_appointment, resolve dependencies
    A->>A: get_current_user: signature + expiry (401)
    A->>M: users {_id: sub} → exists and active? (401)
    A->>M: role check: patient → patient_profiles {user_id} (doctor → 403)
    A->>M: availability_slots {_id} (404) · appointments {slot_id} (409 if taken)
    A->>M: counters $inc → new id · insert_one appointment
    Note over M: unique index on appointments.slot_id rejects a racing second booking → 409
    A-->>B: 201 Created {id, slot_id, patient_id, doctor_id, status: booked, …}
    Note over B,M: Client2 (doctor): GET /api/appointments → filtered by doctor_id → sees the booking
```

## 4. Hit port 8000 directly — blocked

```mermaid
sequenceDiagram
    autonumber
    participant C as Client (curl)
    participant F as Firewall (LabServer)
    participant U as uvicorn 127.0.0.1:8000
    C->>F: SYN 192.168.100.102:55266 → 192.168.100.10:8000
    F--xC: no allow rule → default deny = DROP (logged as UFW BLOCK)
    C->>F: SYN retransmit (×3)
    Note over C: curl: (28) Connection timed out (-m 3)
    Note over U: Second layer: bound to 127.0.0.1 only, so with the firewall off the kernel would reply RST ("connection refused")
```

Real kernel log entry for this attempt:

```
[UFW BLOCK] IN=enp0s8 OUT= SRC=192.168.100.102 DST=192.168.100.10 LEN=60 TTL=64 PROTO=TCP SPT=55266 DPT=8000 WINDOW=64240 SYN
```

## Where each status code comes from

| Code | Raised by | Example |
|------|-----------|---------|
| 200 / 201 | route handler | login · booking created |
| 401 | `get_current_user` / `login()` | no token, bad or expired token, wrong password, deactivated account |
| 403 | role check | patient calling `GET /api/users`, doctor booking a slot |
| 404 | route handler | unknown slot or appointment id |
| 405 | FastAPI router | `DELETE /api/health` |
| 409 | handler + unique index | slot already taken, email already registered |
| 422 | pydantic validation | missing fields, password over 72 bytes |
| 502 | nginx | uvicorn not running behind the proxy |
| timeout | Firewall (DROP) | any port other than 80/22 |
