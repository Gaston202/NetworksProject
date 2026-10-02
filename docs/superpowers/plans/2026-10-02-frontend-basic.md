# HMS Basic Frontend — Implementation Plan (2026-10-02)

Design: [specs/2026-10-02-frontend-basic-design.md](../specs/2026-10-02-frontend-basic-design.md)
(ADR-0011 stack + shadcn/ui, approach A). Owner asked to start implementation
immediately after design approval, so this plan runs without further gates.

## Steps

1. [x] Setup: `tsconfig.app.json` + `vite.config.ts` `@/` alias; `npm i
       react-router-dom`; `npx shadcn@latest init`; add components: button, card,
       input, label, textarea, select, table, badge, dialog, dropdown-menu, tabs,
       separator, skeleton, sonner.
2. [x] `lib/session.ts`, `lib/types.ts`, `lib/api.ts` (fetch wrapper + ApiError).
3. [x] `auth/AuthContext.tsx`, `auth/RequireRole.tsx`.
4. [x] `components/`: AppShell (sidebar per role, header, logout), StatusBadge,
       PageState.
5. [x] Shared `BookingWizard` (dept → doctor → free slots grouped by day; optional
       patient picker for walk-ins).
6. [x] Login/register pages; router in `App.tsx` with guards + role homes.
7. [x] Patient: BookPage, MyAppointmentsPage (cancel), MyRecordsPage (tabs).
8. [x] Doctor: DoctorAppointmentsPage + detail dialog (consultation form,
       complete → invoice).
9. [x] Admin: UsersPage (+ staff create, doctor edit, activate toggle),
       DepartmentsPage (CRUD + 409 handling), PatientsPage (walk-in),
       BillingPage (mark paid).
10. [x] Tests: vitest + RTL + jsdom; api/session/RequireRole/booking-cascade.
11. [x] Verify: `npm run test`, `npm run build`, `npm run lint`; manual dev
        run against uvicorn :8000 — test/build/lint pass and the prod build
        boots (login + auth redirect smoke-tested); live :8000 run deferred
        until the Motor migration lands.

## Notes

- Commits are the owner's; suggested conventional messages at the end.
- `index.css` keeps `@import 'tailwindcss'`; shadcn tokens are appended.
- No router data-APIs; plain `<Route>` + guards.