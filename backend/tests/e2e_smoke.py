"""HMS end-to-end smoke: drives the 4-act demo story over HTTP.

Run against http://localhost:8000 (uvicorn, Dockerized PostgreSQL dev DB).
Exit 0 = all assertions passed.
"""
import json
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta

BASE = "http://localhost:8000/api"
PASSWORD = "hms-demo-1234"

passed = 0


def call(method, path, token=None, body=None, expect=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Authorization", "Bearer " + token) if token else None
    data = json.dumps(body).encode() if body is not None else None
    req.add_header("Content-Type", "application/json") if data else None
    try:
        with urllib.request.urlopen(req, data, timeout=10) as resp:
            code = resp.status
            payload = json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as err:
        code = err.code
        try:
            payload = json.loads(err.read() or b"null")
        except Exception:
            payload = None
    if expect is not None and code != expect:
        print(f"FAIL {method} {path}: expected {expect}, got {code}: {payload}")
        sys.exit(1)
    return code, payload


def step(label):
    global passed
    passed += 1
    print(f"ok {passed:>2}  {label}")


# --- login the seeded accounts ---------------------------------------------
_, token_out = call("POST", "/auth/login", body={
    "email": "admin@hms.example.com", "password": PASSWORD}, expect=200)
admin = token_out["access_token"]
step("admin login")

_, token_out = call("POST", "/auth/login", body={
    "email": "amina.haddad@hms.example.com", "password": PASSWORD}, expect=200)
doctor = token_out["access_token"]
step("doctor login (Dr. Haddad)")

code, token_out = call("POST", "/auth/login", body={
    "email": "patient@hms.example.com", "password": PASSWORD}, expect=200)
patient = token_out["access_token"]
step("patient login (Sami)")

code, reg = call("POST", "/auth/register", body={
    "full_name": "E2E Fresh Patient", "email": "e2e.fresh@example.com",
    "password": "e2e-password-1"}, expect=201)
fresh = reg["access_token"]
step("public registration creates a Patient (201)")

# --- guards ------------------------------------------------------------------
code, _ = call("POST", "/auth/staff", token=admin, body={
    "full_name": "Should Not Exist", "email": "guard.nurse@example.com",
    "password": "unused-password-1", "role": "nurse"})
assert code == 422, f"nurse role should be rejected, got {code}"
step("staff creation with role 'nurse' refused (422)")

code, _ = call("GET", "/users", token=patient)
assert code == 403, code
step("patient reading /users -> 403 (role guard)")

code, _ = call("GET", "/invoices", token=doctor)
assert code == 403, code
step("doctor reading /invoices -> 403")

# --- Act 1: patient booking --------------------------------------------------
code, departments = call("GET", "/departments", token=patient, expect=200)
step(f"departments listed ({len(departments)})")

code, doctors = call("GET", "/doctors", token=patient, expect=200)
cardio = next(d for d in doctors if d["department_name"] == "Cardiology")
step(f"doctors listed; picked {cardio['full_name']}")

code, slots = call("GET", f"/doctors/{cardio['id']}/slots?free=true",
                   token=patient, expect=200)
assert len(slots) > 0, "no free slots"
slot = slots[0]
step(f"{len(slots)} free slots; picked {slot['starts_at']}")

code, appt = call("POST", "/appointments", token=patient,
                  body={"slot_id": slot["id"]}, expect=201)
step("patient books own slot (201)")

call("POST", "/appointments", token=fresh, body={"slot_id": slot["id"]},
     expect=409)
step("second patient booking same slot -> 409 (slot uniqueness)")

code, fresh_list = call("GET", "/appointments", token=fresh, expect=200)
assert all(a["id"] != appt["id"] for a in fresh_list), "patient sees others' data!"
step("each patient's list contains only their own appointments")

code, _ = call("GET", f"/appointments/{appt['id']}", token=fresh)
assert code == 403, code
step("patient A reading patient B's appointment -> 403 (per-row ownership)")

# Admin walk-in booking for an existing patient
_, patients_dir = call("GET", "/patients", token=admin, expect=200)
leila = next(p for p in patients_dir if "mansour" in p["email"])
_, walkin = call("POST", "/appointments", token=admin, body={
    "slot_id": slots[1]["id"], "patient_id": leila["id"]}, expect=201)
step(f"admin walk-in booking for {leila['full_name']} (201)")

# --- Act 2: doctor consultation ----------------------------------------------
code, appt_detail = call("GET", f"/appointments/{appt['id']}", token=doctor,
                         expect=200)
assert appt_detail["consultation"] is None
step("doctor opens own appointment")

code, consultation = call(
    "POST", f"/appointments/{appt['id']}/consultation", token=doctor,
    body={"diagnosis": "Stable angina, exertional", "notes": "ECG within normal limits",
          "prescription": "Aspirin 75mg, 1x daily, 30 days"}, expect=201)
step("doctor writes consultation incl. free-text Rx (201)")

call("POST", f"/appointments/{appt['id']}/consultation", token=doctor,
     body={"diagnosis": "duplicate"}, expect=409)
step("second consultation on same appointment -> 409 (one per appointment)")

code, doc_list = call("GET", "/appointments", token=doctor, expect=200)
assert all(a["doctor_id"] == appt_detail["doctor_id"] for a in doc_list)
step("doctor sees only own appointments")

# --- complete + derived invoice ----------------------------------------------
code, completed = call("PATCH", f"/appointments/{appt['id']}/complete",
                       token=doctor, expect=200)
assert completed["status"] == "completed", completed["status"]
assert completed["invoice"] is not None, "invoice not derived!"
assert float(completed["invoice"]["total"]) == 25.0
assert completed["invoice"]["status"] == "unpaid"
step("doctor completes -> invoice auto-derived at consultation fee (25.0)")

code, _ = call("PATCH", f"/appointments/{appt['id']}/complete", token=doctor)
assert code == 409, code
step("re-completing -> 409 (invoice derived exactly once)")

code, _ = call("PATCH", f"/appointments/{appt['id']}/cancel", token=admin)
assert code == 409, code
step("cancelling a completed appointment -> 409")

# --- Act 3: billing -----------------------------------------------------------
code, invoices = call("GET", "/invoices", token=admin, expect=200)
inv = next(i for i in invoices if i["appointment_id"] == appt["id"])
code, paid = call("PATCH", f"/invoices/{inv['id']}/paid", token=admin, expect=200)
assert paid["status"] == "paid"
step("admin marks the visit's invoice paid")

code, patient_invoices = call("GET", "/invoices", token=patient, expect=200)
assert any(i["id"] == inv["id"] for i in patient_invoices)
assert all(i["patient_id"] if "patient_id" in i else True for i in patient_invoices)
walkin_ids = {walkin["id"]}
code, appt2 = call("GET", f"/appointments/{walkin['id']}", token=patient)
assert code == 403, f"patient sees another patient's appointment: {code}"
step("patient sees own invoices; cannot see the walk-in visit")

# --- Act 4: admin management ---------------------------------------------------
code, dept = call("POST", "/departments", token=admin,
                  body={"name": "E2E Testing Ward"}, expect=201)
step("admin creates a department")

code, newdoctor = call("POST", "/auth/staff", token=admin, body={
    "full_name": "Dr. E2E New", "email": "e2e.doctor@example.com",
    "password": "e2e-doctor-pass-1", "role": "doctor",
    "department_id": dept["id"], "specialty": "Testology"}, expect=201)
step("admin creates a doctor user (201)")

code, doctor_dir = call("GET", "/doctors", token=admin, expect=200)
haddad = next(d for d in doctor_dir if "haddad" in d["email"])
other = next(d for d in doctor_dir if d["id"] != haddad["id"])
step("doctor directory resolves two distinct doctor profile ids")

# The seed covers the next 7 days (09-12, 14-16), so create slots beyond it.
in_ten_days = (date.today() + timedelta(days=10)).isoformat()
code, created = call("POST", f"/doctors/{other['id']}/slots", token=admin, body={
    "first_date": in_ten_days, "days": 2, "start_hour": 17,
    "hours_per_day": 1.5}, expect=201)
step("admin bulk-creates slots for a doctor (201)")

code, _ = call("POST", f"/doctors/{other['id']}/slots", token=doctor, body={
    "first_date": in_ten_days, "days": 1, "start_hour": 17, "hours_per_day": 1})
assert code == 403, f"doctor must not create slots for another doctor: {code}"
step("doctor creating slots for another doctor -> 403")

code, _ = call("DELETE", f"/departments/{dept['id']}", token=admin)
assert code == 409, code
step("deleting a department with doctors -> 409 (referential safety)")

# --- deactivation ---------------------------------------------------------------
code, users = call("GET", "/users", token=admin, expect=200)
fresh_user = next(u for u in users if u["email"] == "e2e.fresh@example.com")
call("PATCH", f"/users/{fresh_user['id']}", token=admin,
     body={"is_active": False}, expect=200)
code, _ = call("GET", "/auth/me", token=fresh)
assert code == 401, code
step("deactivated account's token rejected -> 401 (is_active guard)")

print(f"\nALL {passed} E2E STEPS PASSED")