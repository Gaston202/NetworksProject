import { clearSession, readSession } from './session'

/**
 * API base URL, empty in dev — the Vite proxy handles `/api`
 * (see vite.config.ts). Baked in at build time for the VM deployment (ADR-0011).
 */
const API_BASE: string = import.meta.env.VITE_API_BASE_URL ?? ''

/** Fired on any 401 so the auth context can drop the session app-wide. */
export const UNAUTHORIZED_EVENT = 'hms:unauthorized'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * JSON-serializable payload. Looser than an index-signature record so typed
 * interfaces (UserUpdateIn & co.) assign without casts.
 */
export type RequestBody = object

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: RequestBody
  query?: Record<string, string | number | boolean | undefined>
}

/**
 * Typed fetch to `${API_BASE}/api${path}` with the Bearer token attached.
 * Resolves with parsed JSON (204 → undefined); raises ApiError with the
 * backend's `detail` message for every non-2xx.
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, query } = options

  let queryString = ''
  if (query) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value))
    }
    const encoded = params.toString()
    if (encoded) queryString = `?${encoded}`
  }

  const headers: Record<string, string> = {}
  const session = readSession()
  if (session) headers.Authorization = `Bearer ${session.token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${API_BASE}/api${path}${queryString}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the API — is the backend running?')
  }

  if (response.status === 204) return undefined as T

  if (!response.ok) {
    if (response.status === 401) {
      clearSession()
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    throw new ApiError(response.status, await extractErrorMessage(response))
  }

  return (await response.json()) as T
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json()
    const detail = (data as { detail?: unknown } | null)?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      // FastAPI 422 validation errors: [{loc, msg, type}, ...]
      return detail
        .map((item) =>
          item !== null && typeof item === 'object' && 'msg' in item
            ? String((item as { msg: unknown }).msg)
            : String(item),
        )
        .join('; ')
    }
  } catch {
    // Body wasn't JSON — fall through to the status-based message.
  }
  return `Request failed (HTTP ${response.status})`
}

/** Best-effort human message for toasts and inline error states. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Unexpected error'
}