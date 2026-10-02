# HMS Demo Walkthrough

The live demo script. Every step shows the client–server interaction a networks
course grades. Seed accounts are created by the backend seed script. Three-role
scope per ADR-0007.

## Demo accounts (seeded)

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@hms.example.com` | *(set in seed script)* |
| Doctor | `amina.haddad@hms.example.com` | 〃 |
| Patient | `patient@hms.example.com` | 〃 |

Also seeded (for richer demos): `omar.benali@hms.example.com` (Cardiology),
`salma.trabelsi@hms.example.com` (Pediatrics), `leila.mansour@hms.example.com` (patient).

## Pre-flight (before starting)

- [ ] LabServer + both clients up; `ping -c2 192.168.100.10` works from each client
- [ ] On LabServer: `systemctl status hms-api nginx` both active
- [ ] SPA loads on both clients: `http://192.168.100.10/`
- [ ] `python3 http_scenarios.py` on a client → all rows PASS (Pass-tier HTTP scenarios)
- [ ] Database seeded (6 demo users: admin, 3 doctors, 2 patients; departments with
      doctors; slots bookable; one historic completed visit)

## The story: one patient's visit, end to end

**Act 1 — Booking (Patient persona, with an Admin walk-in beat)**

1. Login as **Patient** → book an appointment: pick department → doctor → free slot.
   *(Show the slot disappearing from the picker after booking.)*
2. Show "My appointments" — only this patient's data is visible.
3. Login as **Admin** → walk-in booking: book the same doctor for **another**
   patient (Leila) — front desk books on behalf of a patient without an online
   account flow.
4. *(Network beat: open devtools Network tab — show the `POST /api/appointments`
   request to `192.168.100.10/api/...` with the JWT in the Authorization header —
   same origin, served through nginx.)*

**Act 2 — Consultation (Doctor persona)**

5. Login as **Doctor** → open the appointment → write diagnosis + notes +
   prescription (free text).
6. Mark appointment **completed** → invoice is auto-created with the consultation
   fee. *(Show the new invoice in the response.)*

**Act 3 — Billing (Admin persona)**

7. Login as **Admin** → billing view → the visit's invoice shows the consultation
   fee → mark **paid**.
8. Back as **Patient** — they can see their appointment, consultation, and invoice,
   and *only* their own.

**Act 4 — Management (Admin persona, quick pass)**

9. Create a department, a doctor user, and show slot creation — the loop closes.

## Optional 30-second deep-dive, if the grader asks "where's the networking?"

- `curl -v http://192.168.100.10/api/appointments` from a client — raw HTTP over
  `intnet`, `401` without a token; retry with a Bearer token to show the role-scoped list.
- `curl -m 3 http://192.168.100.10:8000/api/health` from a client **times out**: the
  API is only reachable through nginx (uvicorn on loopback + ufw).
- `sudo journalctl -u hms-api -f` on LabServer while both clients click around — each
  request is logged with the real client IP (nginx forwards it).
- Swagger UI request/response as the API contract.
- `systemctl status hms-api nginx` and `sudo ufw status verbose` on LabServer.

## Recovery playbook (things going wrong mid-demo)

| Symptom | Fix |
|---------|-----|
| Page/API unreachable from a client | `systemctl status hms-api nginx` on LabServer, then `ip a` on both; both on `intnet`? |
| CORS error in console | The build has a non-empty `VITE_API_BASE_URL` — rebuild with it empty (same-origin `/api`) |
| Login fails | Re-run seed script; confirm password in seed config |
| `502 Bad Gateway` | nginx is up but uvicorn isn't: `journalctl -u hms-api -n 50` |
| Slot won't book | Already taken — pick another; explains the uniqueness rule |