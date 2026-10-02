import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthContext'
import { RequireRole } from './RequireRole'
import { SESSION_KEY, writeSession } from '@/lib/session'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const ME = {
  id: 1,
  full_name: 'Admin',
  email: 'a@x.y',
  role: 'admin' as const,
  created_at: '2026-10-01T00:00:00Z',
}

function meResponse(role: 'admin' | 'doctor' | 'patient') {
  return new Response(JSON.stringify({ ...ME, role }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderGuard(role: 'admin' | 'doctor' | 'patient') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<p>login page</p>} />
          <Route element={<RequireRole role={role} />}>
            <Route path="/protected" element={<p>doctor home</p>} />
          </Route>
          <Route path="*" element={<p>no match</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('RequireRole', () => {
  it('redirects anonymous users to /login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(),
    )
    renderGuard('doctor')
    expect(await screen.findByText('login page')).toBeInTheDocument()
    expect(screen.queryByText('doctor home')).not.toBeInTheDocument()
  })

  it('renders children for the right role', async () => {
    writeSession({
      token: 'tok-1',
      user: { id: 1, full_name: ME.full_name, email: ME.email, role: 'doctor' },
    })
    const fetchMock = vi.fn(async () => meResponse('doctor'))
    vi.stubGlobal('fetch', fetchMock)

    renderGuard('doctor')
    expect(await screen.findByText('doctor home')).toBeInTheDocument()
  })

  it('redirects the wrong role to that role’s home', async () => {
    writeSession({
      token: 'tok-1',
      user: { id: 2, full_name: ME.full_name, email: ME.email, role: 'patient' },
    })
    const fetchMock = vi.fn(async () => meResponse('patient'))
    vi.stubGlobal('fetch', fetchMock)

    renderGuard('doctor')
    expect(await screen.findByText('no match')).toBeInTheDocument()
    expect(screen.queryByText('doctor home')).not.toBeInTheDocument()
  })

  it('drops the session when /auth/me rejects with 401', async () => {
    writeSession({
      token: 'tok-1',
      user: { id: 1, full_name: ME.full_name, email: ME.email, role: 'doctor' },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 })),
    )

    renderGuard('doctor')
    expect(await screen.findByText('login page')).toBeInTheDocument()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })
})