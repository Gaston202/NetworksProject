# HMS Backend

FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL (ADR-0003/0004).

## Local development (Windows host, SQLite)

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # Windows
# .venv/bin/pip ...                             # Linux
copy .env.example .env                          # then edit if needed

.venv/bin/python -m app.seed                    # demo data (SQLite dev db)
.venv/bin/uvicorn app.main:app --reload         # http://localhost:8000/docs
```

## Migrations (Alembic)

```bash
.venv/bin/alembic revision --autogenerate -m "<what changed>"
.venv/bin/alembic upgrade head
```

The URL comes from `DATABASE_URL` in `.env` — SQLite locally, PostgreSQL on the VM.
Generate the initial revision once PostgreSQL is reachable (the provision script
does this automatically).

## Structure

```
app/
├── main.py            # app entrypoint: CORS + routers
├── core/              # config (env) + security (bcrypt, JWT)
├── db/base.py         # engine, session, Base, get_db
├── models/            # 13 tables (user, scheduling, clinical, pharmacy, billing)
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