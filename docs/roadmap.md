# HMS Build Roadmap (3–4 weeks)

Demo-ready target: ~4 weeks from 2026-09-25. Build order front-loads the graded
visit-lifecycle so any cut lands on the right-hand side.

## Week 1 — Foundations (backend core + VMs)

- [ ] Scaffold monorepo: `backend/` (FastAPI + uvicorn + pydantic + SQLAlchemy),
      `frontend/` (Vite + React + TS + Tailwind), `deploy/`
- [ ] PostgreSQL schema + Alembic migration (all entities from
      [domain-model](domain-model.md))
- [ ] Auth: register/login, JWT issue, role-guard dependency
- [ ] Seed script: 5 demo users, departments, doctors, slots, medications
- [ ] Provision both VMs: NAT network, static IPs, Ubuntu Server (Python + PG),
      Ubuntu Desktop (nginx)
- [ ] `GET /api/health` returning 200 from `10.0.2.10:8000` **across the VMs**

**Exit criterion:** API live on the server VM, database migrated, demo accounts
seeded.

## Week 2 — Modules 1 & 2 (appointments, EMR-lite)

- [ ] Appointments API: slots CRUD, booking (unique-constraint + transaction),
      cancel, status transitions
- [ ] EMR API: vitals write (nurse), consultation + prescription write (doctor)
- [ ] Frontend shell: login, role-based nav, API client with JWT
- [ ] Patient booking UI (department → doctor → slot); patient appointments list
- [ ] Nurse vitals screen; doctor consultation screen

**Exit criterion:** book → vitals → consult works end-to-end on the VMs.

## Week 3 — Modules 3 & 4 (pharmacy, billing) + deployment

- [ ] Pharmacy API: dispense (atomic stock decrement), restock, low-stock list
- [ ] Billing API: auto-invoice on completion, line items, mark-paid
- [ ] Pharmacist UI (queue + stock); Admin billing UI; Admin management screens
- [ ] systemd unit for API; nginx config + SPA fallback; deploy scripts for both VMs
- [ ] Full walkthrough ([demo script](demo-walkthrough.md)) passes on the VMs

**Exit criterion:** the complete visit lifecycle runs on the deployed topology.

## Week 4 — Demo polish + graded deliverables

- [ ] Demo data richness (several patients, a week of slots, stock levels near
      thresholds)
- [ ] Rehearse the [demo walkthrough](demo-walkthrough.md); fix the rough edges
- [ ] Finalize [network-topology](network-topology.md) with the real IPs/ports
- [ ] Report material: architecture section, security considerations (HTTP caveat),
      concurrency notes (slot race, atomic dispense)
- [ ] Buffer: any slippage from weeks 1–3 lands here

## Cut order (if time runs out)

1. Act 6 management screens (keep one demo department created manually)
2. Patient's own record-view screen (show via Swagger instead)
3. Low-stock warning UI (mention it in the report)

Never cut: the visit lifecycle (Acts 1–5) and the cross-VM HTTP story.