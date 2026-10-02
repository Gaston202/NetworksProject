import { afterEach, describe, expect, it } from 'vitest'
import { SESSION_KEY, clearSession, readSession, writeSession } from './session'

afterEach(() => {
  localStorage.clear()
})

const VALID = {
  token: 'tok-1',
  user: { id: 2, full_name: 'Amina', email: 'd@x.y', role: 'doctor' },
} as const

describe('session storage', () => {
  it('round-trips a session', () => {
    writeSession(VALID)
    expect(readSession()).toEqual(VALID)
  })

  it('returns null when nothing is stored', () => {
    expect(readSession()).toBeNull()
  })

  it('returns null and clears corrupt or malformed payloads', () => {
    localStorage.setItem(SESSION_KEY, '{not json')
    expect(readSession()).toBeNull()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()

    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 't' }))
    expect(readSession()).toBeNull()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('rejects unknown roles', () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        token: 't',
        user: { id: 1, full_name: 'X', email: 'x@x.y', role: 'hacker' },
      }),
    )
    expect(readSession()).toBeNull()
  })

  it('clearSession removes the key', () => {
    writeSession(VALID)
    clearSession()
    expect(readSession()).toBeNull()
  })
})