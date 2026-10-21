# 7 HTTP scenarios + Wireshark analysis

What we demo and capture for the final presentation: one server, two clients,
seven HTTP scenarios, each one visible and explained in Wireshark.

Network setup (hotspot): see [hotspot-demo-and-wireshark.md](hotspot-demo-and-wireshark.md).

## Who is who

| Role | Machine | Example IP |
|------|---------|------------|
| **Server** | `LabServer` VM on Ghassen's PC (nginx :80 → FastAPI → MongoDB Atlas) | `172.20.10.10` |
| **Client A** | Colleague's laptop browser (on the hotspot) | `172.20.10.9` |
| **Client B** | `Client` VM on Ghassen's PC, Adapter 2 **Bridged** to the Wi-Fi card | from `ip -br addr` |

Your IPs may differ: check `ip -br addr show enp0s8` on LabServer and
`ip -br addr` on Client. Below, `S` means `http://<server IP>`.

**Client B setup (once):** power off `Client` → Settings → Network → Adapter 2
→ *Bridged Adapter*, Name: the Wi-Fi card. Boot it; Ubuntu Desktop gets an
address from the hotspot by itself. Test: `ping -c 2 <server IP>`.

## The 7 scenarios

| # | Scenario | Request | Status | Who |
|---|----------|---------|--------|-----|
| 1 | Open the website | `GET /` + `/assets/*` | **200 OK** | Client A |
| 2 | Log in | `POST /api/auth/login` | **200 OK** + JWT | Client A |
| 3 | Wrong password | `POST /api/auth/login` | **401 Unauthorized** | Client A |
| 4 | Book an appointment | `POST /api/appointments` | **201 Created** | Client A |
| 5 | Two clients book the same slot | `POST /api/appointments` | **409 Conflict** | Client B |
| 6 | Patient calls an admin route | `GET /api/users` | **403 Forbidden** | Client B |
| 7 | Resource that doesn't exist | `GET /api/doctors/999999/slots` | **404 Not Found** | Client B |

Why these: they cover reading (GET), creating (POST), success (2xx) and three
kinds of client error (4xx: who are you / you're not allowed / doesn't exist /
conflicts with the current state), and #5 needs **both clients at once**,
which shows the server handling concurrent users.

---

## Step 1: start the capture (Ghassen's PC, PowerShell)

```powershell
mkdir C:\captures -Force
$env:Path += ";C:\Program Files\Oracle\VirtualBox"
VBoxManage controlvm "LabServer" nictracefile2 "C:\captures\scenarios.pcap"
VBoxManage controlvm "LabServer" nictrace2 on
```

Capturing the **server** adapter records both clients in one file.

**Before starting:** Client A logs **out** (so scenario 2 is captured) and
closes the site tab.

## Step 2: run the scenarios in order

### Scenario 1: 200 OK, open the website (Client A)

Open `S` in the browser. Press `Ctrl+Shift+R` so nothing comes from cache.

### Scenario 3: 401 Unauthorized, wrong password (Client A)

Log in as `patient@hms.example.com` with password `wrong-password`. The page
shows an error. (Done before scenario 2 so the login stays clean.)

### Scenario 2: 200 OK, log in (Client A)

Log in as `patient@hms.example.com` / `hms-demo-1234`.

### Scenarios 4 + 5: 201 Created then 409 Conflict (both clients)

1. **Client B:** in Firefox open `S` and log in with the same patient account
   (`patient@hms.example.com` / `hms-demo-1234`). A second account isn't needed.
2. **Both** go to *Book appointment*, pick the **same department, same doctor**,
   and stop on the **same free slot**. Don't click *Book* yet.
3. **Client A** books first → `201 Created`.
4. **Client B** (still showing the old list) books the same slot →
   `409 Conflict: Slot taken - pick another`.

### Scenarios 6 + 7: 403 Forbidden and 404 Not Found (Client B terminal)

```bash
S=http://<server IP>

# log in and keep the patient's token
TOKEN=$(curl -s -X POST "$S/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"patient@hms.example.com","password":"hms-demo-1234"}' \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)["access_token"])')

# 6) patient asks for the admin-only user list -> 403
curl -i -H "Authorization: Bearer $TOKEN" "$S/api/users"

# 7) slots of a doctor that doesn't exist -> 404
curl -i -H "Authorization: Bearer $TOKEN" "$S/api/doctors/999999/slots"
```

`-i` prints the status line and headers, so you see the code in the terminal too.

## Step 3: stop the capture

```powershell
VBoxManage controlvm "LabServer" nictrace2 off
```

Open `C:\captures\scenarios.pcap` in Wireshark.

---

## Step 4: find each scenario in Wireshark

First get a list of every request and response: filter `http`, then
**Statistics → HTTP → Request Sequences** (or just scroll the filtered list).

| # | Display filter | What to point at |
|---|----------------|------------------|
| 1 | `http.request.uri == "/"` | Packet before it: TCP handshake. Request headers `Host`, `User-Agent`, `Accept`. Response `200 OK`, `Content-Type: text/html`, `Server: nginx`. Then many `GET /assets/...`: one page = many requests. |
| 1 | `tcp.flags.syn == 1 && tcp.port == 80` | The SYN / SYN-ACK / ACK three-way handshake. |
| 2 | `http.request.uri == "/api/auth/login"` | Request body: **email and password in plain text** (HTTP, no TLS). Response `200` with `access_token` (the JWT). |
| 3 | `http.response.code == 401` | `{"detail":"Invalid email or password"}`. Same message whether the email or the password is wrong, so attackers can't guess which emails exist. |
| 4 | `http.response.code == 201` | Request: `POST /api/appointments`, header `Authorization: Bearer ...`, body `{"slot_id": ...}`. Response `201 Created` with the new appointment JSON. |
| 5 | `http.response.code == 409` | **Source IP is Client B**, same `slot_id` as scenario 4. `{"detail":"Slot taken - pick another"}`. |
| 5 | `http.request.method == "POST" && http.request.uri == "/api/appointments"` | Both bookings side by side: two IPs, same slot, `201` vs `409`. |
| 6 | `http.response.code == 403` | `User-Agent: curl/...` (not a browser). Token valid (so not 401) but role is patient. |
| 7 | `http.response.code == 404` | `{"detail":"Doctor not found"}`. |
| all | `http.response.code >= 400` | Every error in one view: 401, 403, 404, 409. |

**For each scenario:** right-click the request → **Follow → HTTP Stream**
(or TCP Stream). It shows the full request and response as text. This is the
view to screenshot for the slides.

**Save each scenario separately (for slides / backup):** apply the filter,
then **File → Export Specified Packets → All packets: Displayed** →
`scenario-N.pcapng`.

### Useful columns

Right-click a field in the packet details → **Apply as Column**. Good ones:
`http.request.method`, `http.request.uri`, `http.response.code`, `ip.src`.
Then the packet list reads like a log of the demo.

### Timing (bonus)

Filter `http.time` → each response has *Time since request*. Compare a static
file (`/assets/...`, served by nginx directly, a few ms) with an API call
(goes nginx → FastAPI → Atlas over the internet, hundreds of ms). That shows
the two layers of the architecture.

## What to say for each scenario (jury questions)

1. **200 /:** nginx serves the built React files directly; the browser then
   makes one request per JS/CSS file. Port 80, plain HTTP.
2. **Login:** credentials travel in clear because there's no HTTPS: anyone on
   the hotspot could read them (MITM). The server answers with a JWT that the
   browser sends on every later request in `Authorization: Bearer`.
3. **401:** authentication failed. Same message for unknown email and wrong
   password on purpose. Password checked against a bcrypt hash, never stored
   in clear.
4. **201:** "Created" is more precise than 200: a new resource now exists.
5. **409:** the request is valid, but conflicts with the server's current state
   (the slot was taken a second ago by another client). The database has a
   unique index on `slot_id`, so even two requests in the same millisecond
   can't double-book.
6. **403 vs 401:** 401 = "I don't know who you are", 403 = "I know who you are,
   you're not allowed". Role checks are done on the server, not just hidden
   buttons in the UI, which is why curl can't bypass them.
7. **404:** the URL is well-formed but the resource doesn't exist.

## Backup if live booking fails

Run the scripted scenarios from Client B during a capture:

```bash
wget -q https://raw.githubusercontent.com/Gaston202/NetworksProject/main/deploy/http_scenarios.py
python3 http_scenarios.py http://<server IP>
```

It produces 200, 401 ×2, 403, 404, 405, 409, 422 in a few seconds.

## Checklist before the presentation

- [ ] `curl S/api/health` → `200` (Atlas allows the hotspot's IP)
- [ ] Both clients ping the server
- [ ] At least one future free slot exists for the chosen doctor
- [ ] Client A logged out, cache cleared
- [ ] `scenarios.pcap` saved + one exported file per scenario as backup
- [ ] Screenshot of each Follow HTTP Stream for the slides
