import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { SlotWindowForm } from './SlotWindowForm'

vi.mock('@/lib/api', () => ({
  request: vi.fn(),
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Unexpected error',
}))

// vi.mock is hoisted; the import below receives the mocked module.
import { request } from '@/lib/api'

const requestMock = request as unknown as Mock

describe('SlotWindowForm', () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it('previews the slot count and posts the bulk window', async () => {
    const onCreated = vi.fn()
    requestMock.mockResolvedValue([])
    render(<SlotWindowForm doctorId={7} onCreated={onCreated} />)

    // Defaults: 5 days × (3h / 30min) = 30 slots
    expect(screen.getByText('30')).toBeInTheDocument()

    const days = screen.getByLabelText('Number of days')
    await userEvent.clear(days)
    await userEvent.type(days, '2')
    expect(screen.getByText('12')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open availability' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(requestMock).toHaveBeenCalledWith('/doctors/7/slots', {
      method: 'POST',
      body: expect.objectContaining({ days: 2, start_hour: 9, start_minute: 0, slot_minutes: 30 }),
    })
  })

  it('shows the backend overlap message and keeps the form open', async () => {
    const onCreated = vi.fn()
    requestMock.mockRejectedValue(
      new Error('Slot range 2026-10-05 09:00 overlaps existing slots - nothing created'),
    )
    render(<SlotWindowForm doctorId={7} onCreated={onCreated} />)

    await userEvent.click(screen.getByRole('button', { name: 'Open availability' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/overlaps existing slots/)
    expect(onCreated).not.toHaveBeenCalled()
  })
})
