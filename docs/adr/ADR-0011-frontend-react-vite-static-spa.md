# ADR-0011: Frontend — React + Vite static SPA served by nginx

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

The Ubuntu Desktop VM must serve a web frontend over plain HTTP. Candidates:
React+Vite static SPA, Next.js static export, Next.js with a Node server.

## Decision

**React + Vite + TypeScript + Tailwind CSS**, built to static files, served by
**nginx** on `hms-desktop` port 80.

- No Node.js runtime on the frontend VM in production — nginx + static files only.
- The API base URL is a build-time environment variable
  (`VITE_API_BASE_URL=http://10.0.2.10:8000`).
- Routing: client-side routing with an nginx fallback (`try_files ... /index.html`).
- Development happens on the Windows host with Vite's dev server proxying API calls
  to a backend instance (either local or the VM).

## Consequences

- Next.js was rejected: its SSR advantages don't apply to a static export, and a
  Node server on the desktop VM contradicts the "thin frontend host" story.
- The SPA calls the backend cross-origin → backend must enable CORS for
  `http://10.0.2.20` (ADR-0002 consequence, resolved here).
- Deploying the frontend = `npm run build` on the host, `scp`/rsync the `dist/`
  folder to the VM, reload nginx.

## Related

- [ADR-0002](ADR-0002-deployment-topology-two-vms.md)
- [ADR-0005](ADR-0005-virtualbox-network-mode.md)