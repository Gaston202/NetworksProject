# Wireshark analysis — HTTP scenarios

How to filter, read, and screenshot `C:\captures\scenarios.pcap`, plus a
ready-to-paste analysis paragraph for each scenario.

## IP legend (our capture)

| IP | Machine |
|----|---------|
| `172.20.10.10` | Server (nginx :80 → FastAPI → MongoDB Atlas) |
| `172.20.10.9` | Client A (colleague's browser) |
| `172.20.10.12` | Client B (second client) |
| `172.20.10.7` | Host PC (ran the curl for scenarios 6 & 7) |

All traffic is **HTTP on port 80** — unencrypted, so Wireshark reads the bodies.

## Set up columns first

**Edit → Preferences → Appearance → Columns → +**, add three *Custom* columns:

| Title | Field |
|-------|-------|
| Method | `http.request.method` |
| URI | `http.request.uri` |
| Status | `http.response.code` |

Now the packet list reads like a request log — good for a wide overview shot.

## Filters

| Goal | Filter |
|------|--------|
| All HTTP (overview) | `http` |
| Only requests | `http.request` |
| Only responses | `http.response` |
| **All errors at once** | `http.response.code >= 400` |
| One status code | `http.response.code == 409` |
| One machine | `ip.addr == 172.20.10.9` |
| Login exchanges | `http.request.uri == "/api/auth/login"` |
| The booking race | `http.request.uri == "/api/appointments"` |
| TCP handshake | `tcp.flags.syn == 1 && ip.addr == 172.20.10.9` |

## Reading details & screenshots

- Click a request → middle pane → expand **Hypertext Transfer Protocol** for the
  request line and headers (`Host`, `User-Agent`, `Authorization: Bearer`). For a
  POST, expand the body line to see the JSON.
- **Best screenshot:** right-click a request → **Follow → HTTP Stream**. Request
  in red, response in blue, as plain text. Close the window afterwards to clear
  its filter.
- Capture with `Win+Shift+S` (Snipping Tool). For detail shots, include both the
  packet list and the expanded detail tree.
- Per-scenario backup file: apply a filter → **File → Export Specified Packets →
  Displayed** → `scenario-N.pcapng`.

## Scenario map (go to a packet with Ctrl+G)

| # | Status | Go to packet | Follow HTTP Stream shows |
|---|--------|--------------|--------------------------|
| 1 | 200 | 21 | `GET /` + `200 OK`, `Content-Type: text/html`, `Server: nginx` |
| 2 | 200 | 1622 | login body with email + password, response `200` + `access_token` |
| 3 | 401 | 1589 | body with `wrong-password`, response `401` |
| 4 | 201 | 2235 | `POST /api/appointments`, `Bearer` token, body `{"slot_id":...}`, `201` |
| 5 | 409 | 2233 | same slot from `.12`, `409` "Slot taken" |
| 6 | 403 | 2388 | `GET /api/users` with patient token, `403` |
| 7 | 404 | 2392 | `GET /api/doctors/999999/slots`, `404` |

---

## Analysis — one paragraph per scenario (paste into slides/report)

### Scenario 1 — 200 OK, loading the site
The client opens `http://172.20.10.10`. Wireshark shows a TCP three-way
handshake (SYN, SYN-ACK, ACK) and then `GET / HTTP/1.1`. nginx replies
`200 OK` with `Content-Type: text/html` and a `Server: nginx` header. The
browser immediately issues further GETs for the JavaScript, CSS, font and
favicon under `/assets/...`, each a separate request-response on the same
connection. This illustrates that a single page view is really many HTTP
requests, and that static files are served directly by nginx.

### Scenario 2 — 200 OK, successful login
The client sends `POST /api/auth/login` with the JSON body
`{"email":"patient@hms.example.com","password":"hms-demo-1234"}`. Because the
connection is plain HTTP, **the email and password are fully readable in the
packet** (Follow HTTP Stream). The server validates the credentials against a
bcrypt hash and replies `200 OK` with a JWT `access_token`. The browser stores
that token and sends it on every later request. This is the key security
observation: without HTTPS, anyone capturing the network sees the password.

### Scenario 3 — 401 Unauthorized, wrong password
An identical `POST /api/auth/login` but with `wrong-password`. The server
replies `401 Unauthorized` and `{"detail":"Invalid email or password"}`. The
message is deliberately the same whether the email is unknown or the password
is wrong, so an attacker cannot use the response to discover which emails are
registered (no user enumeration). 401 means "authentication failed / not
identified".

### Scenario 4 — 201 Created, booking an appointment
After login, the client sends `POST /api/appointments` carrying the header
`Authorization: Bearer <token>` and the body `{"slot_id":...}`. The server
replies `201 Created` — more precise than 200 because a new resource now
exists — and returns the new appointment as JSON. This shows authenticated,
state-changing requests and the correct use of the 201 status for creation.

### Scenario 5 — 409 Conflict, two clients book the same slot
Clients `.9` and `.12` send `POST /api/appointments` for the **same slot about
two milliseconds apart** (packets 2233 and 2235). The server returns `201
Created` to the first and `409 Conflict` ("Slot taken - pick another") to the
second. A unique database index on `slot_id` guarantees that only one booking
wins even under a race, so the slot can never be double-booked. 409 means the
request was valid but conflicts with the current state of the resource. This is
our strongest evidence of one server correctly serving two concurrent clients.

### Scenario 6 — 403 Forbidden, patient calls an admin route
A logged-in patient sends `GET /api/users` (admin-only) with a valid token. The
server replies `403 Forbidden`. The contrast with scenario 3 is the point: 401
means "I don't know who you are", 403 means "I know who you are, but you are not
allowed". The check runs on the server, not merely by hiding a button in the UI,
which is why a raw request (curl) cannot bypass it.

### Scenario 7 — 404 Not Found, resource that doesn't exist
`GET /api/doctors/999999/slots` targets a doctor id that does not exist. The URL
is well-formed and the user is authenticated, but the resource is absent, so the
server replies `404 Not Found` with `{"detail":"Doctor not found"}`. This
distinguishes "resource missing" (404) from "not allowed" (403) and "bad
request / validation" (422).

### Cross-cutting observations
- **Status families:** 2xx success (200, 201), 4xx client errors (401, 403,
  404, 409). Each error carries a JSON `detail` explaining the cause.
- **Statelessness + tokens:** the server keeps no session; the JWT in
  `Authorization: Bearer` identifies the caller on every request.
- **Security:** everything travels in clear over HTTP. HTTPS/TLS would encrypt
  the body and headers so the password and token could not be read on the wire —
  the direct link to our MITM demonstration.

## Suggested slide order (analysis section)

1. Capture overview (`http` list + IP legend).
2. TCP handshake (`tcp.flags.syn == 1`).
3. Success path: scenarios 1, 2, 4.
4. Error handling: `http.response.code >= 400`, then 401 / 403 / 404 / 409.
5. Security finding: scenario 2 stream with the password highlighted → why
   HTTPS matters → MITM.
