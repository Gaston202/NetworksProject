import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import ProfilePage from './ProfilePage'
import type { ProfileOut } from '@/lib/types'

vi.mock('@/lib/api', () => ({
  request: vi.fn(),
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Unexpected error',
}))
const refreshUser = vi.fn()
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ refreshUser }),
}))

// vi.mock is hoisted; the import below receives the mocked module.
import { request } from '@/lib/api'

const requestMock = request as unknown as Mock

const PROFILE: ProfileOut = {
  id: 4,
  full_name: 'Sami Patient',
  email: 'patient@hms.example.com',
  role: 'patient',
  created_at: '2026-06-01T10:00:00',
  phone: '+216 55 214 870',
  address: '12 Rue de Marseille, Tunis',
  date_of_birth: '1991-04-12T00:00:00',
  department_name: null,
  specialty: null,
}

describe('ProfilePage', () => {
  beforeEach(() => {
    requestMock.mockReset()
    refreshUser.mockReset()
    // GET /auth/me/profile and PATCH /auth/me both answer with the profile.
    requestMock.mockResolvedValue(PROFILE)
  })

  it('sends only the changed fields and refreshes the session user', async () => {
    render(<ProfilePage />)
    const phone = await screen.findByLabelText('Phone')
    await userEvent.clear(phone)
    await userEvent.type(phone, '+216 20 111 222')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(refreshUser).toHaveBeenCalled())
    expect(requestMock).toHaveBeenCalledWith('/auth/me', {
      method: 'PATCH',
      body: { phone: '+216 20 111 222' },
    })
  })

  it('blocks a password change when the confirmation differs', async () => {
    render(<ProfilePage />)
    await userEvent.type(await screen.findByLabelText('Current password'), 'hms-demo-1234')
    await userEvent.type(screen.getByLabelText('New password'), 'new-password-1')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'new-password-2')
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('do not match')
    expect(requestMock).not.toHaveBeenCalledWith('/auth/me/password', expect.anything())
  })
})
