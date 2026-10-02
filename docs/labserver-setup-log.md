# LabServer Setup Log — how the HMS server was deployed

A record of how `LabServer` was taken from a crash-looping service to a working
server on **2026-10-02**: what was done, why, and the output each step gave.
The decisions behind the topology are in
[ADR-0016](adr/ADR-0016-lab-topology-server-plus-two-clients.md); the
step-by-step runbook for repeating it is [deploy/README.md](../deploy/README.md).

---

## 1. Starting point: the problem

The first provisioning run ended like this (screenshot, 12:32):

```
hms-api.service - HMS FastAPI backend (uvicorn)
   Active: activating (auto-restart) (Result: exit-code)
   Process: ExecStart=.../uvicorn app.main:app --host 0.0.0.0 --port 8000 (code=exited, status=217/USER)
curl: (7) Failed to connect to localhost port 8000 ... Could not connect to server
API health never reported OK - check: journalctl -u hms-api
```

**Reading the error:** exit status `217/USER` comes from **systemd**, not from
Python. systemd failed *before* starting uvicorn because the unit file said
`User=ubuntu`, and LabServer has no `ubuntu` account (its user is `ghass`).
Commit `31423f2` had already fixed this by filling `User=` from whoever runs the
script, but LabServer was still on the older code.

Inspecting the VM turned up two more problems:

| # | Problem found | Effect |
|---|---------------|--------|
| 1 | `User=ubuntu` hardcoded in the unit | `217/USER`, uvicorn never starts |
| 2 | `backend/.env` was `root:root`, mode `600` (written by the first `sudo` run) | Even with the right user, the service can't read `.env`, so `MONGODB_URL` is missing and the app crashes. The fixed script skipped existing `.env` files, so it wouldn't have repaired this |
| 3 | The whole repo `/project/NetworksProject` was owned by `root` (cloned with `sudo`) | `git` refused to work: `fatal: detected dubious ownership in repository` |

---

## 2. Target architecture

```
 Client (DHCP)  ─┐                       LabServer
                 ├── intnet ──► enp0s8 192.168.100.10
 Client2 (DHCP) ─┘    192.168.100.0/24      │
                                        nginx :80 ──┬── /            → SPA files (/var/www/hms)
                                                    └── /api/ /docs  → uvicorn 127.0.0.1:8000
                                                                           │
                                       enp0s3 (NAT) ◄──────────────────────┘ TLS :27017 → MongoDB Atlas
 Windows host ── 127.0.0.1:2222 ──► NAT port-forward ──► LabServer :22 (ssh, admin only)
```

| Interface | Network | Address | Used for |
|-----------|---------|---------|----------|
| `enp0s3` | VirtualBox NAT | `10.0.2.15` (DHCP) | Internet out (Atlas, apt), host ssh in |
| `enp0s8` | Internal Network `intnet` | `192.168.100.10/24` (static) | Client traffic only |

---

## 3. What was done, step by step

### Step 1: Admin access from the Windows host (SSH)

The host cannot reach `intnet` (it only exists between VMs), and NAT blocks
inbound connections. So a **NAT port-forward** was added in VirtualBox on
LabServer's Adapter 1: host `127.0.0.1:2222` → guest port `22`.

- First attempt: port 2222 was open on the host, but the connection was cut
  (`kex_exchange_identification: Connection abort`). VirtualBox accepted it,
  yet nothing in the VM answered on port 22, so **the SSH server wasn't running**.
- Fix, in the VM console:
  `sudo apt install -y openssh-server && sudo systemctl enable --now ssh`

**Key-based login.** The password was used **once**, only to append the host's
public key (`~/.ssh/id_ed25519.pub`) to `~/.ssh/authorized_keys` on LabServer.
After that, every connection used the key:

```bash
ssh -p 2222 ghass@127.0.0.1
```

> **Why keys instead of passwords?** A key pair can't be guessed or
> brute-forced the way a password can, and scripts can log in without a
> password being typed or stored. The private key never leaves the host; the
> server only holds the public half.

Root commands ran through `sudo -S` (which reads the password from stdin,
because the remote session has no terminal for a prompt).

First look at the VM confirmed the network matched the plan:

```
enp0s3   UP   10.0.2.15/24
enp0s8   UP   192.168.100.10/24
```

### Step 2: Fix the repository ownership (problem 3)

```bash
sudo chown -R ghass:ghass /project/NetworksProject
```

> **Why git complained:** since 2022, git refuses to work in a repository owned
> by a different user ("dubious ownership"). Another user could plant hooks
> or config that run code as you. Cloning with `sudo` made root the owner.
> Lesson: clone and work as your normal user and use `sudo` only for system
> changes.

### Step 3: Get the new code and check the configuration

```bash
git fetch origin && git switch feature/labserver-nginx   # later: main
```

The existing `.env` was checked **by key names only**, so no secret was printed:

```bash
sudo cut -d= -f1 backend/.env
# MONGODB_URL MONGODB_DB SECRET_KEY ACCESS_TOKEN_EXPIRE_MINUTES CORS_ORIGINS SEED_PASSWORD
```

All required keys were present, including `SECRET_KEY`, which the backend now
requires at startup.

The provision script was also changed so `MONGODB_URL` is **only needed on a
first install**. On re-runs it's read from `.env`, so the Atlas password never
appears on a command line (where it would end up in shell history and the
process list).

### Step 4: Build the frontend on the host and copy it over

```bash
cd frontend && npm run build          # on Windows
scp -P 2222 -r dist ghass@127.0.0.1:/project/NetworksProject/frontend/
```

`VITE_API_BASE_URL` is left **empty**, so the app calls `/api/...` on whatever
address served the page. The build was checked to contain no hardcoded
`http://...:8000` URL. Node is therefore only needed on the host, never on the
server.

### Step 5: Provision the backend: `deploy/server-provision.sh`

```bash
sudo bash deploy/server-provision.sh
```

What the script does, in order:

| Stage | Action | Why |
|-------|--------|-----|
| Packages | `python3-venv`, `python3-pip` | No database packages: the DB is Atlas |
| `.env` | Keep existing contents; **always** `chmod 600` + `chown ghass` | Fixes problem 2 permanently, even on re-runs |
| venv | `.venv` + `pip install -r requirements.txt` | Isolated Python dependencies |
| Seed | `python -m app.seed` | Idempotent: `Seed data already present - nothing to do.` |
| systemd | Install `hms-api.service` with `User=ghass`, then `restart` | Fixes problem 1; `restart` (not `start`) so a changed unit takes effect even if an old instance is running |
| Firewall | ufw default-deny + 2 allow rules, then enable | See below |
| Verify | `curl localhost:8000/api/health` with retries | Fails the run loudly if the API never comes up |

Output:

```
==> Firewall: deny incoming except ssh on enp0s3 and http on enp0s8
Firewall is active and enabled on system startup
● hms-api.service - HMS FastAPI backend (uvicorn)
     Active: active (running) since Fri 2026-10-02 14:34:49 UTC; 9s ago
{"status":"ok","service":"hms-api","version":"0.1.0"}
BACKEND PROVISIONED OK
```

The systemd unit now starts uvicorn like this:

```ini
ExecStart=.../uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1
```

- `--host 127.0.0.1`: listen on **loopback only**, so no other machine can
  connect to port 8000 directly.
- `--proxy-headers`: trust nginx's `X-Forwarded-For`, so the logs show the
  real client IP instead of `127.0.0.1`.

**Firewall rules (ufw):**

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow in on enp0s3 to any port 22 proto tcp   # ssh, admin path only
ufw allow in on enp0s8 to any port 80 proto tcp   # web, client network only
ufw --force enable
```

The ssh rule is added **before** enabling the firewall, otherwise the SSH session
running the script would have been cut off.

### Step 6: Serve SPA + API through nginx: `deploy/nginx-setup.sh`

```bash
sudo bash deploy/nginx-setup.sh
```

It installs nginx, copies `frontend/dist` to `/var/www/hms`, and writes this site:

```nginx
server {
    listen 80 default_server;
    root /var/www/hms;

    location ^~ /api/ {                       # API -> FastAPI
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location = /docs         { proxy_pass http://127.0.0.1:8000; }   # Swagger UI
    location = /openapi.json { proxy_pass http://127.0.0.1:8000; }

    location / { try_files $uri $uri/ /index.html; }   # SPA routes
}
```

- `^~` makes `/api/` win over the regex rule for static assets, so an API path
  is never served as a file.
- `try_files ... /index.html`: React Router paths like `/patient/appointments`
  don't exist as files, so nginx returns `index.html` and React handles the route.
  Without this, refreshing the page gives a 404.

Output:

```
nginx: configuration file /etc/nginx/nginx.conf test is successful
{"status":"ok","service":"hms-api","version":"0.1.0"}
FRONTEND + API SERVED OK — open http://192.168.100.10/ from a client VM
```

### Step 7: Verification

**Services and sockets:**

```
hms-api: active    nginx: active

0.0.0.0:80        nginx     <- reachable (filtered by ufw to enp0s8)
127.0.0.1:8000    uvicorn   <- loopback only
0.0.0.0:22        sshd      <- reachable (filtered by ufw to enp0s3)
```

**Firewall:**

```
Default: deny (incoming), allow (outgoing), disabled (routed)
22/tcp on enp0s3     ALLOW IN    Anywhere
80/tcp on enp0s8     ALLOW IN    Anywhere
```

**HTTP status scenarios** (`deploy/http_scenarios.py`, the Pass requirement):

```
EXPECTED GOT   RESULT  REQUEST                             SCENARIO
200      200   PASS    GET /api/health                     OK - server and database healthy
401      401   PASS    GET /api/auth/me                    Unauthorized - no token
401      401   PASS    POST /api/auth/login                Unauthorized - wrong password
403      403   PASS    GET /api/users                      Forbidden - patient calls an admin route
404      404   PASS    GET /api/appointments/999999        Not Found - unknown appointment
405      405   PASS    DELETE /api/health                  Method Not Allowed - DELETE on a GET route
409      409   PASS    POST /api/auth/register             Conflict - email already registered
422      422   PASS    POST /api/auth/login                Unprocessable - login body missing fields

8/8 scenarios behaved as expected
```

**Routing through nginx:**

```
/                        200 text/html          SPA
/patient/appointments    200 text/html          SPA route fallback works
/docs                    200 text/html          Swagger through the proxy
/openapi.json            200 application/json
/api/doctors             401 application/json   API reached, auth enforced
```

### Step 8: Merge and pin the server to `main`

The work was merged into `main` (`399ea17`) and LabServer was switched to `main`,
so future updates are just `git pull`.

---

## 4. Concepts used (for the presentation)

| Concept | Where it appears | One-line explanation |
|---------|------------------|----------------------|
| **Reverse proxy** | nginx → uvicorn | One public entry point forwards each request to the right internal service based on its path |
| **Same-origin / CORS** | SPA and API both at `http://192.168.100.10` | Browsers block cross-origin API calls unless allowed; serving both from one origin avoids CORS entirely, so client IPs don't matter |
| **Loopback binding** | uvicorn on `127.0.0.1` | A service bound to loopback is unreachable from the network, whatever the firewall says |
| **Defense in depth** | loopback binding **and** ufw | Two independent layers both block port 8000 |
| **Per-interface firewall** | 22 only on NAT, 80 only on intnet | Each network gets only the service it needs (segmentation) |
| **NAT + port-forward** | host `2222` → VM `22` | NAT allows outbound by default; inbound needs an explicit forward |
| **Least privilege** | service runs as `ghass`, `.env` mode `600` | The web service isn't root; secrets are readable by one user only |
| **systemd** | `hms-api.service` | Starts the API at boot, restarts it on failure, logs to `journalctl` |

---

## 5. Day-to-day commands (on LabServer)

| Task | Command |
|------|---------|
| Live API log (shows client IPs) | `journalctl -u hms-api -f` |
| Restart API | `sudo systemctl restart hms-api` |
| Status of both services | `systemctl status hms-api nginx` |
| Firewall | `sudo ufw status verbose` |
| What is listening | `sudo ss -tlnp` |
| Update backend | `git pull && sudo bash deploy/server-provision.sh` |
| Update frontend | rebuild on host → `scp` `dist` → `sudo bash deploy/nginx-setup.sh` |

---

## 6. Not yet verified / follow-ups

- **From a client VM.** All checks above ran *on LabServer* against its own
  intnet address. Still to confirm from `Client`/`Client2`:
  `ping -c2 192.168.100.10`, `curl -m 3 http://192.168.100.10:8000/` (should
  **time out**), and logging in from both browsers at once.
- **Reboot test.** Both services are enabled at boot; `sudo reboot` once to confirm.
- **Change the VM password** (`passwd`): it was weak and was shared during setup.
  Key-based ssh keeps working afterwards.
- `/docs` requests are logged with `127.0.0.1` because only `/api/` forwards the
  client IP headers (cosmetic).
- Good tier (hotspot, 3 laptops) and Prestigious tier (MITM): see ADR-0016.
