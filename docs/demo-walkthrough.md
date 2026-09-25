# HMS Demo Walkthrough

The live demo script. Every step shows the client–server interaction a networks
course grades. Seed accounts are created by the backend seed script.

## Demo accounts (seeded)

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@hms.example.com` | *(set in seed script)* |
| Doctor | `amina.haddad@hms.example.com` | 〃 |
| Nurse | `nurse@hms.example.com` | 〃 |
| Pharmacist | `pharmacist@hms.example.com` | 〃 |
| Patient | `patient@hms.example.com` | 〃 |

Also seeded (for richer demos): `omar.benali@hms.example.com` (Cardiology),
`salma.trabelsi@hms.example.com` (Pediatrics), `leila.mansour@hms.example.com` (patient).

## Pre-flight (before starting)

- [ ] Both VMs up; `ping 10.0.2.10` works from `hms-desktop`
- [ ] `hms-api` systemd service active: `systemctl status hms-api`
- [ ] Swagger loads: `http://10.0.2.10:8000/docs`
- [ ] SPA loads: `http://10.0.2.20/`
- [ ] Database seeded (5 demo users, 2+ departments, doctors with slots, ≥3
      medications with stock, one historic completed visit)

## The story: one patient's visit, end to end

**Act 1 — Booking (Patient + Admin personas)**

1. Login as **Patient** → book an appointment: pick department → doctor → free slot.
   *(Show the slot disappearing from the picker after booking.)*
2. Show "My appointments" — only this patient's data is visible.
3. *(Network beat: open devtools Network tab — show the `POST /api/appointments`
   request to `10.0.2.10:8000` with the JWT in the Authorization header.)*

**Act 2 — Check-in (Nurse persona)**

4. Login as **Nurse** (new incognito window or logout) → open today's appointment →
   record vitals (BP 128/84, temp 37.2, pulse 88, weight 70).

**Act 3 — Consultation (Doctor persona)**

5. Login as **Doctor** → open the appointment → see the nurse's vitals → write
   diagnosis + notes → prescribe 2 medications (one in stock, one low-stock to set
   up Act 4).
6. Mark appointment **completed** → invoice is auto-created with the consultation
   fee.

**Act 4 — Pharmacy (Pharmacist persona)**

7. Login as **Pharmacist** → dispensing queue shows the new prescription → dispense
   both items → stock quantities visibly decrease → low-stock warning appears on the
   second item.
8. *(Show the refusal path: try dispensing an out-of-stock medication — backend
   refuses.)*

**Act 5 — Billing (Admin persona)**

9. Login as **Admin** → billing dashboard → the visit's invoice now lists the
   consultation fee **plus** the dispensed items → mark **paid**.
10. Back as **Patient** — they can see their appointment, consultation, and invoice.

**Act 6 — Management (Admin persona, quick pass)**

11. Create a department, a doctor user, and show slot creation — the loop closes.

## Optional 30-second deep-dive, if the grader asks "where's the networking?"

- `curl -v http://10.0.2.10:8000/api/medications` from the desktop VM — raw HTTP
  over the NAT network, `401` without a token.
- Swagger UI request/response as the API contract.
- `systemctl status hms-api` + `nginx` service on the desktop.

## Recovery playbook (things going wrong mid-demo)

| Symptom | Fix |
|---------|-----|
| API unreachable from desktop | `systemctl status hms-api`, then check `ip a` on both VMs |
| CORS error in console | API base URL wrong in the build — check the deployed `VITE_API_BASE_URL` |
| Login fails | Re-run seed script; confirm password in seed config |
| Slot won't book | Already taken — pick another; explains the uniqueness rule |