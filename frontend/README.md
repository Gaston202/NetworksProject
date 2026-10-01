# HMS Frontend

React 19 + TypeScript + Vite + Tailwind CSS SPA (ADR-0011). Currently the
Week-1 shell: backend connectivity check; the role-based UI (login, per-role
screens) is Week 4 per `docs/roadmap.md`.

```bash
npm install
npm run dev      # http://localhost:5173 — /api proxied to localhost:8000
npm run build    # tsc -b + production build
npm run lint     # oxlint
```

`VITE_API_BASE_URL` (see `.env.example`) overrides the client-side API origin
in production builds; in dev leave it empty and use the Vite proxy.