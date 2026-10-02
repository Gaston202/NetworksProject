# HMS Basic Frontend — Design (2026-10-02)

Scope: the full roadmap Week-4 frontend in one pass — login/register, role shell,
patient booking + records, doctor consultation, admin management + billing
(demo Acts 1–4). Screens for endpoints still on the SQL stack are coded to the
API contract and light up when the Motor migration lands. Owner-approved
2026-10-02 ("ALL", approach A: shadcn + fetch + Context).

Stack per ADR-0011 (React + Vite + TS + Tailwind v4, static SPA) with these
additions:

- **shadcn/ui** — CLI-generated components (`components.json`, `cn()`, tokens
  in `index.css`, `@/` alias). Owner-requested.
- **react-router-dom** — client routing; nginx SPA fallback stays.
- No TanStack Query / react-hook-form / zod — a typed fetch client + Context is
  deliberately minimal for ~8 screens.

## Structure

```
frontend/src/
  lib/api.ts            typed fetch wrapper (BASE + /api path, Bearer, ApiError)
  lib/session.ts        session storage key + read/write/clear helpers
  lib/types.ts          TS interfaces mirroring backend Out schemas
  auth/AuthContext.tsx  user+token, login/register/logout, boot rehydrate
  auth/RequireRole.tsx  route guard (role prop → redirect /login or role home)
  components/ui/        shadcn generated
  components/           AppShell (sidebar+header, role badge, logout), StatusBadge,
                        PageState (loading/error/empty)
  pages/login/          LoginPage, RegisterPage
  pages/patient/        BookPage, MyAppointmentsPage, MyRecordsPage
  pages/doctor/         DoctorAppointmentsPage (+ appointment detail dialog)
  pages/admin/          UsersPage, DepartmentsPage, PatientsPage (walk-in),
                        BillingPage
  App.tsx               router
```

Dev: existing proxy `/api → http://localhost:8000` (no CORS in dev). Prod:
`VITE_API_BASE_URL` baked at build (ADR-0011).

## Auth & API client

- `request<T>(path, {method, body})` → fetch(`${BASE}/api${path}`), Bearer token
  from session storage, JSON bodies, raises `ApiError(status, message)` parsed
  from FastAPI `detail`; `204 → undefined`.
- Session `{token, user}` persisted in `localStorage` (key `hms-session`).
  Accepted XSS tradeoff: the backend is Bearer-only (CORS
  `allow_credentials=False`, ADR-0006/0011) and the demo runs plain HTTP.
- Boot: token present → `GET /auth/me`; 401 → clear session. Any 401 mid-app →
  clear + redirect to `/login`.
- `login` = `POST /auth/login` then `GET /auth/me`; `register` = `POST
  /auth/register` (always creates a Patient, then auto-login).

## Routes ↔ demo Acts

| Route | Screen | Endpoints |
|---|---|---|
| `/login`, `/register` | login / patient self-register | `POST /auth/login`, `/auth/register`, `GET /auth/me` |
| `/patient` | booking wizard: department → doctor → free slot → book; slots refetch after booking (disappearing slot, Act 1) | `GET /departments`, `GET /doctors?department_id`, `GET /doctors/{id}/slots?free=true`, `POST /appointments` |
| `/patient/appointments` | my appointments + cancel while `booked` | `GET /appointments`, `PATCH /appointments/{id}/cancel` |
| `/patient/records` | my consultations \| my invoices (tabs) | `GET /consultations`, `GET /invoices` |
| `/doctor` | my appointment queue → detail dialog: consultation form (diagnosis/notes/Rx), then Complete → invoice from response (Act 2) | `GET /appointments`, `GET /appointments/{id}`, `POST /appointments/{id}/consultation`, `PATCH /appointments/{id}/complete` |
| `/admin/users` | user directory (role filter), staff create dialog (admin/doctor), doctor edit (dept/specialty, active) | `GET`, `PATCH /admin/users/{id}`, `POST /auth/staff` |
| `/admin/departments` | dept CRUD; delete blocked by backend 409 while doctors assigned | `GET/POST/PATCH/DELETE /departments` |
| `/admin/patients` | patients list + walk-in booking (same wizard, patient first) | `GET /admin/patients`, `POST /appointments` with `patient_id` |
| `/admin/billing` | invoices (status filter) + mark paid | `GET /invoices`, `PATCH /invoices/{id}/paid` |

Booking is one shared component (`BookingWizard`) with an optional
patient-picker prefix for admin walk-ins.

## Known gaps (accepted)

- `AppointmentOut` carries profile **ids only** (no names) → lists show ids.
- No slot date query param exists → free slots are grouped by day **client-side**.
- Doctor slot-creation has no UI (Act 4 shows it via Swagger) — deliberate cut,
  owner-approved.
- `scheduling`/`clinical`/`billing` are still SQL on this branch → those screens
  render their error states until the Motor migration lands. Auth/admin/health
  are end-to-end verifiable today.

## UI states

- Lists: skeleton (loading) / error with backend message / empty state.
- Mutations: button `disabled`/spinner, success + error toasts (sonner);
  backend `detail` surfaced verbatim ("Slot taken - pick another", dept-delete
  409, already-paid).
- 401 → session cleared → `/login`. 403/404/409 → toast with backend message.

## Testing (modest)

Vitest + Testing Library + jsdom: `api.ts` (Bearer injection, JSON body,
`ApiError` from `{detail}`), session helpers, `RequireRole` redirects, booking
cascade with the mocked module. `npm run test` = `vitest run`.

## Verification

1. `npm run build` (tsc) and `npm run lint` clean; vitest green.
2. Manual: uvicorn on :8000 + `npm run dev`; seed accounts log in; admin
   users/departments screens act on real data; role guard redirects.