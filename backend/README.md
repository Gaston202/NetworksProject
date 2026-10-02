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

Atlas M0 users may not `dropDatabase`; the reset helper drops the
collections instead (ADR-0004 note):

```bash
.venv/Scripts/python scripts/reset_demo.py      # drops every collection
.venv/Scripts/python -m app.seed                # re-creates demo data
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