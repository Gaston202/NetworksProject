# HMS Backend

FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL (ADR-0003/0004).

## Local development (Dockerized PostgreSQL)

The dev database runs in Docker (`docker-compose.yml`): `postgres:16-alpine`
on host port **5433** with a named volume, so data survives
`docker compose down`. Port 5433 rather than the usual 5432 only because a
Windows postgres service already occupies 5432 on this host; the Ubuntu
Server VM in deployment uses 5432 normally.

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # Windows
docker compose up -d                            # start the database (health-checked)
copy .env.example .env                          # defaults to localhost:5433

.venv/Scripts/alembic upgrade head              # create the 8-table schema
.venv/Scripts/python -m app.seed                # demo data
.venv/Scripts/uvicorn app.main:app --reload     # http://localhost:8000/docs
```

Docker-less fallback: set `DATABASE_URL=sqlite:///./hms-dev.db` in `.env`
(`.venv/bin` in place of `.venv/Scripts` on Linux) — the migration and seed
run identically, since schema definitions are portable.

## End-to-end smoke test (the demo story over HTTP)

With the database migrated + seeded and uvicorn running on `:8000`:

```bash
.venv/Scripts/python tests/e2e_smoke.py
```

It drives the four-act demo story (book → consult → complete → paid) and the
guard paths (role guards, per-row ownership, slot uniqueness, invoice
idempotency, deactivation) — 31 assertions, `ALL 31 E2E STEPS PASSED` on
success.

## Migrations (Alembic)

```bash
.venv/bin/alembic revision --autogenerate -m "<what changed>"
.venv/bin/alembic upgrade head
```

The URL comes from `DATABASE_URL` in `.env` — PostgreSQL in Docker on the host,
PostgreSQL on the VM in deployment, or SQLite for a quick Docker-less run.
Keep schema definitions valid on both PostgreSQL and SQLite.

## Structure

```
app/
├── main.py            # app entrypoint: CORS + routers
├── core/              # config (env) + security (bcrypt, JWT)
├── db/base.py         # engine, session, Base, get_db
├── models/            # 8 tables (user, scheduling, clinical, billing)
├── api/
│   ├── deps.py        # get_current_user, require_role (ADR-0006/0007)
│   └── routes/        # health, auth (more modules come in weeks 2–3)
├── schemas.py         # Pydantic request/response models
└── seed.py            # demo data (python -m app.seed)
```

## Security notes (report material)

- Passwords: bcrypt, never stored plain.
- JWT HS256; `SECRET_KEY` must be replaced in deployment (provision script does).
- Plain HTTP is a documented course-scoped limitation (ADR-0002).