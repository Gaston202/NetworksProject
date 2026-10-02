import type { Role } from './types'

export const SESSION_KEY = 'hms.session'

/**
 * Persisted login state. Deliberately minimal: the JWT plus just enough user
 * data to route by role before /auth/me answers. Stored in localStorage —
 * the backend is Bearer-token only (ADR-0006), and this demo runs plain HTTP
 * (see the spec's accepted tradeoffs).
 */
export interface SessionUser {
  id: number
  full_name: string
  email: string
  role: Role
}

export interface StoredSession {
  token: string
  user: SessionUser
}

function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'doctor' || value === 'patient'
}

function isSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false
  const session = value as Record<string, unknown>
  const user = session.user
  return (
    typeof session.token === 'string' &&
    typeof user === 'object' &&
    user !== null &&
    typeof (user as Record<string, unknown>).id === 'number' &&
    typeof (user as Record<string, unknown>).full_name === 'string' &&
    typeof (user as Record<string, unknown>).email === 'string' &&
    isRole((user as Record<string, unknown>).role)
  )
}

export function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isSession(parsed)) {
      clearSession()
      return null
    }
    return parsed
  } catch {
    // Unparseable payload or unavailable storage — treat as logged out and
    // drop the corrupt value so the next read starts clean.
    clearSession()
    return null
  }
}

export function writeSession(session: StoredSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Storage unavailable — the app still works, it just won't survive reloads.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // Nothing to clear.
  }
}