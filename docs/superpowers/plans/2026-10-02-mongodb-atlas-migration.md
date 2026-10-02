# MongoDB Atlas Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PostgreSQL/SQLAlchemy/Alembic with MongoDB Atlas accessed by async Motor, keeping the frozen REST contract and the 31-step e2e smoke green.

**Architecture:** A module-scoped `AsyncIOMotorClient` + `AsyncIOMotorDatabase` replaces the SQLAlchemy engine; all six route modules become `async def` with awaited Motor calls. Invariants the Postgres constraints enforced move to unique indexes + single-document atomic updates (spec §4). Integer ids survive via a `counters` collection (`$inc` reservation) so schemas, frontend, and e2e are untouched. Migration runs green-boot-first: the Mongo stack lands alongside a still-live SQLAlchemy stack, and Task 8 flips `requirements.txt`/deletes the old stack last.

**Tech Stack:** FastAPI (all-async) + Motor (async MongoDB driver) + Pydantic v2 + MongoDB Atlas (`mongodb+srv://`, cluster `cluster0.bgop6.mongodb.net`).

**Spec:** `docs/superpowers/specs/2026-10-02-mongodb-atlas-migration-design.md` — read it first; this plan argues from it. Data model §3, invariant contract §4, async wiring §5, seed/e2e §6, deployment §8.

## Environment (executor notes)

- Windows host, Git Bash, repo root `C:\Users\ghass\NetworksProject`. All backend commands run from `backend/` with the existing venv: `.venv/Scripts/python`, `.venv/Scripts/pip`, `.venv/Scripts/uvicorn`.
- uvicorn for verifies: `.venv/Scripts/python -m uvicorn app.main:app --port 8000` (run in a background shell; verify with `curl -s http://localhost:8000/api/health`; stop it afterward).
- The user's real Atlas password is **unknown to the executor**: Task 1 has a user-action step to paste `MONGODB_URL` into `backend/.env`.
- e2e reset (drop + re-seed), used in Tasks 4 and 8:
  ```bash
  cd backend
  .venv/Scripts/python -c "import asyncio; from app.db.mongo import client; asyncio.run(client.drop_database('hms'))"
  .venv/Scripts/python -m app.seed
  ```

## Global Constraints

- Demo deadline **2026-10-23** (~3 weeks) — the full plan fits; do not expand scope.
- **API contract is frozen**: paths, query params, request/response shapes (`app/schemas.py` is untouched), status codes, and role-guard semantics stay identical. Exact response values: roles `admin|doctor|patient`; appointment statuses `booked|consulted|completed|cancelled|no_show`; invoice statuses `unpaid|paid`; consultation fee `25.0`; `ConsultationOut.id == appointment_id`; `AppointmentOut.slot_id` is a non-Optional int even after cancel (`original_slot_id`).
- **No multi-document transactions** (Atlas M0): every invariant rides single-document atomicity + unique indexes (spec §4).
- `tests/e2e_smoke.py`: HTTP logic and all 31 assertions unchanged; only the docstring line about the dev DB may be edited. Acceptance = `ALL 31 E2E STEPS PASSED`.
- No copies of user `full_name`/`email` anywhere; directory endpoints use two-query id-map joins (spec §5.1).
- Application-generated datetimes are **naive UTC** (`app.db.mongo.utcnow`); user-supplied `date` values are stored as UTC-midnight datetimes (`date_to_dt`); seeded slot window times stay local-clock (`datetime.now()`), matching today.
- `MONGODB_URL` and any real credentials exist only in `backend/.env` (gitignored) / VM env — **never committed**.
- bcrypt hash/verify (CPU-bound) are wrapped in `fastapi.concurrency.run_in_threadpool` inside async handlers; `app/core/security.py` is unchanged.
- ADRs are **edited in place**, never superseded (project convention).
- One conventional commit per task, message ending with `Co-Authored-By: Claude Code <noreply@anthropic.com>`. Do not commit `backend/.env`.
- Boot stays green after every task until Task 8 (the SQLA stack keeps working; `database_url` stays in config until Task 8).

## Review Focus

Failure modes the spec implies but no automated test pins — each line names its owning task's verify step:

1. **Slot race** — two simultaneous bookings of the same free slot: exactly one 201, the other 409 `"Slot taken - pick another"`; after a cancel (`$unset slot_id`), the same slot books again. → Task 5 verify (double-book curl ×2, cancel, re-book).
2. **Invoice derivation exactly once** — re-completing a completed appointment returns 409 `"Appointment already completed"` and `appointments` holds exactly one invoice per completed visit. → Task 5 verify (re-complete 409 + invoice count query).
3. **One consultation per appointment** — duplicate `POST .../consultation` → 409, and the guarded atomic update means the status move and the subdocument write can't split. → Task 6 verify.
4. **Rename correctness** — admin rename / department move via `PATCH /users/{id}` must be reflected immediately in `/doctors` and `/patients` (id-map joins, zero stale copies). → Task 3 verify (rename → re-fetch both directories).
5. **Atlas dependency fails loud, not half-dead** — missing `MONGODB_URL` aborts startup with `ValidationError`; with the URL set but Atlas down, requests surface as Motor errors → `/api/health` returns 503 `"Database unreachable"` (serverSelectionTimeoutMS=10s), never a silent lie. → Task 2 verify (bad-URL ping) + Task 3 verify (health route).

---

### Task 1: Atlas configuration + Motor dependency

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/core/config.py`
- Modify: `backend/.env.example`
- User action: `backend/.env` (gitignored; executor cannot write it)

**Interfaces:**
- Consumes: existing `app.core.config.settings`.
- Produces: `settings.mongodb_url: str` (no default — missing `MONGODB_URL` raises at import), `settings.mongodb_db: str = "hms"`; `motor` + `dnspython` installed in the venv (dnspython is **required** to resolve `mongodb+srv://` URIs — without it Motor raises "The 'dnspython' module must be installed"). `database_url` remains for the unconverted SQLA stack until Task 8.

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feature/mongodb-atlas-migration
```

- [ ] **Step 2: Add Motor to requirements.txt**

Edit `backend/requirements.txt` — insert `motor>=3.6` and `dnspython>=2.6` after `bcrypt>=4.1`:

```text
fastapi>=0.115
uvicorn[standard]>=0.30
sqlalchemy>=2.0
alembic>=1.13
pydantic>=2.7
pydantic-settings>=2.2
email-validator>=2.1
bcrypt>=4.1
motor>=3.6
dnspython>=2.6
PyJWT>=2.8
psycopg2-binary>=2.9
```

Install it right away:

```bash
cd backend
.venv/Scripts/pip install "motor>=3.6" "dnspython>=2.6"
```

- [ ] **Step 3: Add the Mongo settings**

Edit `backend/app/core/config.py` — replace the comment + `database_url` field (lines 8–10) with:

```python
    # The database is MongoDB Atlas (ADR-0004) - no default: a missing
    # MONGODB_URL fails loudly at startup rather than reaching for a local DB.
    mongodb_url: str
    mongodb_db: str = "hms"

    # Transitional: still used by the SQLAlchemy modules until Task 7
    # lands; removed with the SQLA stack in the final task.
    database_url: str = "postgresql+psycopg2://hms:hms_dev_password@localhost:5433/hms"
```

(Leave every other field and the property unchanged.)

- [ ] **Step 4: Rewrite .env.example**

Replace the whole `backend/.env.example` with:

```text
# HMS backend configuration — copy to .env and fill in real values.
# NEVER commit a real .env (it is gitignored).

# MongoDB Atlas (the only database — dev and deployment share it, ADR-0004).
# Copy the connection string from the Atlas UI (Connect > Drivers), e.g.:
#   MONGODB_URL=mongodb+srv://<user>:<password>@cluster0.bgop6.mongodb.net/?retryWrites=true
MONGODB_URL=

# Database name inside the Atlas cluster
MONGODB_DB=hms

# JWT — REQUIRED in deployment. Generate with: python -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY=dev-only-insecure-secret-change-me
ACCESS_TOKEN_EXPIRE_MINUTES=60

# Comma-separated origins allowed to call the API (CORS)
CORS_ORIGINS=http://localhost:5173,http://localhost:8080,http://10.0.2.20

# Password assigned to every seeded demo account (change before the demo)
SEED_PASSWORD=hms-demo-1234
```

- [ ] **Step 5: USER ACTION — put the real URL in backend/.env**

Tell the user: *"Now add your real Atlas connection string to `backend/.env` as `MONGODB_URL=mongodb+srv://Gaston202:<your actual password>@cluster0.bgop6.mongodb.net/?appName=Cluster0` (keep it in that file only — it is gitignored)."* **Do not proceed until they confirm** (the remaining steps cannot run without it). Do not print the password back and do not commit that file.

- [ ] **Step 6: Verify — ping Atlas and confirm loud failure**

```bash
cd backend
.venv/Scripts/python -c "import asyncio; from motor.motor_asyncio import AsyncIOMotorClient; import app.core.config as c; print(asyncio.run(AsyncIOMotorClient(c.settings.mongodb_url).admin.command('ping')))"
```

Expected: `{'ok': 1.0, ...}`. Cross-check the fail-loud path (then restore `.env`):

```bash
.venv/Scripts/python -c "MONGODB_URL=''; import app.core.config"
```

Expected: Pydantic `ValidationError` for `mongodb_url` (missing value with no default → fails loud, per spec §5).

- [ ] **Step 7: Verify — old stack still boots**

Start uvicorn in the background, then `curl -s http://localhost:8000/api/health` → expect `{"status":"ok","service":"hms-api","version":"0.1.0"}`. Stop uvicorn.

- [ ] **Step 8: Commit**

```bash
git add backend/requirements.txt backend/app/core/config.py backend/.env.example
git commit -m "feat: add MongoDB Atlas config and Motor dependency

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Mongo foundation — client, counters, indexes, domain enums

**Files:**
- Create: `backend/app/domain.py`
- Create: `backend/app/db/mongo.py`
- Create: `backend/app/db/indexes.py`

**Interfaces:**
- Produces (every later task consumes these exact names):
  - `app.db.mongo.client` (`AsyncIOMotorClient`), `app.db.mongo.db` (`AsyncIOMotorDatabase`), `async def app.db.mongo.get_db()` (FastAPI dependency yielding `db`)
  - `async def app.db.mongo.reserve_ids(collection: str, count: int) -> list[int]`, `async def app.db.mongo.next_id(collection: str) -> int`
  - `def app.db.mongo.strip_id(doc: dict) -> dict` (`_id` renamed to `id` first, other keys kept)
  - `def app.db.mongo.utcnow() -> datetime` (naive UTC), `def app.db.mongo.date_to_dt(value: date | None) -> datetime | None`
  - `app.db.indexes.ensure_indexes(db) -> None` (async)
  - `app.domain.UserRole`, `app.domain.AppointmentStatus` (incl. `NO_SHOW = "no_show"`), `app.domain.InvoiceStatus` — same string values as today's enums

- [ ] **Step 1: Write app/domain.py**

```python
"""Domain enums (unchanged values from the old SQLA models — API parity).

MongoDB stores plain strings; these classes exist for validation and to keep
`UserRole(role)`-style parsing in routes readable.
"""
from enum import Enum as StdEnum


class UserRole(str, StdEnum):
    ADMIN = "admin"
    DOCTOR = "doctor"
    PATIENT = "patient"


class AppointmentStatus(str, StdEnum):
    BOOKED = "booked"
    CONSULTED = "consulted"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class InvoiceStatus(str, StdEnum):
    UNPAID = "unpaid"
    PAID = "paid"
```

- [ ] **Step 2: Write app/db/mongo.py**

```python
"""MongoDB wiring (MongoDB Atlas via Motor — spec §3/§5).

A module-scoped pooled client outlives requests; `get_db` yields the same
database handle to every handler. Integer ids are minted from the `counters`
collection so API paths, schemas, and the frontend keep working unchanged.
"""
from collections.abc import AsyncGenerator
from datetime import date, datetime, time, timezone

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ReturnDocument

from app.core.config import settings

# Bounded server selection so an unreachable Atlas surfaces in ~10 s
# (/health -> 503) instead of hanging the request for the 30 s default.
client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=10_000)
db: AsyncIOMotorDatabase = client[settings.mongodb_db]


async def get_db() -> AsyncGenerator[AsyncIOMotorDatabase, None]:
    """Yield the module-scoped database handle to an async handler."""
    yield db


async def reserve_ids(collection: str, count: int) -> list[int]:
    """Reserve `count` ids for `collection` with one atomic $inc on counters.

    E.g. reserve 10 -> [41, 42, ..., 50]; callers assign them sequentially.
    """
    counter = await db["counters"].find_one_and_update(
        {"_id": collection},
        {"$inc": {"n": count}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    first = counter["n"] - count
    return list(range(first, first + count))


async def next_id(collection: str) -> int:
    return (await reserve_ids(collection, 1))[0]


def strip_id(doc: dict) -> dict:
    """Rename Mongo's `_id` to the API contract's `id`, keeping field order."""
    return {"id": doc["_id"], **{k: v for k, v in doc.items() if k != "_id"}}


def utcnow() -> datetime:
    """Application-generated naive-UTC clock (matches today's serialization)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def date_to_dt(value: date | None) -> datetime | None:
    """Store a user-supplied `date` as UTC midnight (pymongo can't encode date)."""
    if value is None:
        return None
    return datetime.combine(value, time.min)
```

- [ ] **Step 3: Write app/db/indexes.py**

```python
"""Index bootstrap (spec §3): idempotent create_index calls, run at startup.

Unique indexes carry the invariants PostgreSQL's constraints carried (§4):
email, department name, one profile per user, exact-duplicate slot windows,
one active appointment per slot (sparse — cancelled docs drop the field),
one invoice per appointment.
"""
from motor.motor_asyncio import AsyncIOMotorDatabase


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db["users"].create_index("email", unique=True)
    await db["departments"].create_index("name", unique=True)
    await db["doctor_profiles"].create_index("user_id", unique=True)
    await db["patient_profiles"].create_index("user_id", unique=True)
    await db["availability_slots"].create_index(
        [("doctor_id", 1), ("starts_at", 1)], unique=True)
    await db["appointments"].create_index("slot_id", unique=True, sparse=True)
    await db["appointments"].create_index("patient_id")
    await db["appointments"].create_index("doctor_id")
    await db["invoices"].create_index("appointment_id", unique=True)
```

- [ ] **Step 4: Verify — imports resolve against the live cluster**

```bash
cd backend
.venv/Scripts/python -c "import asyncio; from app.db.mongo import client, db, reserve_ids; from app.db.indexes import ensure_indexes; from app.domain import UserRole, AppointmentStatus, InvoiceStatus; ids = asyncio.run(reserve_ids('selftest', 2)); print('reserved', ids)"
```

Expected: `reserved [1, 2]` (a `counters` doc `_id: selftest` lands in Atlas). Clean it up:

```bash
.venv/Scripts/python -c "import asyncio; from app.db.mongo import db; print(asyncio.run(db['counters'].delete_one({'_id': 'selftest'})).deleted_count)"
```

Expected: `1`.

- [ ] **Step 5: Verify — old stack still boots** (uvicorn + `curl /api/health` → 200)

- [ ] **Step 6: Commit**

```bash
git add backend/app/domain.py backend/app/db/mongo.py backend/app/db/indexes.py
git commit -m "feat: add Mongo foundation (Motor client, counters, index bootstrap, enums)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Identity cluster goes async — deps, auth, health, admin, app wiring

**Files:**
- Modify: `backend/app/api/deps.py` (rewrite + transitional SQLA copies)
- Modify: `backend/app/api/routes/auth.py` (rewrite)
- Modify: `backend/app/api/routes/health.py` (rewrite)
- Modify: `backend/app/api/routes/admin.py` (rewrite)
- Modify: `backend/app/api/routes/scheduling.py`, `clinical.py`, `billing.py` (one import-alias line each)
- Modify: `backend/app/main.py` (lifespan)

**Interfaces:**
- Consumes: Task 2 (`app.db.mongo.get_db/next_id/strip_id/utcnow/date_to_dt`, `app.db.indexes.ensure_indexes`, `app.domain.*`).
- Produces: `app.api.deps.get_current_user` → async, returns the **user document as a dict** (`_id`, `full_name`, `email`, `password_hash`, `role`, `is_active`, `created_at`); `require_role(*allowed)` same factory over it, passing a dict. Transitional for the still-SQLA route modules: `get_current_user_sqla` / `require_role_sqla` (same behavior as today's `get_current_user`/`require_role`). `/api/health` pings Atlas (503 "Database unreachable" when down). `/api/users`, `PATCH /api/users/{id}`, `/api/patients`, all of `/api/auth/*` now hit Atlas.

- [ ] **Step 1: Rewrite app/api/deps.py**

```python
"""Shared FastAPI dependencies: DB handle, current user, role guards (ADR-0006/0007)."""
from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import decode_access_token
from app.db.mongo import get_db
from app.domain import UserRole
from app.schemas import UserOut

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = await db["users"].find_one({"_id": int(payload["sub"])})
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    if not user["is_active"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is deactivated")
    return user


def require_role(*allowed: UserRole) -> Callable:
    """Dependency factory: endpoint runs only for users with one of `allowed` roles.

    Usage: admin = Depends(require_role(UserRole.ADMIN))  # admin is a dict
    """
    allowed_set = {r.value for r in allowed}

    def guard(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in allowed_set:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Requires one of: {', '.join(sorted(allowed_set))}",
            )
        return user

    return guard


# --- Transitional SQLAlchemy copies (removed when the SQLA stack is deleted) --
# Only the not-yet-converted route modules (scheduling, clinical, billing) use
# these until Tasks 5–7 land.

def get_current_user_sqla(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: Session = Depends(get_db_sqla),
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = session.get(User, int(payload["sub"]))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    if not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is deactivated")
    return user


def require_role_sqla(*allowed: UserRole) -> Callable:
    allowed_set = {r.value for r in allowed}

    def guard(user: User = Depends(get_current_user_sqla)) -> User:
        if user.role not in allowed_set:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Requires one of: {', '.join(sorted(allowed_set))}",
            )
        return user

    return guard
```

With these imports added at the top of the same file (used only by the transitional block; both blocks are deleted together in Task 8):

```python
from sqlalchemy.orm import Session

from app.db.base import get_db as get_db_sqla
from app.models import User
```

The full final Task-3 `deps.py` = the Mongo section above + the transitional section + both import groups; the `UserOut` import shown in the first block is not needed — omit it.

- [ ] **Step 2: Rewrite app/api/routes/auth.py**

```python
"""Registration, login, and current-user endpoints (ADR-0006)."""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.api.deps import get_current_user, require_role
from app.core.security import create_access_token, hash_password, verify_password
from app.db.mongo import date_to_dt, get_db, next_id, strip_id, utcnow
from app.domain import UserRole
from app.schemas import LoginIn, RegisterIn, StaffCreateIn, TokenOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterIn,
                   db: AsyncIOMotorDatabase = Depends(get_db)) -> TokenOut:
    """Public self-registration. Always creates a Patient account (ADR-0007)."""
    if await db["users"].find_one({"email": payload.email}):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    password_hash = await run_in_threadpool(hash_password, payload.password)
    user = {
        "_id": await next_id("users"),
        "full_name": payload.full_name,
        "email": payload.email,
        "password_hash": password_hash,
        "role": UserRole.PATIENT.value,
        "is_active": True,
        "created_at": utcnow(),
    }
    try:
        await db["users"].insert_one(user)
    except DuplicateKeyError:
        # Lost the email race - the pre-check above yields the same 409 first.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Email already registered") from None
    await db["patient_profiles"].insert_one({
        "_id": await next_id("patient_profiles"),
        "user_id": user["_id"],
        "date_of_birth": date_to_dt(payload.date_of_birth),
        "phone": payload.phone,
        "address": payload.address,
    })
    return _token_for(user)


@router.post("/login", response_model=TokenOut)
async def login(payload: LoginIn,
                db: AsyncIOMotorDatabase = Depends(get_db)) -> TokenOut:
    user = await db["users"].find_one({"email": payload.email})
    valid = user is not None and await run_in_threadpool(
        verify_password, payload.password, user["password_hash"])
    if not valid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return _token_for(user)


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)) -> dict:
    return strip_id(user)


@router.post(
    "/staff",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)
async def create_staff(payload: StaffCreateIn,
                       db: AsyncIOMotorDatabase = Depends(get_db)) -> dict:
    """Admin creates staff accounts. Role must not be 'patient' (use /register)."""
    if payload.role == UserRole.PATIENT.value:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Use /auth/register for patients"
        )
    try:
        role = UserRole(payload.role)
    except ValueError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown role"
        ) from None
    if await db["users"].find_one({"email": payload.email}):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    password_hash = await run_in_threadpool(hash_password, payload.password)
    user = {
        "_id": await next_id("users"),
        "full_name": payload.full_name,
        "email": payload.email,
        "password_hash": password_hash,
        "role": role.value,
        "is_active": True,
        "created_at": utcnow(),
    }
    try:
        await db["users"].insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Email already registered") from None
    if role == UserRole.DOCTOR:
        await db["doctor_profiles"].insert_one({
            "_id": await next_id("doctor_profiles"),
            "user_id": user["_id"],
            "department_id": payload.department_id,
            "specialty": payload.specialty,
        })
    return strip_id(user)


def _token_for(user: dict) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(user["_id"], user["role"]),
        role=user["role"],
        full_name=user["full_name"],
    )
```

Note the two documented non-transactional write windows (user → profile; spec §11 accepted limitation). `next_id` runs before each insert; on a `DuplicateKeyError` the reserved id is burned (a gap like an aborted transaction — harmless).

- [ ] **Step 3: Rewrite app/api/routes/health.py**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import PyMongoError

from app.db.mongo import get_db
from app.schemas import HealthOut

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthOut)
async def health(db: AsyncIOMotorDatabase = Depends(get_db)) -> HealthOut:
    """Week 1 exit criterion: 200 from http://10.0.2.10:8000/api/health across the VMs."""
    try:
        await db.client.admin.command("ping")
    except PyMongoError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Database unreachable") from None
    return HealthOut(status="ok", service="hms-api", version="0.1.0")
```

- [ ] **Step 4: Rewrite app/api/routes/admin.py**

```python
"""Admin management: users and patients directory (ADR-0007).

Staff account creation is `POST /auth/staff` (auth module); this module adds
listing, updating, and deactivating accounts, plus the patients list used for
walk-in booking. Directory joins are two-query id-maps (spec §5.1) — rename-safe.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import require_role
from app.db.mongo import get_db, strip_id
from app.domain import UserRole
from app.schemas import PatientOut, UserOut, UserUpdateIn

router = APIRouter()


@router.get("/users", response_model=list[UserOut], tags=["admin"])
async def list_users(role: str | None = Query(default=None),
                     active: bool | None = Query(default=None),
                     db: AsyncIOMotorDatabase = Depends(get_db),
                     _admin: dict = Depends(require_role(UserRole.ADMIN))):
    query: dict = {}
    if role is not None:
        try:
            UserRole(role)
        except ValueError:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown role") from None
        query["role"] = role
    if active is not None:
        query["is_active"] = active
    return [
        strip_id(doc) async for doc in db["users"].find(query).sort("created_at", 1)
    ]


@router.patch("/users/{user_id}", response_model=UserOut, tags=["admin"])
async def update_user(user_id: int, payload: UserUpdateIn,
                      db: AsyncIOMotorDatabase = Depends(get_db),
                      _admin: dict = Depends(require_role(UserRole.ADMIN))):
    """Rename a user, move a doctor between departments, update a specialty, or
    (de)activate the account. `department_id`/`specialty` apply to doctors only
    and are rejected otherwise."""
    user = await db["users"].find_one({"_id": user_id})
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    profile_updates: dict = {}
    if payload.department_id is not None or payload.specialty is not None:
        if user["role"] != UserRole.DOCTOR.value:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "department_id/specialty apply to doctor accounts only")
        profile = await db["doctor_profiles"].find_one({"user_id": user_id})
        if profile is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Doctor account has no doctor profile")
        if payload.department_id is not None:
            profile_updates["department_id"] = payload.department_id
        if payload.specialty is not None:
            profile_updates["specialty"] = payload.specialty
    user_updates: dict = {}
    if payload.full_name is not None:
        user_updates["full_name"] = payload.full_name
    if payload.is_active is not None:
        user_updates["is_active"] = payload.is_active
    if profile_updates:
        await db["doctor_profiles"].update_one(
            {"user_id": user_id}, {"$set": profile_updates})
    if user_updates:
        await db["users"].update_one({"_id": user_id}, {"$set": user_updates})
    return strip_id(await db["users"].find_one({"_id": user_id}))


@router.get("/patients", response_model=list[PatientOut], tags=["admin"])
async def list_patients(db: AsyncIOMotorDatabase = Depends(get_db),
                        _admin: dict = Depends(require_role(UserRole.ADMIN))):
    """Patients directory: the walk-in booking target list (`patient_id` in
    `POST /appointments`). Sorted by full_name in memory — the join is two
    queries per spec §5.1, so renames flow through with no stale copies."""
    profiles = await db["patient_profiles"].find().to_list(length=None)
    user_ids = [profile["user_id"] for profile in profiles]
    by_id = {
        user["_id"]: user for user in
        (await db["users"].find({"_id": {"$in": user_ids}}).to_list(length=None))
    }
    patients = [
        PatientOut(
            id=profile["_id"],
            full_name=by_id[profile["user_id"]]["full_name"],
            email=by_id[profile["user_id"]]["email"],
            phone=profile.get("phone"),
            date_of_birth=profile.get("date_of_birth"),
        )
        for profile in profiles if profile["user_id"] in by_id
    ]
    patients.sort(key=lambda patient: patient.full_name)
    return patients
```

Behavior note (spec §5.1-class deliberate improvement): a specialty-only update on a doctor account without a profile previously crashed (AttributeError → 500); it now returns the same 422 "Doctor account has no doctor profile" as the department path. e2e does not exercise it. The two `update_one` calls here are not one transaction — the accepted crash-window class (spec §11).

- [ ] **Step 5: Pin the still-SQLA modules to the transitional deps**

One import-line edit in each of `scheduling.py`, `clinical.py`, `billing.py` (replace the existing `from app.api.deps import ...` line):

```python
from app.api.deps import get_current_user_sqla as get_current_user, \
    require_role_sqla as require_role
```

No other change in those files this task (bodies stay SQLA until Tasks 5–7).

- [ ] **Step 6: Add the lifespan to app/main.py**

Replace `backend/app/main.py` with:

```python
"""FastAPI application entrypoint (ADR-0002/0003)."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, auth, billing, clinical, health, scheduling
from app.core.config import settings
from app.db.indexes import ensure_indexes
from app.db import mongo


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await ensure_indexes(mongo.db)   # idempotent; carries the §4 invariants
    yield
    mongo.client.close()


app = FastAPI(
    title="Hospital Management System API",
    version="0.1.0",
    description="HMS backend for the networks course project. Roles and flows per docs/adr/.",
    lifespan=lifespan,
)

# The SPA lives on a different origin (nginx on hms-desktop) — ADR-0011.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,  # Bearer tokens, not cookies
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
for module in (admin, billing, clinical, scheduling):
    app.include_router(module.router, prefix="/api")
```

- [ ] **Step 7: Verify — auth flows against Atlas**

```bash
cd backend
.venv/Scripts/python -m uvicorn app.main:app --port 8000    # background shell
```

```bash
# health now pings Atlas:
curl -s http://localhost:8000/api/health
# expect {"status":"ok","service":"hms-api","version":"0.1.0"}

curl -s -X POST http://localhost:8000/api/auth/register -H "Content-Type: application/json" \
  -d '{"full_name":"Migration Check","email":"migration.check@example.com","password":"check-pass-1"}'
# expect 201 with access_token, role patient

curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"migration.check@example.com","password":"check-pass-1"}'
# expect 200

curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"migration.check@example.com","password":"wrong-pass-999"}'
# expect 401 {"detail":"Invalid email or password"}
```

Register again with the same email → expect 409 `{"detail":"Email already registered"}`. Stop uvicorn.

- [ ] **Step 8: Verify — Review Focus line 4 (rename flows through the id-map joins)**

Seed is still the SQLA `app/seed.py`, so the Atlas DB holds only the test user from Step 7 — rename it and confirm `/users` shows the change (full directory checks with real rows happen in Task 4's Step 3):

```bash
ADMIN=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@hms.example.com","password":"hms-demo-1234"}' | python -c "import json,sys; print(json.load(sys.stdin)['access_token'])" 2>/dev/null || echo EMPTY)
```

If `ADMIN` came back empty (no admin has been seeded into Atlas yet), seed with the SQLA seed first (`.venv/Scripts/python -c "import asyncio; from app.db.mongo import client; asyncio.run(client.drop_database('hms'))"` then `.venv/Scripts/python -m app.seed` — the old script still works against the SQLA database path but writes nothing to Atlas; instead log in with any admin known locally OR simply defer this step to Task 4 Step 3, where real directory rows exist). Then:

```bash
USER_ID=$(curl -s "http://localhost:8000/api/users?role=patient" -H "Authorization: Bearer $ADMIN" | python -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
curl -s -X PATCH http://localhost:8000/api/users/$USER_ID \
  -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"full_name":"Renamed Check"}'
# expect 200 with the new name; /users?role=patient shows "Renamed Check" with no other edit
```

- [ ] **Step 9: Commit**

```bash
git add backend/app/api/deps.py backend/app/api/routes/auth.py \
  backend/app/api/routes/health.py backend/app/api/routes/admin.py \
  backend/app/api/routes/scheduling.py backend/app/api/routes/clinical.py \
  backend/app/api/routes/billing.py backend/app/main.py
git commit -m "feat: async identity cluster on Motor (auth, health, admin, deps, lifespan)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Rewrite the seed for Atlas

**Files:**
- Modify: `backend/app/seed.py` (full rewrite)

**Interfaces:**
- Consumes: Task 2 (`app.db.mongo` client/db/reserve_ids/utcnow, `app.db.indexes.ensure_indexes`, `app.domain.UserRole`).
- Produces: `python -m app.seed` populates Atlas with the exact demo data (3 departments; 1 admin + 3 doctors + 2 patients, password `SEED_PASSWORD`; 210 slots = 7 days × (09:00–12:00 + 14:00–16:00) × 30 min × 3 doctors) and the same console prints. Idempotent: skips when `admin@hms.example.com` exists.

- [ ] **Step 1: Rewrite app/seed.py**

```python
"""Demo seed data — idempotent (safe to re-run; skips if the admin exists).

Run:  .venv/Scripts/python -m app.seed        (from the backend/ directory)
Accounts and password come from SEED_PASSWORD in .env (default: hms-demo-1234).

Three-role scope (ADR-0007): admin, doctor, patient. No nurse/pharmacist/meds.
Atlas is the only database (ADR-0004): indexes are ensured here and at app
startup; there is no schema/migration step.
"""
import asyncio
from datetime import datetime, timedelta

from app.core.config import settings
from app.core.security import hash_password
from app.db.indexes import ensure_indexes
from app.db.mongo import db, reserve_ids, utcnow
from app.domain import UserRole

DEPARTMENTS = ["Cardiology", "Pediatrics", "General Medicine"]

DOCTORS = [
    ("Dr. Amina Haddad", "amina.haddad@hms.example.com", "Cardiology", "Interventional cardiology"),
    ("Dr. Omar Benali", "omar.benali@hms.example.com", "Cardiology", "General cardiology"),
    ("Dr. Salma Trabelsi", "salma.trabelsi@hms.example.com", "Pediatrics", "Neonatal care"),
]

STAFF = [
    ("Ghassen Admin", "admin@hms.example.com", UserRole.ADMIN),
]

PATIENTS = [
    ("Sami Patient", "patient@hms.example.com"),
    ("Leila Mansour", "leila.mansour@hms.example.com"),
]


def _user_doc(_id: int, full_name: str, email: str, password_hash: str,
              role: str) -> dict:
    return {
        "_id": _id,
        "full_name": full_name,
        "email": email,
        "password_hash": password_hash,
        "role": role,
        "is_active": True,
        "created_at": utcnow(),
    }


async def seed() -> None:
    await ensure_indexes(db)
    if await db["users"].find_one({"email": "admin@hms.example.com"}):
        print("Seed data already present - nothing to do.")
        return

    password = hash_password(settings.seed_password)

    dept_ids = await reserve_ids("departments", len(DEPARTMENTS))
    departments = [
        {"_id": _id, "name": name}
        for _id, name in zip(dept_ids, DEPARTMENTS)
    ]
    await db["departments"].insert_many(departments)
    dept_id_by_name = {d["name"]: d["_id"] for d in departments}

    user_ids = await reserve_ids(
        "users", len(STAFF) + len(DOCTORS) + len(PATIENTS))
    ids = iter(user_ids)
    staff_users = [
        _user_doc(next(ids), full_name, email, password, role.value)
        for full_name, email, role in STAFF
    ]
    doctor_users = [
        (_user_doc(next(ids), full_name, email, password, UserRole.DOCTOR.value),
         dept_name, specialty)
        for full_name, email, dept_name, specialty in DOCTORS
    ]
    patient_users = [
        _user_doc(next(ids), full_name, email, password, UserRole.PATIENT.value)
        for full_name, email in PATIENTS
    ]
    await db["users"].insert_many(
        staff_users + [user for user, _, _ in doctor_users] + patient_users)

    profile_ids = await reserve_ids("doctor_profiles", len(doctor_users))
    doctor_profiles = [
        {
            "_id": profile_id,
            "user_id": user["_id"],
            "department_id": dept_id_by_name[dept_name],
            "specialty": specialty,
        }
        for profile_id, (user, dept_name, specialty) in zip(profile_ids, doctor_users)
    ]
    await db["doctor_profiles"].insert_many(doctor_profiles)

    patient_profile_ids = await reserve_ids("patient_profiles", len(patient_users))
    patient_profiles = [
        {
            "_id": profile_id,
            "user_id": patient["_id"],
            "date_of_birth": None,
            "phone": "+216-55-000-000",
            "address": None,
        }
        for profile_id, patient in zip(patient_profile_ids, patient_users)
    ]
    await db["patient_profiles"].insert_many(patient_profiles)

    # Slots: today + 6 days, 09:00-12:00 and 14:00-16:00, 30 minutes each.
    # Every doctor gets slots every day so any doctor is bookable for the demo.
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    windows: list[tuple[int, datetime, datetime]] = []
    doctor_ids = [profile["_id"] for profile in doctor_profiles]
    for day in range(7):
        base = today + timedelta(days=day)
        for window_start_hour, window_hours in ((9, 3), (14, 2)):
            for half in range(window_hours * 2):
                start = base + timedelta(hours=window_start_hour, minutes=30 * half)
                for doctor_id in doctor_ids:
                    windows.append((doctor_id, start, start + timedelta(minutes=30)))

    slot_ids = await reserve_ids("availability_slots", len(windows))
    slots = [
        {"_id": slot_id, "doctor_id": doctor_id, "starts_at": start, "ends_at": end}
        for slot_id, (doctor_id, start, end) in zip(slot_ids, windows)
    ]
    await db["availability_slots"].insert_many(slots)

    print(f"Seeded: {len(departments)} departments, "
          f"{len(staff_users) + len(doctor_users)} staff, "
          f"{len(patient_users)} patients, {len(slots)} slots "
          f"(consultation fee: {settings.consultation_fee})")
    print(f"Demo password for every seeded account: {settings.seed_password}")


if __name__ == "__main__":
    asyncio.run(seed())
```

- [ ] **Step 2: Verify — reset + seed + counts**

```bash
cd backend
.venv/Scripts/python -c "import asyncio; from app.db.mongo import client; asyncio.run(client.drop_database('hms'))"
.venv/Scripts/python -m app.seed
# expect the original print: "Seeded: 3 departments, 4 staff, 2 patients, 210 slots (consultation fee: 25.0)"
.venv/Scripts/python -m app.seed
# expect: "Seed data already present - nothing to do."

.venv/Scripts/python -c "import asyncio; from app.db.mongo import db; print('users', asyncio.run(db['users'].count_documents({}))); print('slots', asyncio.run(db['availability_slots'].count_documents({})))"
```

Expected: `users 6`, `slots 210`. (The Task-3 test user is gone — the drop in Step 2 reset the database.)

- [ ] **Step 3: Verify — Review Focus line 4 completed (directories show seeded data, renamed name included)**

Boot uvicorn, then with an admin token:

```bash
ADMIN=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@hms.example.com","password":"hms-demo-1234"}' | python -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

curl -s http://localhost:8000/api/doctors -H "Authorization: Bearer $ADMIN"
# expect 3 doctors, each with department_name "Cardiology"/"Pediatrics" and specialty

curl -s http://localhost:8000/api/patients -H "Authorization: Bearer $ADMIN" | python -m json.tool
# expect 2 patients sorted by full_name (Leila Mansour, Sami Patient), both with phone
```

Then rename Haddad's user record and confirm the directory reflects it with no
stale copy (the Review Focus rename check, now with real rows):

```bash
DOCTOR_USER_ID=$(curl -s "http://localhost:8000/api/users?role=doctor" -H "Authorization: Bearer $ADMIN" | python -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
curl -s -X PATCH http://localhost:8000/api/users/$DOCTOR_USER_ID \
  -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"full_name":"Dr. Renamed Visible"}' > /dev/null
curl -s http://localhost:8000/api/doctors -H "Authorization: Bearer $ADMIN" | python -c "import json,sys; print('renamed' if any(d['full_name'] == 'Dr. Renamed Visible' for d in json.load(sys.stdin)) else 'STALE COPY!')"
```

Expected: `renamed`. Also confirm the department move works the same way:

```bash
curl -s -X PATCH http://localhost:8000/api/users/$DOCTOR_USER_ID \
  -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"department_id": 2}' > /dev/null
curl -s http://localhost:8000/api/doctors -H "Authorization: Bearer $ADMIN" \
  | python -c "import json,sys; print(next(d['department_name'] for d in json.load(sys.stdin) if 'Renamed' in d['full_name']))"
```

Expected: `Pediatrics` (department 2 in the `DEPARTMENTS` constant in Step 1).

**Revert both** via `PATCH` (`full_name` back to `"Dr. Amina Haddad"`, `department_id` back to `1`) so the seeded demo state stays canonical. (The e2e run matches on `"haddad"` in the email, which is unaffected either way.) Stop uvicorn.

- [ ] **Step 4: Commit**

```bash
git add backend/app/seed.py
git commit -m "feat: seed MongoDB Atlas demo data via Motor (counters + insert_many)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Scheduling goes async — departments, doctors, slots, appointments

**Files:**
- Modify: `backend/app/api/routes/scheduling.py` (full rewrite)

**Interfaces:**
- Consumes: Task 2/3 (`app.db.mongo.*`, `app.api.deps.get_current_user/require_role` returning dicts, `app.domain.*`).
- Produces: every `GET/POST/PATCH/DELETE /api/(departments|doctors|appointments)*` endpoint now async against Atlas with identical contracts. Key internal shapes: appointment documents `{"_id", "slot_id", "patient_id", "doctor_id", "status", "starts_at", "ends_at", "created_at"}` plus `original_slot_id` after cancel; helpers `_patient_profile_id(db, user)`, `_doctor_profile_id(db, user)`, `_slot_or_404`, `_appointment_or_404`, `_out(db, appointment, detail)`, `_consultation_out(appointment)`.
- Depends on: nothing from the SQLA stack anymore.

- [ ] **Step 1: Rewrite app/api/routes/scheduling.py — module + helpers**

```python
"""Departments, doctors, slots, and appointments (ADR-0007/0008/0009).

All ownership rules are per-row: patient appointments only through their own
profile id, doctor consultation writes only for their own appointments
(domain-model invariant 3/4). Slot exclusivity is enforced by the unique
*sparse* index on `appointments.slot_id`; cancelling `$unset`s the field, so a
cancelled appointment releases its slot (spec §4 row 2). Booking copies the
slot's times onto the appointment, so displays need no joins.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.api.deps import get_current_user, require_role
from app.core.config import settings
from app.db.mongo import get_db, next_id, reserve_ids, strip_id, utcnow
from app.domain import AppointmentStatus, InvoiceStatus, UserRole
from app.schemas import (
    AppointmentCreateIn,
    AppointmentDetailOut,
    AppointmentOut,
    DepartmentCreateIn,
    DepartmentOut,
    DepartmentRenameIn,
    DoctorOut,
    SlotBulkIn,
    SlotOut,
)

router = APIRouter()


# --- Helpers ---------------------------------------------------------------

async def _patient_profile_id(db: AsyncIOMotorDatabase, user: dict) -> int:
    """Profile id of the logged-in patient; patients without a profile can't act."""
    profile = await db["patient_profiles"].find_one({"user_id": user["_id"]})
    if profile is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Account has no patient profile")
    return profile["_id"]


async def _doctor_profile_id(db: AsyncIOMotorDatabase, user: dict) -> int:
    profile = await db["doctor_profiles"].find_one({"user_id": user["_id"]})
    if profile is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Account has no doctor profile")
    return profile["_id"]


async def _slot_or_404(db: AsyncIOMotorDatabase, slot_id: int) -> dict:
    slot = await db["availability_slots"].find_one({"_id": slot_id})
    if slot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Slot not found")
    return slot


async def _appointment_or_404(db: AsyncIOMotorDatabase, appointment_id: int) -> dict:
    appointment = await db["appointments"].find_one({"_id": appointment_id})
    if appointment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")
    return appointment


def _consultation_out(appointment: dict) -> dict | None:
    """Embedded consultation → ConsultationOut shape; id == appointment_id."""
    consultation = appointment.get("consultation")
    if consultation is None:
        return None
    return {
        "id": appointment["_id"],
        "appointment_id": appointment["_id"],
        "diagnosis": consultation["diagnosis"],
        "notes": consultation.get("notes"),
        "prescription": consultation.get("prescription"),
        "created_at": consultation["created_at"],
    }


async def _out(db: AsyncIOMotorDatabase, appointment: dict, detail: bool) -> dict:
    """Appointment dict; slot times were copied at booking, so no joins are needed.

    Cancelled appointments lost `slot_id` (it was $unset) but kept
    `original_slot_id` — the response keeps an int slot_id either way.
    """
    data = strip_id(appointment)
    data["slot_id"] = appointment.get("slot_id",
                                      appointment.get("original_slot_id"))
    if detail:
        data["consultation"] = _consultation_out(appointment)
        invoice = await db["invoices"].find_one({"appointment_id": appointment["_id"]})
        data["invoice"] = strip_id(invoice) if invoice else None
    return data
```

- [ ] **Step 2: Departments endpoints**

```python
# --- Departments (managed by Admin) ----------------------------------------

@router.get("/departments", response_model=list[DepartmentOut],
            tags=["scheduling"],
            summary="List departments (authenticated users)")
async def list_departments(db: AsyncIOMotorDatabase = Depends(get_db),
                           _user: dict = Depends(get_current_user)):
    return [
        DepartmentOut(**strip_id(doc))
        async for doc in db["departments"].find().sort("name", 1)
    ]


@router.post("/departments", response_model=DepartmentOut,
             status_code=status.HTTP_201_CREATED, tags=["scheduling"])
async def create_department(payload: DepartmentCreateIn,
                            db: AsyncIOMotorDatabase = Depends(get_db),
                            _admin: dict = Depends(require_role(UserRole.ADMIN))):
    if await db["departments"].find_one({"name": payload.name}):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Department name already exists")
    department = {"_id": await next_id("departments"), "name": payload.name}
    try:
        await db["departments"].insert_one(department)
    except DuplicateKeyError:  # lost the name race
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Department name already exists") from None
    return strip_id(department)


@router.patch("/departments/{department_id}", response_model=DepartmentOut,
              tags=["scheduling"])
async def rename_department(department_id: int, payload: DepartmentRenameIn,
                            db: AsyncIOMotorDatabase = Depends(get_db),
                            _admin: dict = Depends(require_role(UserRole.ADMIN))):
    department = await db["departments"].find_one({"_id": department_id})
    if department is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")
    if await db["departments"].find_one(
            {"name": payload.name, "_id": {"$ne": department_id}}):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Department name already exists")
    await db["departments"].update_one(
        {"_id": department_id}, {"$set": {"name": payload.name}})
    return strip_id(
        await db["departments"].find_one({"_id": department_id}))


@router.delete("/departments/{department_id}",
               status_code=status.HTTP_204_NO_CONTENT, tags=["scheduling"])
async def delete_department(department_id: int,
                            db: AsyncIOMotorDatabase = Depends(get_db),
                            _admin: dict = Depends(require_role(UserRole.ADMIN))):
    """Invariant 6: a department with doctors assigned can't be deleted."""
    department = await db["departments"].find_one({"_id": department_id})
    if department is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")
    if await db["doctor_profiles"].count_documents(
            {"department_id": department_id}, limit=1):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Department has doctors assigned - reassign them first")
    await db["departments"].delete_one({"_id": department_id})
```

- [ ] **Step 3: Doctors directory (id-map join) + slots**

```python
# --- Doctors (booking browse) ----------------------------------------------

@router.get("/doctors", response_model=list[DoctorOut], tags=["scheduling"])
async def list_doctors(department_id: int | None = None,
                       db: AsyncIOMotorDatabase = Depends(get_db),
                       _user: dict = Depends(get_current_user)):
    """Doctor directory for the booking flow (ADR-0007). Two-query id-maps per
    spec §5.1: profiles + users (+ departments for display), no name copies."""
    profile_query: dict = {}
    if department_id is not None:
        profile_query["department_id"] = department_id
    profiles = await db["doctor_profiles"].find(profile_query).to_list(length=None)
    user_ids = [profile["user_id"] for profile in profiles]
    dept_ids = list({
        profile["department_id"] for profile in profiles
        if profile.get("department_id") is not None})
    users_by_id = {
        user["_id"]: user for user in
        (await db["users"].find({"_id": {"$in": user_ids}}).to_list(length=None))}
    depts_by_id = {
        dept["_id"]: dept for dept in
        (await db["departments"].find({"_id": {"$in": dept_ids}}).to_list(length=None))}
    doctors = []
    for profile in profiles:
        user = users_by_id[profile["user_id"]]
        department = depts_by_id.get(profile.get("department_id"))
        doctors.append(DoctorOut(
            id=profile["_id"],
            full_name=user["full_name"],
            email=user["email"],
            department_id=profile.get("department_id"),
            department_name=department["name"] if department else None,
            specialty=profile.get("specialty"),
        ))
    return doctors


# --- Slots ------------------------------------------------------------------

@router.get("/doctors/{doctor_id}/slots", response_model=list[SlotOut],
            tags=["scheduling"])
async def list_doctor_slots(doctor_id: int,
                            free_only: bool = Query(default=False, alias="free"),
                            db: AsyncIOMotorDatabase = Depends(get_db),
                            _user: dict = Depends(get_current_user)):
    """Slots for one doctor. `?free=true` returns only bookable slots."""
    if await db["doctor_profiles"].find_one({"_id": doctor_id}) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Doctor not found")
    slots = await db["availability_slots"].find(
        {"doctor_id": doctor_id}).sort("starts_at", 1).to_list(length=None)
    # An appointment holds its slot_id until cancellation $unsets it — a slot
    # id present in any appointment doc means that slot is occupied.
    booked_slot_ids = {
        appointment["slot_id"] for appointment in
        (await db["appointments"].find(
            {"slot_id": {"$exists": True}}).to_list(length=None))}
    return [
        SlotOut(
            id=slot["_id"], doctor_id=slot["doctor_id"],
            starts_at=slot["starts_at"], ends_at=slot["ends_at"],
            is_free=slot["_id"] not in booked_slot_ids,
        )
        for slot in slots
        if not free_only or slot["_id"] not in booked_slot_ids
    ]


@router.post("/doctors/{doctor_id}/slots",
             response_model=list[SlotOut],
             status_code=status.HTTP_201_CREATED, tags=["scheduling"])
async def create_slots(doctor_id: int, payload: SlotBulkIn,
                       db: AsyncIOMotorDatabase = Depends(get_db),
                       user: dict = Depends(get_current_user)):
    """Bulk-create a daily window of slots. Admin may target any doctor; a doctor
    may only target their own availability (ADR-0009)."""
    if user["role"] == UserRole.DOCTOR.value:
        own = await _doctor_profile_id(db, user)
        if own != doctor_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Doctors may only create their own slots")
    elif user["role"] != UserRole.ADMIN.value:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Requires one of: admin, doctor")
    if await db["doctor_profiles"].find_one({"_id": doctor_id}) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Doctor not found")

    windows: list[tuple[datetime, datetime]] = []
    for day in range(payload.days):
        base = datetime.combine(payload.first_date, datetime.min.time()) \
            + timedelta(days=day, hours=payload.start_hour, minutes=payload.start_minute)
        step = timedelta(minutes=payload.slot_minutes)
        for offset in range(int(payload.hours_per_day * 60) // payload.slot_minutes):
            start = base + offset * step
            windows.append((start, start + step))
    if not windows:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Window yields no slots")

    # One query covers the whole requested span; the per-slot overlap loop is
    # replaced by checking the created windows against the fetched overlap set
    # in ascending order (same first-conflict message as the SQLA version).
    overlapping = await db["availability_slots"].find({
        "doctor_id": doctor_id,
        "starts_at": {"$lt": windows[-1][1]},
        "ends_at": {"$gt": windows[0][0]},
    }).to_list(length=None)
    for start, end in windows:
        if any(existing["starts_at"] < end and existing["ends_at"] > start
               for existing in overlapping):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Slot range {start:%Y-%m-%d %H:%M} overlaps existing slots - "
                "nothing created")

    slot_ids = await reserve_ids("availability_slots", len(windows))
    slots = [
        {"_id": slot_id, "doctor_id": doctor_id, "starts_at": start, "ends_at": end}
        for slot_id, (start, end) in zip(slot_ids, windows)
    ]
    try:
        await db["availability_slots"].insert_many(slots)
    except DuplicateKeyError:
        # Spec §4 row 6: the unique {doctor_id, starts_at} index is the new
        # race guard for an exact-duplicate window — same 409 as the pre-check.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Slot range {windows[0][0]:%Y-%m-%d %H:%M} overlaps existing slots - "
            "nothing created") from None
    return [SlotOut(**strip_id(slot), is_free=True) for slot in slots]
```

- [ ] **Step 4: Appointments endpoints**

```python
# --- Appointments -----------------------------------------------------------

@router.post("/appointments", response_model=AppointmentOut,
             status_code=status.HTTP_201_CREATED, tags=["appointments"])
async def book_appointment(payload: AppointmentCreateIn,
                           db: AsyncIOMotorDatabase = Depends(get_db),
                           user: dict = Depends(get_current_user)):
    """Patients self-book; Admin books walk-ins by patient id (ADR-0009).

    Past slots are bookable on purpose — it is how the historic completed
    visit for the demo gets produced.
    """
    if user["role"] == UserRole.PATIENT.value:
        patient_id = await _patient_profile_id(db, user)
    elif user["role"] == UserRole.ADMIN.value:
        if payload.patient_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "patient_id is required when booking as Admin (walk-in)")
        patient_id = payload.patient_id
        if await db["patient_profiles"].find_one({"_id": patient_id}) is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "Patient not found")
    else:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Requires one of: admin, patient")

    slot = await _slot_or_404(db, payload.slot_id)
    # The sparse unique index means a `slot_id` on ANY appointment doc equals
    # "occupied" — no status filter, matching spec §4 row 2.
    if await db["appointments"].find_one({"slot_id": payload.slot_id}):
        raise HTTPException(status.HTTP_409_CONFLICT, "Slot taken - pick another")

    appointment = {
        "_id": await next_id("appointments"),
        "slot_id": payload.slot_id,
        "patient_id": patient_id,
        "doctor_id": slot["doctor_id"],
        "status": AppointmentStatus.BOOKED.value,
        "starts_at": slot["starts_at"],   # copied: displays never join slots
        "ends_at": slot["ends_at"],
        "created_at": utcnow(),
    }
    try:
        await db["appointments"].insert_one(appointment)
    except DuplicateKeyError:
        # Invariant 2: a lost booking race returns "slot taken", never a duplicate.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Slot taken - pick another") from None
    return await _out(db, appointment, detail=False)


@router.get("/appointments", response_model=list[AppointmentOut],
            tags=["appointments"])
async def list_appointments(
        status_filter: str | None = Query(default=None, alias="status"),
        db: AsyncIOMotorDatabase = Depends(get_db),
        user: dict = Depends(get_current_user)):
    """Role-scoped list: patients see their own, doctors their own, Admin all.
    Sorted by the copied `starts_at` (newest first) — the SQLA join's sort."""
    query: dict = {}
    if user["role"] == UserRole.PATIENT.value:
        query["patient_id"] = await _patient_profile_id(db, user)
    elif user["role"] == UserRole.DOCTOR.value:
        query["doctor_id"] = await _doctor_profile_id(db, user)
    elif user["role"] != UserRole.ADMIN.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    if status_filter:
        query["status"] = status_filter
    rows = await db["appointments"].find(query).sort(
        "starts_at", -1).to_list(length=None)
    return [AppointmentOut(**await _out(db, doc, detail=False)) for doc in rows]


@router.get("/appointments/{appointment_id}", response_model=AppointmentDetailOut,
            tags=["appointments"])
async def get_appointment(appointment_id: int,
                          db: AsyncIOMotorDatabase = Depends(get_db),
                          user: dict = Depends(get_current_user)):
    """Full appointment view (slot times + consultation + invoice).

    Ownership is checked per row: a patient may read only their own.
    """
    appointment = await _appointment_or_404(db, appointment_id)
    if user["role"] == UserRole.PATIENT.value:
        if appointment["patient_id"] != await _patient_profile_id(db, user):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Patients may only view their own appointments")
    elif user["role"] == UserRole.DOCTOR.value:
        if appointment["doctor_id"] != await _doctor_profile_id(db, user):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Doctors may only view their own appointments")
    elif user["role"] != UserRole.ADMIN.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    return await _out(db, appointment, detail=True)


@router.patch("/appointments/{appointment_id}/cancel", response_model=AppointmentOut,
              tags=["appointments"])
async def cancel_appointment(appointment_id: int,
                             db: AsyncIOMotorDatabase = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    """Patients cancel their own future appointments; Admin cancels for anyone.

    Cancelling frees the slot for rebooking (sparse index + `$unset slot_id`)
    and is only possible while the visit has not been completed. The slot id is
    preserved as `original_slot_id` so responses keep an int `slot_id`.
    """
    appointment = await _appointment_or_404(db, appointment_id)
    if user["role"] == UserRole.PATIENT.value:
        if appointment["patient_id"] != await _patient_profile_id(db, user):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Patients may only cancel their own appointments")
        if appointment["status"] != AppointmentStatus.BOOKED.value:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Patients may only cancel while the appointment is booked")
    elif user["role"] == UserRole.ADMIN.value:
        if appointment["status"] in (AppointmentStatus.COMPLETED.value,
                                     AppointmentStatus.CANCELLED.value):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Appointment already {appointment['status']}")
    else:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")

    await db["appointments"].update_one(
        {"_id": appointment_id},
        {"$set": {"status": AppointmentStatus.CANCELLED.value,
                  "original_slot_id": appointment["slot_id"]},
         "$unset": {"slot_id": ""}})
    return await _out(
        db, await db["appointments"].find_one({"_id": appointment_id}),
        detail=False)


@router.patch("/appointments/{appointment_id}/complete",
              response_model=AppointmentDetailOut, tags=["appointments"])
async def complete_appointment(appointment_id: int,
                               db: AsyncIOMotorDatabase = Depends(get_db),
                               user: dict = Depends(get_current_user)):
    """Doctor-only transition `booked|consulted → completed`, which derives the
    invoice (ADR-0012, invariant 5) — invoice total is the configured fee and
    is created exactly once (unique `invoices.appointment_id` index; spec §4
    row 3 replaces the SQL transaction's atomicity with the guarded update +
    unique index)."""
    if user["role"] != UserRole.DOCTOR.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requires role: doctor")
    appointment = await _appointment_or_404(db, appointment_id)
    if appointment["doctor_id"] != await _doctor_profile_id(db, user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Not your appointment")
    if appointment["status"] not in (AppointmentStatus.BOOKED.value,
                                     AppointmentStatus.CONSULTED.value):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Appointment already {appointment['status']} - nothing to complete")

    result = await db["appointments"].update_one(
        {"_id": appointment_id,
         "status": {"$in": [AppointmentStatus.BOOKED.value,
                            AppointmentStatus.CONSULTED.value]}},
        {"$set": {"status": AppointmentStatus.COMPLETED.value}})
    if result.matched_count != 1:
        # Lost the guarded race: report the current status, like the re-read
        # after the SQLA rollback did.
        current = await db["appointments"].find_one({"_id": appointment_id})
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Appointment already {current['status']} - nothing to complete")
    invoice = {
        "_id": await next_id("invoices"),
        "appointment_id": appointment_id,
        "patient_id": appointment["patient_id"],  # internal; not in InvoiceOut
        "total": settings.consultation_fee,
        "status": InvoiceStatus.UNPAID.value,
        "created_at": utcnow(),
    }
    try:
        await db["invoices"].insert_one(invoice)
    except DuplicateKeyError:
        # Invoice already derived by a concurrent completion — keep one invoice.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Appointment already completed") from None
    return await _out(
        db, await db["appointments"].find_one({"_id": appointment_id}),
        detail=True)
```

- [ ] **Step 5: Verify — scheduling against the seeded Atlas DB**

Reset + seed first (see Environment note), start uvicorn, then run this script (Git Bash):

```bash
pick() { python -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
ADMIN=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@hms.example.com","password":"hms-demo-1234"}' | pick access_token)
DOCTOR=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"amina.haddad@hms.example.com","password":"hms-demo-1234"}' | pick access_token)
PATIENT=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"patient@hms.example.com","password":"hms-demo-1234"}' | pick access_token)
CARDIO_ID=$(curl -s "http://localhost:8000/api/doctors" -H "Authorization: Bearer $PATIENT" \
  | python -c "import json,sys; print(next(d for d in json.load(sys.stdin) if d['department_name']=='Cardiology')['id'])")
SLOT_ID=$(curl -s "http://localhost:8000/api/doctors/$CARDIO_ID/slots?free=true" -H "Authorization: Bearer $PATIENT" \
  | pick id)   # first free slot

# Book it — expect 201, status booked, starts_at/ends_at present, slot_id == $SLOT_ID:
APPT=$(curl -s -X POST http://localhost:8000/api/appointments -H "Authorization: Bearer $PATIENT" \
  -H "Content-Type: application/json" -d "{\"slot_id\": $SLOT_ID}")
echo "$APPT"

# Review Focus line 1 — same slot once more must 409:
curl -s -X POST http://localhost:8000/api/appointments -H "Authorization: Bearer $PATIENT" \
  -H "Content-Type: application/json" -d "{\"slot_id\": $SLOT_ID}" \
  | python -c "import json,sys; print(json.load(sys.stdin)['detail'])"
# expect: Slot taken - pick another

# The booked slot left the free list:
curl -s "http://localhost:8000/api/doctors/$CARDIO_ID/slots?free=true" -H "Authorization: Bearer $PATIENT" \
  | python -c "import json,sys; print(len([s for s in json.load(sys.stdin) if s['id'] == $SLOT_ID]))"
# expect: 0

# Cancel — expect 200, status cancelled, and slot_id STILL an int:
APPT_ID=$(echo "$APPT" | pick id)
curl -s -X PATCH http://localhost:8000/api/appointments/$APPT_ID/cancel -H "Authorization: Bearer $PATIENT" \
  | python -c "import json,sys; d=json.load(sys.stdin); print(d['status'], isinstance(d['slot_id'], int))"
# expect: cancelled True

# The slot is bookable again — expect 201:
REBOOK=$(curl -s -X POST http://localhost:8000/api/appointments -H "Authorization: Bearer $PATIENT" \
  -H "Content-Type: application/json" -d "{\"slot_id\": $SLOT_ID}")
REBOOK_ID=$(echo "$REBOOK" | pick id)

# Review Focus line 2 — consultation then completion derives ONE invoice:
curl -s -X POST http://localhost:8000/api/appointments/$REBOOK_ID/consultation \
  -H "Authorization: Bearer $DOCTOR" -H "Content-Type: application/json" \
  -d '{"diagnosis":"stable"}' -o /dev/null    # expect 201
curl -s -X PATCH http://localhost:8000/api/appointments/$REBOOK_ID/complete -H "Authorization: Bearer $DOCTOR" \
  | python -c "import json,sys; d=json.load(sys.stdin); print(d['status'], float(d['invoice']['total']), d['invoice']['status'])"
# expect: completed 25.0 unpaid

curl -s -X PATCH http://localhost:8000/api/appointments/$REBOOK_ID/complete -H "Authorization: Bearer $DOCTOR" \
  | python -c "import json,sys; print(json.load(sys.stdin)['detail'])"
# expect: Appointment already completed - nothing to complete

curl -s -X PATCH http://localhost:8000/api/appointments/$APPT_ID/complete -H "Authorization: Bearer $DOCTOR" \
  | python -c "import json,sys; print(json.load(sys.stdin)['detail'])"
# expect: Appointment already cancelled - nothing to complete  (not bookable|consulted)

.venv/Scripts/python -c "import asyncio; from app.db.mongo import db; print(asyncio.run(db['invoices'].count_documents({'appointment_id': $REBOOK_ID})))"
# expect: 1 (exactly one invoice for the completed visit)
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routes/scheduling.py
git commit -m "feat: async scheduling module on Motor (departments, doctors, slots, appointments)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Clinical goes async — embedded consultations

**Files:**
- Modify: `backend/app/api/routes/clinical.py` (full rewrite)

**Interfaces:**
- Consumes: `app.db.mongo.*`, deps, `app.domain.*` (as Task 5).
- Produces: `POST /appointments/{id}/consultation` = one atomic guarded update (status → consulted + embedded subdocument, spec §4 row 4); `GET /consultations` = role-scoped timeline reading embedded subdocuments sorted by `consultation.created_at` desc. Consultation documents live **inside** appointments (no `consultations` collection).

- [ ] **Step 1: Rewrite app/api/routes/clinical.py**

```python
"""Clinical records: consultations written by doctors (ADR-0010).

The consultation is an embedded subdocument on the appointment (spec §3) —
1:1, write-once, always displayed with it. The write is one atomic guarded
update, so "one consultation per appointment, while booked" needs no
separate collection or second write (spec §4 row 4).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user
from app.db.mongo import get_db, utcnow
from app.domain import AppointmentStatus, UserRole
from app.schemas import ConsultationCreateIn, ConsultationOut

router = APIRouter()


# `_consultation_out` and the profile-id helper mirror scheduling.py's — same
# shapes (embedding means clinical reads run on appointments, not a collection).

async def _doctor_profile_id(db: AsyncIOMotorDatabase, user: dict) -> int:
    profile = await db["doctor_profiles"].find_one({"user_id": user["_id"]})
    if profile is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Account has no doctor profile")
    return profile["_id"]


def _consultation_out(appointment: dict) -> dict:
    consultation = appointment["consultation"]
    return {
        "id": appointment["_id"],
        "appointment_id": appointment["_id"],
        "diagnosis": consultation["diagnosis"],
        "notes": consultation.get("notes"),
        "prescription": consultation.get("prescription"),
        "created_at": consultation["created_at"],
    }


@router.post("/appointments/{appointment_id}/consultation",
             response_model=ConsultationOut,
             status_code=status.HTTP_201_CREATED, tags=["clinical"])
async def write_consultation(appointment_id: int, payload: ConsultationCreateIn,
                             db: AsyncIOMotorDatabase = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    """Doctor writes the consultation (diagnosis + notes + optional Rx text) for
    their own appointment; the appointment moves `booked → consulted`. One
    consultation per appointment (the guarded update's `$exists: false` check)."""
    if user["role"] != UserRole.DOCTOR.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requires role: doctor")
    appointment = await db["appointments"].find_one({"_id": appointment_id})
    if appointment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")
    if appointment["doctor_id"] != await _doctor_profile_id(db, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your appointment")
    if appointment["status"] != AppointmentStatus.BOOKED.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Appointment is {appointment['status']} - consultations are written "
            "while booked")

    consultation = {
        "diagnosis": payload.diagnosis,
        "notes": payload.notes,
        "prescription": payload.prescription,
        "created_at": utcnow(),
    }
    result = await db["appointments"].update_one(
        {"_id": appointment_id,
         "status": AppointmentStatus.BOOKED.value,
         "consultation": {"$exists": False}},
        {"$set": {"status": AppointmentStatus.CONSULTED.value,
                  "consultation": consultation}})
    if result.matched_count != 1:
        # Lost the guarded race — produce exactly the conflicts the unique
        # constraint produced in PostgreSQL (spec §4 row 4).
        current = await db["appointments"].find_one({"_id": appointment_id})
        if current["status"] != AppointmentStatus.CONSULTED.value:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Appointment is {current['status']} - consultations are written "
                "while booked")
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Appointment already has a consultation")
    return ConsultationOut(id=appointment_id, appointment_id=appointment_id,
                           **consultation)


@router.get("/consultations", response_model=list[ConsultationOut],
            tags=["clinical"])
async def list_consultations(db: AsyncIOMotorDatabase = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    """Role-scoped timeline, newest first: a patient reads only their own
    consultations (the patient-record view, ADR-0010)."""
    if user["role"] == UserRole.PATIENT.value:
        profile = await db["patient_profiles"].find_one({"user_id": user["_id"]})
        if profile is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Account has no patient profile")
        query: dict = {"patient_id": profile["_id"],
                       "consultation": {"$exists": True}}
    elif user["role"] == UserRole.DOCTOR.value:
        profile = await db["doctor_profiles"].find_one({"user_id": user["_id"]})
        if profile is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Account has no doctor profile")
        query = {"doctor_id": profile["_id"], "consultation": {"$exists": True}}
    elif user["role"] == UserRole.ADMIN.value:
        query = {"consultation": {"$exists": True}}
    else:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    rows = await db["appointments"].find(query).sort(
        "consultation.created_at", -1).to_list(length=None)
    return [_consultation_out(row) for row in rows]
```

Note (`ConsultationOut(id=..., **consultation)`): `consultation` carries `diagnosis`, `notes`, `prescription`, `created_at` — exactly the remaining `ConsultationOut` fields, no clash with `id`/`appointment_id`.

- [ ] **Step 2: Verify — Review Focus line 3**

Reset + seed, boot uvicorn, then run this script (Git Bash) — the token/`pick` preamble repeats Task 5 Step 5's so it runs standalone:

```bash
pick() { python -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
ADMIN=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@hms.example.com","password":"hms-demo-1234"}' | pick access_token)
DOCTOR=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"amina.haddad@hms.example.com","password":"hms-demo-1234"}' | pick access_token)
PATIENT=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"patient@hms.example.com","password":"hms-demo-1234"}' | pick access_token)
CARDIO_ID=$(curl -s "http://localhost:8000/api/doctors" -H "Authorization: Bearer $PATIENT" \
  | python -c "import json,sys; print(next(d for d in json.load(sys.stdin) if d['department_name']=='Cardiology')['id'])")
SLOT_ID=$(curl -s "http://localhost:8000/api/doctors/$CARDIO_ID/slots?free=true" -H "Authorization: Bearer $PATIENT" \
  | pick id)   # first free slot

# Book (expect 201) and write the consultation:
APPT_ID=$(curl -s -X POST http://localhost:8000/api/appointments -H "Authorization: Bearer $PATIENT" \
  -H "Content-Type: application/json" -d "{\"slot_id\": $SLOT_ID}" | pick id)
curl -s -X POST http://localhost:8000/api/appointments/$APPT_ID/consultation \
  -H "Authorization: Bearer $DOCTOR" -H "Content-Type: application/json" \
  -d '{"diagnosis":"Stable angina","notes":"ECG ok","prescription":"Aspirin"}' \
  | python -c "import json,sys; d=json.load(sys.stdin); print(d['id'] == d['appointment_id'], d['diagnosis'])"
# expect: True Stable angina   (id == appointment_id — the embedded shape)

# Duplicate — expect 409 (pre-check fires: status is consulted; e2e asserts the code):
curl -s -X POST http://localhost:8000/api/appointments/$APPT_ID/consultation \
  -H "Authorization: Bearer $DOCTOR" -H "Content-Type: application/json" \
  -d '{"diagnosis":"duplicate"}' -o /dev/null -w "%{http_code}\n"
# expect: 409

# Detail view carries the embedded consultation:
curl -s http://localhost:8000/api/appointments/$APPT_ID -H "Authorization: Bearer $DOCTOR" \
  | python -c "import json,sys; d=json.load(sys.stdin); print(d['consultation'] is not None, d['status'])"
# expect: True consulted

# Timeline is role-scoped (doctor sees own, patient sees only theirs, admin sees all):
curl -s "http://localhost:8000/api/consultations" -H "Authorization: Bearer $DOCTOR" \
  | python -c "import json,sys; print(len(json.load(sys.stdin)))"     # expect: 1  (fresh DB — just this one)
curl -s "http://localhost:8000/api/consultations" -H "Authorization: Bearer $PATIENT" \
  | python -c "import json,sys; print(len(json.load(sys.stdin)))"     # expect: 1
curl -s "http://localhost:8000/api/consultations" -H "Authorization: Bearer $ADMIN" \
  | python -c "import json,sys; print(len(json.load(sys.stdin)))"     # expect: 1
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/routes/clinical.py
git commit -m "feat: async clinical module (consultation embedded on appointments)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Billing goes async — last SQLA module

**Files:**
- Modify: `backend/app/api/routes/billing.py` (full rewrite)

**Interfaces:**
- Consumes: `app.db.mongo.*`, deps, `app.domain.*` (as Task 5).
- Produces: `GET /invoices` (admin: all; patient: own via the denormalized internal `patient_id` — no join, spec §3; doctor: 403) and `PATCH /invoices/{id}/paid` (404 / 409 "Invoice already paid"). After this task no route module uses `get_current_user_sqla`/`require_role_sqla`.

- [ ] **Step 1: Rewrite app/api/routes/billing.py**

```python
"""Billing: invoices derived from completed visits (ADR-0012).

Invoices are never hand-authored: completion of an appointment derives the
invoice (see the appointments module); this module only reads and marks paid.
The `patient_id` filter uses the denormalized field completion wrote — no join.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, require_role
from app.db.mongo import get_db, strip_id
from app.domain import InvoiceStatus, UserRole
from app.schemas import InvoiceOut

router = APIRouter()


async def _patient_profile_id(db: AsyncIOMotorDatabase, user: dict) -> int:
    profile = await db["patient_profiles"].find_one({"user_id": user["_id"]})
    if profile is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Account has no patient profile")
    return profile["_id"]


@router.get("/invoices", response_model=list[InvoiceOut], tags=["billing"])
async def list_invoices(status_filter: str | None = None,
                        db: AsyncIOMotorDatabase = Depends(get_db),
                        user: dict = Depends(get_current_user)):
    """Admin sees all invoices; a patient only their own (per-row ownership)."""
    query: dict = {}
    if user["role"] == UserRole.PATIENT.value:
        query["patient_id"] = await _patient_profile_id(db, user)
    elif user["role"] != UserRole.ADMIN.value:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Requires one of: admin, patient")
    if status_filter:
        query["status"] = status_filter
    return [
        strip_id(doc) async for doc in db["invoices"].find(query).sort("created_at", -1)
    ]


@router.patch("/invoices/{invoice_id}/paid", response_model=InvoiceOut,
              tags=["billing"])
async def mark_paid(invoice_id: int,
                    db: AsyncIOMotorDatabase = Depends(get_db),
                    _admin: dict = Depends(require_role(UserRole.ADMIN))):
    """Admin marks an unpaid invoice paid; `unpaid → paid` in one direction,
    no partial payments (ADR-0012)."""
    invoice = await db["invoices"].find_one({"_id": invoice_id})
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")
    if invoice["status"] == InvoiceStatus.PAID.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Invoice already paid")
    await db["invoices"].update_one(
        {"_id": invoice_id}, {"$set": {"status": InvoiceStatus.PAID.value}})
    return strip_id(await db["invoices"].find_one({"_id": invoice_id}))
```

- [ ] **Step 2: Verify — billing**

Reset + seed, boot uvicorn, then run this script (Git Bash) — it books and completes an appointment so an invoice exists, then exercises billing:

```bash
pick() { python -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
ADMIN=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@hms.example.com","password":"hms-demo-1234"}' | pick access_token)
DOCTOR=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"amina.haddad@hms.example.com","password":"hms-demo-1234"}' | pick access_token)
PATIENT=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"patient@hms.example.com","password":"hms-demo-1234"}' | pick access_token)
CARDIO_ID=$(curl -s "http://localhost:8000/api/doctors" -H "Authorization: Bearer $PATIENT" \
  | python -c "import json,sys; print(next(d for d in json.load(sys.stdin) if d['department_name']=='Cardiology')['id'])")
SLOT_ID=$(curl -s "http://localhost:8000/api/doctors/$CARDIO_ID/slots?free=true" -H "Authorization: Bearer $PATIENT" \
  | pick id)   # first free slot

# Reach an invoice — book (patient), then complete (doctor); completion is valid straight from `booked`:
APPT_ID=$(curl -s -X POST http://localhost:8000/api/appointments -H "Authorization: Bearer $PATIENT" \
  -H "Content-Type: application/json" -d "{\"slot_id\": $SLOT_ID}" | pick id)
curl -s -X PATCH http://localhost:8000/api/appointments/$APPT_ID/complete \
  -H "Authorization: Bearer $DOCTOR" -o /dev/null    # expect 200

INV_ID=$(curl -s "http://localhost:8000/api/invoices" -H "Authorization: Bearer $ADMIN" \
  | python -c "import json,sys; print(next(i for i in json.load(sys.stdin) if i['appointment_id'] == $REBOOK_ID)['id'])")

curl -s "http://localhost:8000/api/invoices" -H "Authorization: Bearer $ADMIN" \
  | python -c "import json,sys; invs=json.load(sys.stdin); print(len(invs) >= 1, all('patient_id' not in i for i in invs))"
# expect: True True   (patient_id is internal — never in the response)

curl -s -X PATCH http://localhost:8000/api/invoices/$INV_ID/paid -H "Authorization: Bearer $ADMIN" \
  | python -c "import json,sys; print(json.load(sys.stdin)['status'])"
# expect: paid

curl -s -X PATCH http://localhost:8000/api/invoices/$INV_ID/paid -H "Authorization: Bearer $ADMIN" \
  | python -c "import json,sys; print(json.load(sys.stdin)['detail'])"
# expect: Invoice already paid

curl -s "http://localhost:8000/api/invoices" -H "Authorization: Bearer $DOCTOR" \
  | python -c "import json,sys; print(json.load(sys.stdin)['detail'])"
# expect: Requires one of: admin, patient

# the patient sees only their own invoice (Samis, not the walk-in/Laila one):
curl -s "http://localhost:8000/api/invoices" -H "Authorization: Bearer $PATIENT" \
  | python -c "import json,sys; print([i['id'] for i in json.load(sys.stdin)] == [$INV_ID])"
# expect: True
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/routes/billing.py
git commit -m "feat: async billing module (denormalized patient filter, no joins)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Flip the switch — remove PostgreSQL/SQLAlchemy/Alembic, run the e2e

**Files:**
- Modify: `backend/requirements.txt` (final content below)
- Modify: `backend/app/api/deps.py` (drop the transitional SQLA block)
- Modify: `backend/tests/e2e_smoke.py` (docstring only)
- Modify: `backend/README.md` (rewrite)
- Delete: `backend/docker-compose.yml`, `backend/alembic.ini`, `backend/app/models/` (whole dir), `backend/app/db/base.py`

**Interfaces:**
- Consumes: everything Tasks 2–7 produced (the Mongo-only stack).
- Produces: the backend runs with **no SQLAlchemy/Alembic/psycopg/motorless path anywhere**; `app.db.mongo.get_db` is the only DB dependency. Acceptance: the 31-step e2e passes against Atlas.

- [ ] **Step 1: Confirm nothing still imports the SQLA stack**

```bash
cd backend && grep -rn "app.models\|app.db.base\|sqlalchemy\|alembic\|psycopg" app/ tests/ --include="*.py"
```

Expected hits: only `deps.py` (its transitional block + `get_db` import in... verify it is just deps.py) and the e2e docstring. If any route file still imports them, that file was missed in Tasks 5–7 — fix it before continuing.

- [ ] **Step 2: Delete the SQLA machinery**

```bash
cd backend
docker compose down -v          # stops + removes the postgres container + volume
git rm docker-compose.yml alembic.ini app/db/base.py
git rm -r app/models
```

(`backend/alembic/` was verified absent — alembic was never initialized here; only `alembic.ini` exists.)

- [ ] **Step 3: Trim deps.py — remove the transitional block**

Delete from `app/api/deps.py`: the comment block "Transitional SQLAlchemy copies…", both `get_current_user_sqla` and `require_role_sqla`, and the imports `from sqlalchemy.orm import Session`, `from app.db.base import get_db as get_db_sqla`, `from app.models import User`. The file keeps only: `Callable`, fastapi imports, `AsyncIOMotorDatabase`, `decode_access_token`, `get_db` (from `app.db.mongo`), `UserRole`, `bearer_scheme`, async `get_current_user`, `require_role`.

- [ ] **Step 4: Final requirements.txt**

```text
fastapi>=0.115
uvicorn[standard]>=0.30
motor>=3.6
dnspython>=2.6
pydantic>=2.7
pydantic-settings>=2.2
email-validator>=2.1
bcrypt>=4.1
PyJWT>=2.8
```

```bash
cd backend
.venv/Scripts/pip uninstall -y sqlalchemy alembic psycopg2-binary
```

- [ ] **Step 5: Remove the transitional `database_url` from config.py**

Edit `backend/app/core/config.py`: delete the comment + `database_url` field (the "Transitional" paragraph added in Task 1). `mongodb_url`/`mongodb_db` and the other settings stay.

- [ ] **Step 6: e2e docstring edit (the ONLY e2e change)**

`backend/tests/e2e_smoke.py` line 3: `Run against http://localhost:8000 (uvicorn, Dockerized PostgreSQL dev DB).` →

```python
Run against http://localhost:8000 (uvicorn, MongoDB Atlas dev/prod DB).
```

- [ ] **Step 7: Rewrite backend/README.md**

```markdown
# HMS Backend

FastAPI (async) + Motor + MongoDB Atlas (ADR-0003/0004).

## Local development

The database is the Atlas cluster configured by `MONGODB_URL` in `.env` —
nothing to install or run locally; dev and deployment share it.

```bash
cd backend
copy .env.example .env          # then paste the Atlas string into MONGODB_URL
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # Windows

.venv/Scripts/python -m app.seed                # demo data (idempotent)
.venv/Scripts/python -m uvicorn app.main:app --reload   # http://localhost:8000/docs
```

Indexes are ensured at app startup (`app/db/indexes.py`) — no migrations.

## Reset / re-seed

```bash
.venv/Scripts/python -c "import asyncio; from app.db.mongo import client; asyncio.run(client.drop_database('hms'))"
.venv/Scripts/python -m app.seed
```

## End-to-end smoke test (the demo story over HTTP)

After a reset + seed, with uvicorn running on `:8000`:

```bash
.venv/Scripts/python tests/e2e_smoke.py
```

It drives the four-act demo story (book → consult → complete → paid) and the
guard paths (role guards, per-row ownership, slot uniqueness, invoice
idempotency, deactivation) — 31 assertions, `ALL 31 E2E STEPS PASSED` on
success.

## Structure

```
app/
├── main.py            # app entrypoint: CORS + routers + index-ensuring lifespan
├── core/              # config (env) + security (bcrypt, JWT)
├── db/mongo.py        # Motor client, db handle, counters, helpers
├── db/indexes.py      # unique-index bootstrap (the former DB constraints)
├── domain.py          # role/status enums (values unchanged)
├── api/
│   ├── deps.py        # get_current_user, require_role (ADR-0006/0007)
│   └── routes/        # health, auth, admin, scheduling, clinical, billing
├── schemas.py         # Pydantic request/response models (unchanged)
└── seed.py            # demo data (python -m app.seed)
```

## Security notes (report material)

- Passwords: bcrypt, never stored plain.
- JWT HS256; `SECRET_KEY` must be replaced in deployment (provision script does).
- Atlas credentials live only in `.env` / the VM env; the connection is TLS
  (`mongodb+srv`), gated by the Atlas network allow-list (ADR-0004).
- Plain HTTP between browser and API is a documented course-scoped limitation
  (ADR-0002).
```

- [ ] **Step 8: Acceptance — run the e2e**

```bash
cd backend
.venv/Scripts/python -c "import asyncio; from app.db.mongo import client; asyncio.run(client.drop_database('hms'))"
.venv/Scripts/python -m app.seed
.venv/Scripts/python -m uvicorn app.main:app --port 8000     # background
.venv/Scripts/python tests/e2e_smoke.py
```

Expected: `ALL 31 E2E STEPS PASSED`. Then the cleanliness grep (spec §10):

```bash
grep -rni "postgres\|sqlalchemy\|alembic\|psycopg" backend/app backend/tests backend/requirements.txt backend/README.md backend/docker-compose.yml 2>/dev/null || echo CLEAN
```

Expected: `CLEAN` (docker-compose.yml is gone; this grep is belt-and-braces). Stop uvicorn. Also confirm the frontend still works against Atlas: boot uvicorn + `cd frontend && npm run dev` — log in as the demo accounts and click through the four acts (spec §10 item 3).

- [ ] **Step 9: Commit**

```bash
git add -A backend
git commit -m "feat!: switch the backend stack to MongoDB Atlas end-to-end

Removes SQLAlchemy, Alembic, psycopg2, the Dockerized dev Postgres, and the
SQL models; all six route modules are async Motor against the counters
strategy. The 31-step e2e smoke passes unchanged.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Deploy pipeline — the VM provisions without PostgreSQL

**Files:**
- Modify: `deploy/server-provision.sh` (rewrite)
- Modify: `deploy/hms-api.service` (edit)
- Modify: `deploy/README.md` (rewrite)

**Interfaces:**
- Consumes: Task 8's final backend (pip install -r pulls Motor; `python -m app.seed` writes Atlas).
- Produces: an Atlas-only provisioning story; `MONGODB_URL` is required at provision time.

- [ ] **Step 1: Rewrite deploy/server-provision.sh**

```bash
#!/usr/bin/env bash
# Provision the FastAPI backend on the Ubuntu Server VM (hms-server).
# The database is MongoDB Atlas (ADR-0004) — nothing database-related is
# installed here; the VM just needs outbound access to Atlas (TCP 27017).
# Run ON the VM:  sudo MONGODB_URL='mongodb+srv://...' bash deploy/server-provision.sh
# Assumes Ubuntu Server 24.04 LTS and that this repo is present (git clone or scp).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_DIR/backend"

MONGODB_URL="${MONGODB_URL:?Set MONGODB_URL first, e.g. MONGODB_URL='mongodb+srv://...' sudo bash $0}"

echo "==> Installing system packages (no database packages on this VM)"
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip

echo "==> Writing backend .env"
if [ ! -f "$BACKEND_DIR/.env" ]; then
  SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  cat > "$BACKEND_DIR/.env" <<ENV
MONGODB_URL=$MONGODB_URL
MONGODB_DB=hms
SECRET_KEY=$SECRET_KEY
ACCESS_TOKEN_EXPIRE_MINUTES=60
CORS_ORIGINS=http://10.0.2.20,http://localhost:5173
SEED_PASSWORD=hms-demo-1234
ENV
  chmod 600 "$BACKEND_DIR/.env"
else
  echo "    .env already exists — leaving it alone"
fi

echo "==> Creating venv and installing dependencies"
python3 -m venv "$BACKEND_DIR/.venv"
"$BACKEND_DIR/.venv/bin/pip" install --quiet -r "$BACKEND_DIR/requirements.txt"

echo "==> Seeding demo data into Atlas"
cd "$BACKEND_DIR"
.venv/bin/python -m app.seed

echo "==> Installing systemd service"
cp "$REPO_DIR/deploy/hms-api.service" /etc/systemd/system/hms-api.service
# The unit references this repo's paths; fix them for this machine:
sed -i "s|__REPO__|$REPO_DIR|g" /etc/systemd/system/hms-api.service
systemctl daemon-reload
systemctl enable --now hms-api

echo "==> Allowing the API port through the firewall (NAT network only)"
if command -v ufw >/dev/null; then ufw allow 8000/tcp || true; fi

echo "==> Verifying"
sleep 2
systemctl --no-pager status hms-api | head -5 || true
curl -fsS http://localhost:8000/api/health && echo && echo "BACKEND PROVISIONED OK"
```

Note: `hms-api.service` no longer needs the postgresql unit; `After=network.target` alone suffices, and Atlas must be **allow-listed before** this script runs (Step 2).

- [ ] **Step 2: Edit deploy/hms-api.service**

Replace lines 3–4 (`After=network.target postgresql.service` / `Wants=postgresql.service`) with:

```text
After=network-online.target
Wants=network-online.target
```

(The API now needs internet egress to Atlas at boot — a healthy network target is the only ordering dependency left.)

- [ ] **Step 3: Rewrite deploy/README.md section 2 (+ the commands table)**

Replace the "2. Provision the backend" section with:

````markdown
## 2. Provision the backend (on hms-server)

**Before provisioning, allow-list the VM's public IP in Atlas** (Atlas UI →
Network Access → Add IP Address), or for a demo-only shortcut `0.0.0.0/0`
(allow all — convenient, but documented as the known, scoped limitation
analogous to ADR-0002's plain-HTTP note; restrict it after the demo).

Get the repo onto the VM (`git clone` your private repo — paste a token when
asked, or `scp -r` the folder from the host), then:

```bash
MONGODB_URL='mongodb+srv://<user>:<password>@cluster0.bgop6.mongodb.net/?appName=Cluster0' \
  sudo -E bash deploy/server-provision.sh
```

The script installs Python only (no database packages — the database is Atlas,
ADR-0004), writes `backend/.env` with a fresh `SECRET_KEY`, seeds demo data into
Atlas, installs the `hms-api.service` systemd unit, and verifies with
`curl http://localhost:8000/api/health` (which pings Atlas).

The API requires **outbound internet to Atlas on TCP/27017** (TLS + SRV
discovery via the `mongodb+srv` string). Demo-day dependency: the VM must have
internet egress; if the health check fails, check Atlas's Network Access list
first, then the VM's egress.
````

And replace the "Re-seed demo data" row of the commands table with:

| Re-seed demo data | drop the `hms` database (mongosh: `use hms; db.dropDatabase()`) then `python -m app.seed` — no pg_dump; `mongodump/mongorestore` optional |

Also update the `MONGODB_URL` reference in the table row if the old `HMS_DB_PASSWORD` appears anywhere in this file.

- [ ] **Step 4: Verify — syntax + no-database-packages**

```bash
bash -n deploy/server-provision.sh && echo SYNTAX-OK
grep -ri "postgres\|psycopg\|alembic" deploy/ || echo DEPLOY-CLEAN
```

Expected: `SYNTAX-OK` and `DEPLOY-CLEAN` (`deploy/desktop-setup.sh` never referenced the DB — unchanged).

- [ ] **Step 5: Commit**

```bash
git add deploy/server-provision.sh deploy/hms-api.service deploy/README.md
git commit -m "feat: provision the server VM against MongoDB Atlas (no DB packages)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: Docs & ADRs — edited in place (project convention)

**Files:**
- Modify: `docs/adr/ADR-0004-database-postgresql.md` (rewrite; content below)
- Modify: `docs/adr/ADR-0002-deployment-topology-two-vms.md` (one cell)
- Modify: `docs/adr/ADR-0003-backend-stack-fastapi.md` (two consequence bullets)
- Modify: `docs/adr/ADR-0005-virtualbox-network-mode.md` (one table cell + one bullet)
- Modify: `docs/network-topology.md` (diagram node, components row, flow 3, talking point)
- Modify: `docs/domain-model.md` (invariants wording + Consultation storage note)
- Modify: `docs/roadmap.md` (two line groups)
- Verify-only: `docs/glossary.md` (no DB-vendor references — read and confirm)

**Interfaces:** none — documentation only, from the approved spec (§8, §9, §11).

- [ ] **Step 1: Rewrite ADR-0004 in place (file name keeps `database-postgresql`; git history shows the original — the title and content describe the current decision)**

```markdown
# ADR-0004: Database — MongoDB Atlas

- **Status:** Accepted (reverses the 2026-09-25 PostgreSQL decision — edited in place)
- **Date:** 2026-09-25 (original); reversed 2026-10-02
- **Deciders:** Project owner, Claude

## Context

Hospital data (patients, appointments, prescriptions, staff) is strongly relational
in its original framing: candidates were PostgreSQL, MongoDB, MySQL/MariaDB.
PostgreSQL was chosen 2026-09-25 (co-located on the VM, SQLAlchemy + Alembic,
transactional invariants). On 2026-10-02 the owner reversed the decision on two
grounds: **simpler VM operations** (the database becomes a connection string — no
install, service, or snapshot tooling on `hms-server`) and **learning MongoDB** in
a real codebase, within the three-week demo window.

## Decision

**MongoDB Atlas** (cluster `cluster0.bgop6.mongodb.net`, `mongodb+srv://`), the
single database for development and deployment — no local fallback. FastAPI
accesses it via **Motor** (async driver) with all endpoints `async def`. Integer
ids are minted from a `counters` collection so API paths, Pydantic schemas, the
frontend, and the e2e suite are unchanged. No multi-document transactions
(Atlas M0): invariants ride single-document atomicity + unique indexes:

| Invariant (from domain-model §) | Enforcement now |
|---|---|
| Slot exclusivity (1/2) | `appointments.slot_id` unique **sparse** index; cancel = one atomic update setting `status=cancelled` and `$unset`ting `slot_id` (the slot keeps `original_slot_id` for responses) |
| One consultation per appointment, while booked (4) | one atomic guarded update (`status: "booked"`, `consultation: { $exists: false }`) embedding the subdocument |
| Invoice derived exactly once (5) | unique `invoices.appointment_id` index after the guarded completion update; duplicate → `409 "Appointment already completed"` |
| Email / department-name / one-profile-per-user uniqueness | plain unique indexes; `DuplicateKeyError` → the same 409s |
| Overlapping slot pre-check (§4 row 6) | same pre-check, plus the unique `{doctor_id, starts_at}` index as a new exact-duplicate race guard |

## Consequences

- No server-side schema or migrations: `app/db/indexes.py` ensures the indexes
  idempotently at startup.
- The database leaves the VM: deployment needs outbound TCP/27017 with TLS + SRV
  discovery, and the VM's public IP must be in the Atlas network allow-list
  (`0.0.0.0/0` is the documented demo-day fallback).
- `pg_dump/pg_restore` snapshots become "drop `hms` + re-seed"; `mongodump`
  remains optional.
- Accepted denormalizations (documented, spec §3): slot times copied onto
  appointments at booking (join-free displays), `invoices.patient_id` copied at
  completion (dissolves the billing join — not exposed in the response), and the
  consultation embedded in the appointment. No copies of user names/emails —
  directory joins are two-query id-maps, so renames flow through.
- Two writes in register/staff (user, then profile) are not one transaction in
  Atlas M0: a crash between them leaves a profile-less user, blocked only by the
  email unique index. Accepted demo-scope limitation, same class as ADR-0002's
  plain-HTTP note.
- `e2e_smoke.py` (31 assertions) is the acceptance harness; it passed unchanged
  immediately after the migration.

## Related

- [ADR-0003](ADR-0003-backend-stack-fastapi.md)
```

- [ ] **Step 2: Surgical ADR edits**

`ADR-0002-deployment-topology-two-vms.md`:
- Table row: `| `hms-server` | Ubuntu Server (LTS) | Backend + database | FastAPI REST API over HTTP + PostgreSQL |` → `| `hms-server` | Ubuntu Server (LTS) | Backend | FastAPI REST API over HTTP; MongoDB Atlas supplies the database (ADR-0004) |`

`ADR-0003-backend-stack-fastapi.md`, Consequences:
- `- Domain models use SQLModel or SQLAlchemy + Pydantic schemas.` → `- Data access is **Motor** (async MongoDB driver, ADR-0004); Pydantic enforces request/response shapes at the boundary; endpoints are `async def`.`
- `- Migrations via Alembic.` → `- No schema migrations: `app/db/indexes.py` ensures MongoDB's unique indexes at startup (idempotent).`

`ADR-0005-virtualbox-network-mode.md`:
- Table row cell: `| `hms-server` | `10.0.2.10` | FastAPI API on port `8000`, PostgreSQL (not exposed) |` → `| `hms-server` | `10.0.2.10` | FastAPI API on port `8000` |`
- Consequence bullet: `- PostgreSQL stays bound to localhost on `hms-server`; only the API port is exposed to the NAT network.` → `- Only the API port is exposed to the NAT network; the database left the VM entirely — `hms-server` makes **outbound TLS connections to MongoDB Atlas (TCP/27017)**, gated by the Atlas IP allow-list (ADR-0004).`

- [ ] **Step 3: Rewrite docs/network-topology.md — the new DB edge**

- Header line 5 references stay. Replace the `SRV == "localhost only :5432" --> PG[...]` mermaid line with:

```
        SRV == "TLS TCP/27017 egress (mongodb+srv)" --> ATLAS[("MongoDB Atlas<br/>cluster0.bgop6.mongodb.net")]
```

(placed inside the diagram after the NATNET subgraph — the Atlas node sits outside the subgraph). Replace the components-table rows for `hms-server`:

| `hms-server` | Ubuntu Server LTS | `10.0.2.10` | FastAPI (uvicorn via systemd) | `8000` (API); outbound `27017` → Atlas |
| MongoDB Atlas | managed cluster | public endpoints | MongoDB | `27017` (TLS, IP allow-listed) |

- Flow 3 becomes: `3. **`hms-server` → MongoDB Atlas** — outbound TLS on TCP/27017 with SRV discovery (`mongodb+srv`); Atlas is gated by the network access list (the VM's public IP, or `0.0.0.0/0` as the demo fallback).
- Talking points: add "`ping mongodb+srv cluster` — the API's `/api/health` now proves the cross-internet DB leg live during the demo."
- Known limitations: add "- The API requires internet egress to Atlas on demo day (checklist in deploy README)."

- [ ] **Step 4: Surgical edits in docs/domain-model.md**

Entities table:
- `| `Consultation` | id, appointment_id, diagnosis, notes, prescription | Written by the appointment's doctor; prescription is free text. |` → `| `Consultation` | (embedded in Appointment) diagnosis, notes, prescription | Written by the appointment's doctor; prescription is free text. Stored as an Appointment subdocument; API `id` == `appointment_id`. |`
- After the entities table add: `Storage: MongoDB Atlas (ADR-0004) in 8 collections; `slot_id` is unique-and-sparse and appointments copy their slot times, so displays never join.`

Invariants:
- 1. `**(unique constraint)**` → `**(unique sparse index; a cancelled appointment `$unset`s its slot_id, releasing it)**`
- 2. `booking happens in a transaction; a lost race returns "slot taken," never a duplicate.` → `booking inserts against the slot's unique index; a lost race returns "slot taken," never a duplicate.`
- 5. append: `The unique `invoices.appointment_id` index makes derivation idempotent.`
- 6. `a slot with an appointment can't be deleted` — keep (pre-check; no slot delete endpoint).

- [ ] **Step 5: Surgical edits in docs/roadmap.md**

- Week 1 bullet 2: `[x] Database schema + Alembic migration (all entities from ...) — squashed in place 2026-10-01 for the three-role scope` → `[x] MongoDB Atlas collections + unique-index bootstrap (all entities from [domain-model](domain-model.md)) — PostgreSQL reversed via ADR-0004 2026-10-02`
- Week 1 scaffold bullet: drop `+ SQLAlchemy` → `fastapi + uvicorn + pydantic + Motor`.
- Week 2 bullet: `booking (unique-constraint + transaction)` → `booking (unique slot index)`.
- Week 1 "Ubuntu Server (Python + PG)" → `Ubuntu Server (Python only — Atlas is the DB)`.

- [ ] **Step 6: Root README.md — three line edits**

- Line 3–4 overview: `a FastAPI + PostgreSQL backend on Ubuntu Server` → `a FastAPI backend on Ubuntu Server backed by MongoDB Atlas`
- Pitch (`JWT auth, PostgreSQL,`): `Three roles — admin, doctor, patient — JWT auth, PostgreSQL, all demonstrated across two Ubuntu VMs over plain HTTP.` → `Three roles — admin, doctor, patient — JWT auth, MongoDB Atlas, all demonstrated across two Ubuntu VMs over plain HTTP.`
- Layout block: `backend/    FastAPI + uvicorn + SQLAlchemy + Alembic` → `backend/    FastAPI + uvicorn + Motor (MongoDB Atlas)`

- [ ] **Step 7: Repo-wide cleanliness grep (spec §10 item 4)**

```bash
grep -rni "postgres\|sqlalchemy\|alembic\|psycopg" --include="*.md" --include="*.py" --include="*.sh" --include="*.txt" . 2>/dev/null | grep -v "docs/adr/ADR-0004\|node_modules\|.venv\|superpowers/plans\|superpowers/specs" || echo ALL-CLEAN
```

Expected: `ALL-CLEAN`. Any hit in `docs/` (e.g. `demo-walkthrough.md` or the ADR-0003 title link text) gets the same surgical treatment — vendor-word references removed or reworded to "MongoDB Atlas"; the only tolerated residue is inside `docs/superpowers/` artifacts and ADR narratives that quote the history. If `docs/demo-walkthrough.md` mentions PostgreSQL or Alembic, rewrite those lines with the reset/seed runbook.

- [ ] **Step 8: Commit**

```bash
git add README.md docs/roadmap.md docs/network-topology.md docs/domain-model.md \
  docs/adr/ADR-0002-deployment-topology-two-vms.md docs/adr/ADR-0003-backend-stack-fastapi.md \
  docs/adr/ADR-0004-database-postgresql.md docs/adr/ADR-0005-virtualbox-network-mode.md
git add -u
git commit -m "docs: ADR-0004 reversed in place to MongoDB Atlas (+ topology, roadmap, model)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

- [ ] **Task 10 success check:** re-read ADR-0004, `network-topology.md`, and the ADR edits as a reviewer — the story must be: two VMs unchanged; the DB leg is now VM → Atlas over TLS; invariants table matches spec §4; no stale "unique constraint"/"transaction" language outside the ADR histories.

---

## Plan self-review checklist (run at execution start)

- [ ] Spec coverage: §3 model (Tasks 2/5/6/7), §4 invariants (Tasks 5/6 + Review Focus), §5 wiring (Tasks 3–7), §5.1 no-copies joins (Tasks 3/5), §6 seed/e2e (Tasks 4/8), §7 file inventory (Tasks 8), §8 deploy (Task 9), §9 ADRs (Task 10), §10 criteria (Task 8 e2e + Task 10 grep), §11 risks (documented in ADR-0004 and Task notes).
- [ ] Placeholder scan: no TBD/TODO/"as above" code — every code step is complete.
- [ ] Type consistency: `strip_id`/`next_id`/`reserve_ids`/`utcnow`/`date_to_dt` names match across Tasks 2–7; `_consultation_out` shapes match between scheduling (nullable) and clinical (non-nullable).
- [ ] Review Focus: five lines each pinned to Task 2/3/5/6 verify steps.