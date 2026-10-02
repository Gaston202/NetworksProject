import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, UNAUTHORIZED_EVENT, request } from './api'
import { SESSION_KEY, writeSession } from './session'

// The API base is empty in the test env, so request() targets `/api${path}`.

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('request', () => {
  it('attaches the stored Bearer token and JSON body', async () => {
    writeSession({
      token: 'tok-1',
      user: { id: 1, full_name: 'Admin', email: 'a@x.y', role: 'admin' },
    })
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }, 200))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      request<{ ok: boolean }>('/ping', { method: 'POST', body: { a: 1 } }),
    ).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ping',
      expect.objectContaining({
        method: 'POST',
        body: '{"a":1}',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok-1',
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('omits the Authorization header when there is no session', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse([], 200))
    vi.stubGlobal('fetch', fetchMock)

    await request('/departments')

    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.headers).toEqual({}) as unknown
  })

  it('resolves undefined on 204 without parsing', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(request<void>('/x', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('raises ApiError with the backend detail message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'Slot taken - pick another' }, 409)))

    const error = await request('/appointments', { method: 'POST' }).catch(
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).message).toBe('Slot taken - pick another')
  })

  it('joins FastAPI validation details into one message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ detail: [{ msg: 'field required' }, { msg: 'bad value' }] }, 422),
      ),
    )

    await expect(request('/x')).rejects.toMatchObject({ status: 422, message: 'field required; bad value' })
  })

  it('clears the session and fires the unauthorized event on 401', async () => {
    writeSession({
      token: 'tok-1',
      user: { id: 1, full_name: 'Admin', email: 'a@x.y', role: 'admin' },
    })
    const listener = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, listener)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'Unauthorized' }, 401)))

    await expect(request('/auth/me')).rejects.toBeInstanceOf(ApiError)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    window.removeEventListener(UNAUTHORIZED_EVENT, listener)
  })

  it('maps a network failure to ApiError(0)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    await expect(request('/x')).rejects.toMatchObject({ status: 0 })
  })
})