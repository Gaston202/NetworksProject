#!/usr/bin/env python3
"""Demonstrate the HTTP status-code scenarios against the deployed HMS server.

Pass-tier requirement: at least 5 distinct, working HTTP scenarios. Standard
library only (urllib), so it runs on a stock Ubuntu Desktop client with no
installs. Read-only against the demo data: every request either reads or is
refused, so it can be re-run during the demo.

Run from a client VM:
    python3 http_scenarios.py                         # http://192.168.100.10
    python3 http_scenarios.py http://192.168.100.10   # explicit server
Password of the seeded accounts: env HMS_PASSWORD (default hms-demo-1234).
Exit code 0 when every scenario returned its expected status.
"""
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_SERVER = "http://192.168.100.10"
PASSWORD = os.environ.get("HMS_PASSWORD", "hms-demo-1234")
ADMIN_EMAIL = "admin@hms.example.com"
PATIENT_EMAIL = "patient@hms.example.com"
MISSING_ID = 999999
TIMEOUT_SECONDS = 10


def call(base, method, path, token=None, body=None):
    """Return (status, parsed JSON body or None). HTTP errors are results, not exceptions."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, method=method)
    if token:
        request.add_header("Authorization", "Bearer " + token)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return response.status, _json(response.read())
    except urllib.error.HTTPError as err:
        return err.code, _json(err.read())


def _json(raw):
    try:
        return json.loads(raw or b"null")
    except ValueError:
        return None


def login(base, email):
    status, payload = call(base, "POST", "/api/auth/login",
                           body={"email": email, "password": PASSWORD})
    if status != 200:
        sys.exit(f"Cannot log in as {email} (HTTP {status}) - is the demo data seeded?")
    return payload["access_token"]


def main():
    base = (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SERVER).rstrip("/")
    print(f"HMS HTTP scenarios against {base}\n")
    try:
        admin = login(base, ADMIN_EMAIL)
        patient = login(base, PATIENT_EMAIL)
    except urllib.error.URLError as err:
        sys.exit(f"Cannot reach {base}: {err.reason}")

    # (expected status, what it shows, method, path, token, body)
    scenarios = [
        (200, "OK - server and database healthy", "GET", "/api/health", None, None),
        (401, "Unauthorized - no token", "GET", "/api/auth/me", None, None),
        (401, "Unauthorized - wrong password", "POST", "/api/auth/login", None,
         {"email": PATIENT_EMAIL, "password": "wrong-password"}),
        (403, "Forbidden - patient calls an admin route", "GET", "/api/users", patient, None),
        (404, "Not Found - unknown appointment", "GET",
         f"/api/appointments/{MISSING_ID}", admin, None),
        (405, "Method Not Allowed - DELETE on a GET route", "DELETE", "/api/health", None, None),
        (409, "Conflict - email already registered", "POST", "/api/auth/register", None,
         {"full_name": "Duplicate", "email": PATIENT_EMAIL, "password": "duplicate-pass-1"}),
        (422, "Unprocessable - login body missing fields", "POST", "/api/auth/login", None, {}),
    ]

    failures = 0
    print(f"{'EXPECTED':<9}{'GOT':<6}{'RESULT':<8}{'REQUEST':<36}SCENARIO")
    for expected, label, method, path, token, body in scenarios:
        status, _ = call(base, method, path, token=token, body=body)
        ok = status == expected
        failures += not ok
        print(f"{expected:<9}{status:<6}{'PASS' if ok else 'FAIL':<8}"
              f"{method + ' ' + path:<36}{label}")

    print(f"\n{len(scenarios) - failures}/{len(scenarios)} scenarios behaved as expected")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
