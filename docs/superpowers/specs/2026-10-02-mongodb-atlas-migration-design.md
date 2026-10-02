# MongoDB Atlas Migration — Design Spec

- **Status:** Approved in conversation (design sections §1–§4 + one amendment); pending spec review
- **Date:** 2026-10-02
- **Deciders:** Project owner, Claude
- **Related ADRs:** 0002 (deployment topology), 0003 (FastAPI stack), 0004 (database — this spec reverses it), 0005 (VirtualBox network mode), 0006 (JWT), 0007 (roles/RBAC), 0008 (module scope), 0009 (appointments), 0010 (visit-based EMR), 0012 (billing)

## 1. Context and goals

HMS backend is FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL (ADR-0003/0004):
sync endpoints, `db.query(...)` ORM expressions, 8 tables across `scheduling`,
`clinical`, `billing`, `user` modules, Postgres-enforced invariants, Alembic
migrations, Dockerized dev Postgres on host port 5433, and native PostgreSQL
installed on the `hms-server` Ubuntu VM in deployment.

**Motivations for switching (user, 2026-10-02):**
1. **Easier VM operations** — the DB becomes a connection string; no Postgres
   install, service, or snapshot tooling on the VM.
2. **Learning MongoDB** — exposure to document modeling and Mongo idioms in a
   real codebase.

**Decision:** replace PostgreSQL (clustered on the VM) with **MongoDB Atlas**
(cluster `cluster0.bgop6.mongodb.net`, `mongodb+srv://` SRV string), accessed
from FastAPI by **Motor** (async driver), with **all endpoints converted to
`async def`** (approach B, chosen over sync PyMongo [A] and Beanie ODM [C]).
Driver chosen as Motor (mature, documented, FastAPI-tutorial standard) over
PyMongo's newer native async API.

**Constraints:**
- Demo deadline **2026-10-23** (≈3 weeks).
- **API contract is frozen**: paths, query params, request/response shapes,
  status codes, and role-guard semantics stay identical.
- `tests/e2e_smoke.py` (31 assertions, `ALL 31 E2E STEPS PASSED`) is the
  acceptance harness and must keep passing with HTTP logic unchanged.
- The **frontend is untouched** (hence integer IDs are preserved, §3).

## 2. Non-goals

- No frontend changes. No API shape/path changes. No new features.
- No data migration from the existing Postgres demo DB — Atlas starts empty
  and is populated by the rewritten seed; existing pg data is disposable.
- No local MongoDB fallback: Atlas is the only database, for dev and deploy.
- No multi-document transactions (Atlas M0 may not support them; the design
  never needs them — see §4).

## 3. Data model

Eight **collections** with integer `_id`s minted from a `counters` collection
so path params (`/appointments/{appointment_id: int}`), Pydantic schemas, and
the frontend keep working unchanged:

| Collection | Fields (beyond `_id`) | Indexes |
|---|---|---|
| `users` | full_name, email, password_hash (bcrypt), role `"admin"\|"doctor"\|"patient"`, is_active, created_at | `email` unique |
| `departments` | name | `name` unique |
| `doctor_profiles` | user_id, department_id, specialty | `user_id` unique |
| `patient_profiles` | user_id, date_of_birth, phone, address | `user_id` unique |
| `availability_slots` | doctor_id, starts_at, ends_at | `{doctor_id, starts_at}` unique; `{doctor_id, starts_at}` query index is covered by it |
| `appointments` | slot_id, patient_id, doctor_id, status, **starts_at, ends_at (copied at booking)**, created_at, **consultation (embedded subdocument, §4)** | `slot_id` unique **sparse**; `patient_id`; `doctor_id` |
| `invoices` | appointment_id, **patient_id (internal denormalization)**, total, status, created_at | `appointment_id` unique |
| `counters` | one doc per reserved sequence: `{_id: <collection>, n: int}` | — |

Conventions:

- **Integer IDs** via `counters`: `find_one_and_update({"_id": name}, {"$inc": {"n": 1}}, upsert=True, return_document="after")`. Bulk inserts (seed's 210 slots, `POST /doctors/{id}/slots` windows) reserve a range with a `$inc: {"n": n}` and assign ids sequentially, then `insert_many`.
- **Roles/statuses are plain strings** with the exact values today's enum
  values produce (`"booked"`, `"paid"`, ...). Validation stays in Pydantic
  schemas and route logic.
- **Datetimes** — application-generated, stored as **naive UTC** (matching
  today's serialization; the VM's local-clock seeding behavior is preserved).
- **Slot times are copied** onto the appointment at booking (slots are
  immutable once created) and survive cancellation, so every appointment
  display keeps its time with **zero joins**.
- **Consultation is embedded** on the appointment (not a separate
  collection): 1:1, write-once, always displayed with the appointment. Its
  subdocument carries `diagnosis`, `notes`, `prescription`, `created_at`.
- `invoices.patient_id` is an internal field to dissolve the patient-invoice
  join (§4); it is **not** added to `InvoiceOut` (response shape frozen).
- **No copies of user `full_name`/`email` anywhere.** (Chat-stage amendment:
  the earlier "immutable-name denormalization" idea was retracted because
  `PATCH /users/{id}` renames users, `admin.py:59`.) Directory joins are
  two-query id-maps, §5.

## 4. Invariant contract — Postgres enforcement → MongoDB enforcement

| # | Today (PostgreSQL) | MongoDB version |
|---|---|---|
| 1 | Registered email unique (unique index + `IntegrityError`→409) | `users.email` unique index; `DuplicateKeyError`→409 |
| 2 | Slot booked by at most one *active* appointment (partial unique index on non-cancelled rows); cancellation frees the slot | `appointments.slot_id` **unique + sparse** index. Cancel performs one atomic `update_one`: `$set status="cancelled"` + `$unset slot_id` — a missing field is skipped by the sparse index, so only cancelled appointments don't count. Booking race: `insert_one` hits the index, duplicate-key → `409 "Slot taken - pick another"` (same as today) |
| 3 | Invoice derived exactly once (unique `invoices.appointment_id` inside the same transaction as completion) | Completion = guarded `update_one({"_id": id, "status": {"$in": ["booked", "consulted"]}}, {"$set": {"status": "completed"}})`; matched count 1 → `insert_one` invoice against the unique `appointment_id` index. Duplicate key → re-read; `409 "Appointment already completed"` with exactly-one invoice guaranteed (today: rollback → 409 same message) |
| 4 | One consultation per appointment, only while `booked` (unique constraint + same transaction as the status move) | **One atomic guarded update**: `update_one({"_id": id, "status": "booked", "consultation": {"$exists": false}}, {"$set": {"status": "consulted", "consultation": {...}}})`. Matched 0 → distinguish via re-read: no appointment → 404 (checked earlier), duplicate consultation → `409 "Appointment already has a consultation"`, wrong status → `409 "... written while booked"` (same messages as today) |
| 5 | Referential checks (department-with-doctors delete → 409; walk-in patient must exist; slot must exist) are pre-check queries before writes | **Same pre-check queries** expressed as `find_one`/`count`; no behavior change |
| 6 | Overlapping slot creation rejected by a pre-check (`_overlaps`) — race-unsafe in PG too, duplicates possible under concurrency | Same pre-check, **plus** the unique `{doctor_id, starts_at}` index as a new race guard for exact-duplicate windows; duplicate key maps to the same `409 "overlaps existing slots"` response. Overlapping-but-unequal windows stay pre-check-only (parity) |

No endpoint uses or needs multi-document transactions; single-document
atomicity plus unique indexes cover everything the e2e suite asserts.

## 5. Async conversion and wiring

- **`core/config.py`**: `database_url` → `mongodb_url` (**no default** —
  a missing `MONGODB_URL` fails loudly at startup) + `mongodb_db: str = "hms"`
  (Atlas URL carries no db name). Other settings unchanged.
- **`db/base.py`** rewrite: module-scoped `AsyncIOMotorClient`; `get_db`
  becomes an **async dependency yielding the database object** (no
  per-request cleanup — the pooled client outlives requests); helpers
  `next_id(collection)` and `reserve_ids(collection, n)` wrapping `counters`.
- **`main.py`**: async lifespan — ensure all indexes (idempotent
  `create_index` calls) at startup; `client.close()` at shutdown; CORS and
  router wiring unchanged.
- **`api/deps.py`**: `get_current_user` → async, `find_one({"_id": int(payload["sub"])})`;
  `require_role` logic unchanged (pure Python, already sync).
- **All six route files** (`health`, `auth`, `scheduling`, `clinical`,
  `billing`, `admin`) → `async def` with awaited queries. Translation table:
  - `db.get(X, id)` → `await db.x.find_one({"_id": id})` (+ 404 as today)
  - `.query(X).filter(...).first()` → `find_one({...})`
  - `.all()` → `.to_list(length=None)` (pagination is not a feature today)
  - `.order_by(...)` → `.sort("field", 1/-1)`
  - `db.add/commit/refresh` → `insert_one` / `update_one` (+ the doc itself
    is the post-write state; `insert_one.inserted_id` yields new ids)
- **Directory joins become id-maps, not denormalization** (rename-safe):
  `GET /doctors` fetches `doctor_profiles` (+ departments) then
  `find({"_id": {"$in": [user_ids]}})` on `users` and assembles in Python;
  `GET /patients` does the same for patient profiles (sorted by full_name in
  memory, list stays small). No `$lookup` aggregations; no stale copies.
- **bcrypt** hash/verify are CPU-bound: wrapped in
  `fastapi.concurrency.run_in_threadpool` inside async handlers so the event
  loop isn't blocked. `core/security.py` (pure functions) is unchanged.
- **Error mapping**: `pymongo.errors.DuplicateKeyError` (E11000) → 409 in the
  three places §4 rows 1/2/3 use it; matched-count-0 guards drive the
  transition conflicts in §4 row 3/4. `/health` gains an awaited `db ping`
  (`command("ping")`) and keeps its response shape.
- Porting note: the dead duplicate query in `list_doctor_slots`
  (`scheduling.py:196-201` — `booked` is computed then unused) is removed by
  the port: free slots are determined from the set of occupied `slot_id`s
  (`appointments.find({"slot_id": {"$exists": true}})`).

### 5.1 Design deviation from the chat-approved §2

The chat approved copying `full_name`/`email` onto profile documents on the
"no rename feature exists" premise. That premise was false (`admin.py:59`
renames users). Correction (folded into §3/§5): **no copies**; directories
use id-map joins. Rename correctness comes free; the cost is one extra
awaited `find` per directory request on a tiny collection.

## 6. Seed and e2e

- **`app/seed.py`** → rewritten async (`asyncio.run`), Motor client directly,
  same demo data: 3 departments, 1 admin + 3 doctors + 2 patients (bcrypt
  from `SEED_PASSWORD`), profiles with specialty/phone, 210 slots
  (7 days × 09:00–12:00 & 14:00–16:00 × 30 min × 3 doctors) via a counters
  range reserve + `insert_many`, idempotency check: admin email already
  present → skip. The `Base.metadata.create_all` dev-convenience call is gone
  (no schema concept; indexes come from `app/db/indexes.py`).
- **`app/db/indexes.py`** (new): builds §3's indexes at startup, idempotent.
- **`tests/e2e_smoke.py`**: **HTTP logic and all 31 assertions unchanged**;
  docstring and any prep-comment updates only. Reset before a run:
  **drop the `hms` database in Atlas** (Atlas UI, Compass, or mongosh) →
  `python -m app.seed` → run the smoke test. (The suite registers
  `e2e.fresh@example.com` with `expect=201`, so re-running needs the reset —
  same as it needed a fresh pg DB today.)
- New dev runbook (README): set `MONGODB_URL` in `backend/.env` →
  `.venv/Scripts/python -m app.seed` → `.venv/Scripts/uvicorn app.main:app
  --reload`. No Docker, no migrations.

## 7. Files: additions, removals, edits

**Delete:** `backend/docker-compose.yml`, `backend/alembic.ini`, `backend/alembic/`
(verify contents exist before deleting), `backend/app/models/` directory
(SQLAlchemy models are replaced by document helpers under `app/db/`).

**requirements.txt:** remove `sqlalchemy`, `alembic`, `psycopg2-binary`;
add `motor>=3.6`. All other deps (fastapi, uvicorn, pydantic,
pydantic-settings, email-validator, bcrypt, PyJWT) unchanged.

**Rewrite:** `app/core/config.py`, `app/db/base.py`, `app/api/deps.py`,
`six route files`, `app/seed.py`, `.env.example`, `backend/README.md`.

**Add:** `app/db/indexes.py` (index definitions), `app/db/mongo.py` or
equivalent if the client/collections object needs a home beyond
`db/base.py` (final layout is the implementation plan's call; behavior is
specified here).

**Touch (docs/deploy):** root `README.md`, `docs/roadmap.md`,
`docs/network-topology.md`, `docs/glossary.md`, `docs/domain-model.md`
(table→collection wording; verify during implementation), `docs/adr/ADR-0002`,
`ADR-0003`, `ADR-0004`, `ADR-0005`, `deploy/README.md`,
`deploy/server-provision.sh`, `deploy/hms-api.service`,
`deploy/desktop-setup.sh` (verify for DB references).

**Untouched:** `backend/app/schemas.py`, `backend/app/core/security.py`,
everything in `frontend/`.

## 8. Deployment (Atlas)

- **`deploy/server-provision.sh`**: drop the `postgresql libpq-dev` install
  and the `createuser`/`createdb` block; keep venv/pip setup and `SECRET_KEY`
  generation. The script takes the real Atlas string as `MONGODB_URL`
  (env var passed by the operator at provision time; if unset it writes a
  placeholder *and* exits with a loud warning). Writes it into the
  backend env consumed by `hms-api.service`.
- **`deploy/hms-api.service`**: remove `After/Wants=postgresql.service`;
  `DATABASE_URL` → `MONGODB_URL`.
- **Atlas network access list**: allow the `hms-server` VM's public IP (the
  operator copies it in the Atlas UI). `0.0.0.0/0` is documented as the
  demo-day fallback with an explicit security note, consistent with the
  ADR-0002 "plain HTTP is a known, scoped limitation" style.
- **Networking story for the course docs**: the DB leg moves from an
  intra-VM UNIX socket / private port to **VM → Atlas over TCP/27017 with
  DNS SRV discovery and TLS** (`mongodb+srv`). `docs/network-topology.md`
  documents the new edge; firewall egress for port 27017 to Atlas's
  endpoints is the one new network requirement.
- **Demo snapshots**: `pg_dump`/`pg_restore` becomes "drop `hms` + re-seed"
  (optionally `mongodump/mongorestore` for true snapshots; documented as
  optional).
- **Known demo-day dependency**: the API now requires internet egress to
  Atlas — documented in the deploy README.

## 9. ADRs (edited in place, per project convention)

- **ADR-0004** → retitled **Database — MongoDB Atlas**; Context states both
  the original 2026-09-25 decision and its 2026-10-02 reverse (VM-ops
  reduction + learning goals); Decision: Atlas + Motor async; Consequences:
  invariants enforced by unique indexes + single-document atomicity
  (table §4), no server-side schema/migrations (index bootstrap instead),
  DB leaves the VM, no `pg_dump` snapshots, and the accepted tradeoff of
  document denormalization where listed (slot time copy, invoice patient_id).
- **ADR-0002**: deployment topology keeps two VMs; the DB leg is Atlas-over-TLS.
- **ADR-0003**: dependency list drops SQLAlchemy/Alembic/psycopg2, adds Motor;
  endpoints are async now.
- **ADR-0005**: firewall statements about a local DB port updated to Atlas
  egress (verify text in implementation).

## 10. Success criteria

1. `python tests/e2e_smoke.py` → **ALL 31 E2E STEPS PASSED** against the
   Atlas-backed API (HTTP logic unchanged).
2. `/api/health` returns 200 with its existing shape, backed by a live ping.
3. The four-act demo story (book → consult → complete → paid) works through
   the **untouched** frontend.
4. `grep -ri "postgres\|sqlalchemy\|alembic\|psycopg"` over code/deploy
   returns nothing (ADR narrative references excepted); the VM provisions
   with no Postgres packages installed.
5. Real credentials exist only in `.env`/VM env — never in the repo.

## 11. Risks and documented limitations

- **Atlas M0**: free tier may lack multi-document transactions — the design
  never uses them (§4); single-document writes plus unique indexes suffice.
- **Sequential writes where PG had one transaction**: `POST /auth/register`
  and `POST /auth/staff` insert the user then the profile (two writes). A
  crash between them leaves a user without a profile; the email unique index
  still guards duplicates. Documented as an accepted demo-scope limitation
  (same class as ADR-0002's plain-HTTP note).
- **Rename consistency**: guaranteed by id-map joins (§5.1), at the cost of
  no denormalized display names.
- **Atlas availability/latency**: a cloud dependency on demo day; egress
  allowlisting must be done ahead of the demo (deploy README checklist).
- **Naive-UTC datetime convention** matches current serialization; no
  timezone migration.