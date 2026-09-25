# ADR-0006: Authentication — JWT bearer tokens

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

A hospital system without login is hard to defend in a course demo, and role-based
access control (RBAC) is a common graded element. Candidates: JWT bearer tokens,
server-side session cookies, no auth.

## Decision

**JWT bearer tokens** issued by FastAPI on login, stored client-side, sent as
`Authorization: Bearer <token>` on every API call. Roles are embedded in the token
claims and enforced per-endpoint with FastAPI dependencies.

- Access tokens: short-lived (e.g., 30–60 min) — long enough for a demo, short
  enough to look correct.
- Passwords: hashed with bcrypt (never stored or logged in plain text).
- Plain HTTP is accepted for this course project (no TLS) — documented as a known
  limitation (ADR-0002 stays HTTP-only).

## Consequences

- Statelessness: any uvicorn worker can validate a token without a session store.
- Token storage in the browser (localStorage) is an XSS-sensitive choice; acceptable
  here, noted for the "security considerations" section of the report.
- Each of the five roles maps to a FastAPI dependency guard
  (`require_role("doctor")` etc.).
- Logout is client-side token deletion (no server revocation list — out of scope).

## Related

- [ADR-0007](ADR-0007-user-roles-and-rbac.md)
- [ADR-0002](ADR-0002-deployment-topology-two-vms.md)