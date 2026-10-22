# Demo command cheat-sheet — live Wireshark + HTTP scenarios + MITM

One page to keep open at the podium. Goal: capture the server's request/response
**live on the laptop**, run the 7 HTTP scenarios, then the MITM — explaining every
command and every important packet field as you go.

Setup recap: `LabServer` VM, Adapter 2 **Bridged** to the Wi-Fi card, server =
`172.20.10.10`. Client A (colleague's browser) = `172.20.10.9`. Laptop (host) on
the same hotspot. Interface on the server = `enp0s8`. `S=http://172.20.10.10`.

> Replace IPs/interface with your real values: `ip -br addr show enp0s8` on the
> server, `ip -br addr` on the clients.

---

## Part 1 — Make Wireshark capture live

Your old method (`VBoxManage nictrace` → open a `.pcap`) is **post-hoc**. Keep it
as the safety net, but for the demo use a live method below.

### Method A (recommended) — Wireshark SSH remote capture (server-side, live)

Runs `tcpdump` inside the server over SSH and streams it into the Wireshark GUI on
the laptop. Live + captured on the server's own interface = exactly what's graded.

One-time prep on the server:

```bash
sudo apt install -y tcpdump openssh-server
sudo setcap cap_net_raw,cap_net_admin+eip $(which tcpdump)
```

- `openssh-server` — lets the laptop connect in.
- `setcap cap_net_raw,cap_net_admin+eip` — grants tcpdump the capabilities to read
  raw packets, so it runs as your normal user with **no sudo password** mid-demo.

In Wireshark on the laptop:

1. `Capture → Options` → interface **"SSH remote capture: sshdump"** → gear ⚙.
2. **Server:** `172.20.10.10`, Port `22`. **Auth:** VM username + password.
3. **Capture** tab → *Remote interface* `enp0s8` · *Remote capture filter* `tcp port 80`.
4. **Start** → packets stream live as clients hit the server.

### Method B — same thing by hand (PowerShell)

```powershell
ssh ghassen@172.20.10.10 "tcpdump -i enp0s8 -s0 -U -w - 'tcp port 80'" | & "C:\Program Files\Wireshark\Wireshark.exe" -k -i -
```

- `tcpdump -i enp0s8` capture on the bridged NIC · `-s0` full packets · `-U` flush
  each packet immediately (live) · `-w -` raw pcap to stdout.
- `ssh ... | Wireshark -k -i -` — Wireshark reads the stream from stdin (`-i -`) and
  starts immediately (`-k`).

### Method C (simplest, no SSH) — capture on the laptop's Wi-Fi

The VM is bridged **through** the laptop's Wi-Fi card, so its frames cross your
adapter.

1. Wireshark → pick the **Wi-Fi interface** → Start.
2. Filter: `ip.addr == 172.20.10.10 && tcp.port == 80`.

Live, zero setup; it's the laptop's view (not the server NIC) and Wi-Fi capture on
Windows can be flaky. Good fallback.

### Backup (not live) — VirtualBox nictrace to a file

```powershell
mkdir C:\captures -Force
$env:Path += ";C:\Program Files\Oracle\VirtualBox"
VBoxManage controlvm "LabServer" nictracefile2 "C:\captures\scenarios.pcap"
VBoxManage controlvm "LabServer" nictrace2 on
# ...run scenarios...
VBoxManage controlvm "LabServer" nictrace2 off   # stop BEFORE opening the file
```

### Bonus — live server logs beside Wireshark

Second SSH window on the server:

```bash
journalctl -u hms-api -f
```

`-f` follows the log live. Each API request appears here the instant Wireshark
shows its packet — correlate the wire with the application.

---

## Part 2 — Phase 0: pre-flight on the server (prove the architecture)

```bash
ip -br addr show enp0s8          # the server's hotspot IP
sudo ss -tlnp                    # who listens on which port
systemctl status hms-api nginx --no-pager
curl -i http://localhost/api/health
```

- `ss -tlnp` — `-t` TCP, `-l` listening, `-n` numeric, `-p` process. Expect:
  - `0.0.0.0:80 … nginx` — exposed to the network.
  - `127.0.0.1:8000 … uvicorn` — FastAPI on **loopback only**, unreachable from
    outside. This is the "reverse proxy, one port exposed" point, proven live.
- `curl -i http://localhost/api/health` — `-i` shows status line + headers; `200 OK`
  confirms nginx → FastAPI → Atlas all work.

---

## Part 2 — Phase 1: start the live capture

Start Method A/B/C with filter `tcp port 80`. Leave it running for everything below.

---

## Part 2 — Phase 2: run the 7 scenarios

| # | Scenario | Request | Status | Who |
|---|----------|---------|--------|-----|
| 1 | Open the website | `GET /` + `/assets/*` | 200 OK | Client A (browser) |
| 2 | Log in | `POST /api/auth/login` | 200 OK + JWT | Client A |
| 3 | Wrong password | `POST /api/auth/login` | 401 | Client A |
| 4 | Book an appointment | `POST /api/appointments` | 201 | Client A |
| 5 | Two clients, same slot | `POST /api/appointments` | 409 | Client B |
| 6 | Patient hits an admin route | `GET /api/users` | 403 | Client B (curl) |
| 7 | Resource doesn't exist | `GET /api/doctors/999999/slots` | 404 | Client B (curl) |

Order tip (keeps the login capture clean): do **3 (wrong password)** before
**2 (login)**; Client A logged out + cache cleared before you start.

Scenarios 1–5 in the browser. Scenarios 6–7 from a client terminal:

```bash
S=http://172.20.10.10

# log in and keep the patient's JWT
TOKEN=$(curl -s -X POST "$S/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"patient@hms.example.com","password":"hms-demo-1234"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

# 6) patient asks for the admin-only user list -> 403
curl -i -H "Authorization: Bearer $TOKEN" "$S/api/users"

# 7) slots of a doctor that doesn't exist -> 404
curl -i -H "Authorization: Bearer $TOKEN" "$S/api/doctors/999999/slots"
```

- `curl -s -X POST … -d '{…}'` — sends the login JSON; `-s` hides the progress bar.
  The `python3 -c …` extracts `access_token` into `$TOKEN`.
- `-H "Authorization: Bearer $TOKEN"` — the same JWT header the browser sends on
  every call; proves you're authenticated, so 403 = "known but not allowed" (≠ 401).
- `-i` — prints status line + headers, so the code shows in the terminal and in
  Wireshark at once.

Backup if live booking fails (scripts 200/401×2/403/404/405/409/422):

```bash
wget -q https://raw.githubusercontent.com/Gaston202/NetworksProject/main/deploy/http_scenarios.py
python3 http_scenarios.py http://172.20.10.10
```

---

## Part 2 — Phase 3: find & explain each packet

Apply the filter, then right-click the request → **Follow → HTTP Stream**.

| Scenario | Display filter | Point at |
|---|----------------|----------|
| Handshake | `tcp.flags.syn == 1 && tcp.port == 80` | SYN → SYN-ACK → ACK before any HTTP |
| 1 · page | `http.request.uri == "/"` | Req `Host`, `User-Agent`; Resp `200`, `Server: nginx`, `Content-Type`; then many `GET /assets/*` |
| 2 · login | `http.request.uri == "/api/auth/login"` | Body: **email + password in clear**; Resp `200` + `access_token` |
| 3 · 401 | `http.response.code == 401` | `{"detail":"Invalid email or password"}` |
| 4 · 201 | `http.response.code == 201` | `Authorization: Bearer …`, body `{"slot_id":…}`, Resp `201 Created` |
| 5 · 409 | `http.request.method=="POST" && http.request.uri=="/api/appointments"` | Two source IPs, same slot, one `201` one `409` |
| 6 · 403 | `http.response.code == 403` | `User-Agent: curl`, token valid but role=patient |
| 7 · 404 | `http.response.code == 404` | `{"detail":"Doctor not found"}` |
| all errors | `http.response.code >= 400` | 401, 403, 404, 409 in one view |

Important fields (what the jury asks about):

- **Request:** Request Method, Request URI, `Host`, `User-Agent`,
  `Authorization: Bearer`, `Content-Type`, body.
- **Response:** Status-Line (`200`/`401`/…), `Server: nginx`, `Content-Type`,
  JSON `detail`.
- **TCP:** ports (client:random → server:80), SYN/ACK flags, seq/ack.

One-line answers per scenario:

1. 200 `/`: nginx serves the built React files directly; one request per JS/CSS.
2. Login: credentials in clear (no HTTPS → MITM risk); server returns a JWT used in
   `Authorization: Bearer` on every later request.
3. 401: authentication failed; same message for unknown email vs wrong password so
   attackers can't enumerate; password checked against a bcrypt hash.
4. 201: "Created" — a new resource exists (more precise than 200).
5. 409: valid request, conflicts with current state; a unique index on `slot_id`
   prevents double-booking even for simultaneous requests.
6. 403 vs 401: 401 = "don't know who you are", 403 = "know you, not allowed"; role
   checks run on the server, so curl can't bypass them.
7. 404: URL well-formed, resource doesn't exist.

Bonus (timing): filter `http.time` → compare a static `/assets/*` (nginx, a few ms)
with an API call (nginx → FastAPI → Atlas, hundreds of ms) = the two layers.

---

## Part 2 — Phase 4: MITM (last scenario)

On the **attacker** machine (see `docs/mitm-lab.md` for the full lab):

```bash
sudo sysctl -w net.ipv4.ip_forward=1                     # 1. relay, don't drop
sudo arpspoof -i <iface> -t 172.20.10.9  172.20.10.10    # 2a. lie to the client
sudo arpspoof -i <iface> -t 172.20.10.10 172.20.10.9     # 2b. lie to the server
sudo tcpdump -i <iface> -A -s0 'tcp port 80 and host 172.20.10.10'   # 3. read it
```

- `ip_forward=1` — forward intercepted packets so the connection keeps working
  (otherwise you cut it instead of eavesdropping).
- `arpspoof -t victim other` — forged ARP replies telling the victim "the other
  machine's IP is at my MAC". Both directions ⇒ all Client↔Server traffic routes
  through the attacker. ARP is unauthenticated, which is why it works.
- `tcpdump -A` — payloads as ASCII → watch the login **email + password + Bearer
  token** appear in clear, on a machine they were never addressed to.

In Wireshark:

- `arp` — the forged replies from the attacker's MAC.
- `arp.duplicate-address-detected` — Wireshark flags "two MACs claim one IP":
  independent proof of the spoof.
- Follow HTTP Stream on the login — the intercepted credentials.
- Compare **before** (frames carry the server's real MAC) vs **during** (same IPs,
  attacker's MAC).

Cleanup: `Ctrl+C` both arpspoof windows (auto-restores ARP). Verify on the client:
`ip neigh` — the server's IP should point back to the real MAC.

Defense (closing point): HTTPS/TLS encrypts the traffic so the attacker relays
bytes it can't read, and a bad certificate warns the victim; plus static ARP
entries / dynamic ARP inspection on managed switches.

---

## Checklist before you present

- [ ] `curl $S/api/health` → `200` (Atlas allows the hotspot's public IP)
- [ ] Both clients `ping 172.20.10.10`
- [ ] At least one future free slot exists for the chosen doctor
- [ ] Client A logged out, cache cleared
- [ ] Live capture (Method A) tested end to end; nictrace `.pcap` saved as backup
- [ ] `journalctl -u hms-api -f` window ready
- [ ] MITM: `ping` both victims from the attacker first (no AP isolation)
- [ ] Everyone can answer questions on every part (not just their own)
