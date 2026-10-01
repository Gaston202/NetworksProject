# HMS Build Roadmap (3–4 weeks)

Demo-ready target: ~4 weeks from 2026-09-25 (≈ 2026-10-23). Build order front-loads
the graded visit-lifecycle so any cut lands on the right-hand side.

**Scope cut 2026-10-01:** nurse and pharmacist roles removed — no vitals, no
pharmacy/stock/dispensing (ADR-0007, ADR-0008, ADR-0013, all updated in place).
Build order below is server-first: the full three-role API lands before any
frontend work resumes.

## Week 1 — Foundations (backend core + VMs)

- [x] Scaffold monorepo: `backend/` (FastAPI + uvicorn + pydantic + SQLAlchemy),
      `frontend/` (Vite + React + TS + Tailwind), `deploy/`
- [x] Database schema + Alembic migration (all entities from
      [domain-model](domain-model.md)) — squashed in place 2026-10-01 for the
      three-role scope
- [x] Auth: register/login, JWT issue, role-guard dependency (verified: 401/403/201)
- [x] Seed script: demo admin/doctors/patients, departments, slots
- [ ] Provision both VMs: NAT network, static IPs, Ubuntu Server (Python + PG),
      Ubuntu Desktop (nginx) — scripts ready in `deploy/`, see `deploy/README.md`
- [ ] `GET /api/health` returning 200 from `10.0.2.10:8000` **across the VMs**
      (passes locally: `curl http://localhost:8000/api/health`)

**Exit criterion:** API live on the server VM, database migrated, demo accounts
seeded.

## Week 2 — Server: appointments + clinical APIs

- [ ] Appointments API: slot creation (bulk windows), booking (unique-constraint +
      transaction), cancel, status transitions (`booked → consulted → completed`)
- [ ] Clinical API: consultation write (doctor) + reads (doctor/patient/admin) with
      per-row ownership checks
- [ ] Admin API: departments CRUD, user management, patients list for walk-ins

**Exit criterion:** book → consult → complete runs end-to-end via Swagger against
the API, with cross-VM curl beats rehearsed.

## Week 3 — Server: billing + demo data + deployment

- [ ] Billing API: auto-invoice on completion (consultation fee, idempotent),
      patient/admin reads, admin mark-paid
- [ ] Demo data richness in the seed (several patients, a week of slots, one
      historic completed visit per [demo accounts](demo-walkthrough.md))
- [ ] Full walkthrough ([demo script](demo-walkthrough.md)) passes via Swagger
- [ ] systemd unit for API; nginx config + SPA fallback; deploy scripts for both VMs

**Exit criterion:** the complete visit lifecycle runs end-to-end on the deployed
topology.

## Week 4 — Frontend + demo polish + graded deliverables

- [ ] Frontend shell: login, role-based nav (admin/doctor/patient), API client with JWT
- [ ] Patient booking UI (department → doctor → slot); patient appointments + records list
- [ ] Doctor consultation screen; Admin billing + management screens ([demo Acts
      1–4](demo-walkthrough.md))
- [ ] Rehearse the [demo walkthrough](demo-walkthrough.md) on the VMs; fix the rough edges
- [ ] Finalize [network-topology](network-topology.md) with the real IPs/ports
- [ ] Report material: architecture section, security considerations (HTTP caveat),
      concurrency notes (slot race, atomic auto-invoice)
- [ ] Buffer: any slippage from weeks 1–3 lands here

## Cut order (if time runs out)

1. Act 4 management screens (keep one demo department created manually)
2. Patient's own record-view screen (show via Swagger instead)
3. Doctor consultation screen (drive Act 2 from Swagger)

Never cut: the visit lifecycle (Acts 1–4) and the cross-VM HTTP story.