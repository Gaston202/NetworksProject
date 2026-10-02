import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { BookingWizard } from './BookingWizard'
import type {
  AppointmentOut,
  DepartmentOut,
  DoctorOut,
  SlotOut,
} from '@/lib/types'

vi.mock('@/lib/api', () => ({
  request: vi.fn(),
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Unexpected error',
}))

// vi.mock is hoisted; the import below receives the mocked module.
import { request } from '@/lib/api'

const requestMock = request as unknown as Mock

const DEPARTMENTS: DepartmentOut[] = [{ id: 1, name: 'Cardiology' }]
const DOCTORS: DoctorOut[] = [
  {
    id: 5,
    full_name: 'Dr. Sara Benali',
    email: 'sara@hms.local',
    department_id: 1,
    department_name: 'Cardiology',
    specialty: 'Interventional cardiology',
  },
]
const SLOTS: SlotOut[] = [
  {
    id: 77,
    doctor_id: 5,
    starts_at: '2026-10-05T09:00:00Z',
    ends_at: '2026-10-05T09:30:00Z',
    is_free: true,
  },
]
const APPOINTMENT: AppointmentOut = {
  id: 300,
  slot_id: 77,
  patient_id: 3,
  doctor_id: 5,
  status: 'booked',
  starts_at: '2026-10-05T09:00:00Z',
  ends_at: '2026-10-05T09:30:00Z',
  created_at: '2026-10-02T10:00:00Z',
}

// The picker labels slots in the viewer's local timezone — compute the label
// the same way the component does instead of hardcoding a UTC time.
const SLOT_LABEL = new Date(SLOTS[0].starts_at).toLocaleTimeString(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const bookings: Array<{ slot_id: number; patient_id?: number }> = []

function stubApi(): void {
  requestMock.mockReset()
  bookings.length = 0
  requestMock.mockImplementation(
    async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === '/departments') return DEPARTMENTS
      if (path === '/doctors') return DOCTORS
      if (path === '/doctors/5/slots') return SLOTS
      if (path === '/appointments' && init?.method === 'POST') {
        bookings.push(init.body as { slot_id: number; patient_id?: number })
        const appointment = { ...APPOINTMENT }
        if (typeof init.body === 'object' && init.body !== null && 'patient_id' in init.body) {
          appointment.patient_id = (init.body as { patient_id: number }).patient_id
        }
        return appointment
      }
      throw new Error(`Unexpected request in test: ${path}`)
    },
  )
}

async function bookFirstSlot(): Promise<void> {
  const user = userEvent.setup()
  // Departments resolve async; the comboboxes exist (disabled) before the data arrives.
  const departmentTrigger = await screen.findByRole('combobox', { name: 'Department' })
  await waitFor(() => expect(departmentTrigger).toBeEnabled())
  await user.click(departmentTrigger)
  await user.click(await screen.findByRole('option', { name: 'Cardiology' }))

  const doctorTrigger = await screen.findByRole('combobox', { name: 'Doctor' })
  await waitFor(() => expect(doctorTrigger).toBeEnabled())
  await user.click(doctorTrigger)
  await user.click(screen.getByRole('option', { name: /Dr\. Sara Benali/ }))

  await user.click(await screen.findByRole('button', { name: SLOT_LABEL }))
  await user.click(screen.getByRole('button', { name: `Book ${SLOT_LABEL}` }))
}

describe('BookingWizard', () => {
  beforeEach(stubApi)

  it('cascades department → doctor → slots and books a slot', async () => {
    render(<BookingWizard />)

    await bookFirstSlot()

    expect(bookings).toEqual([{ slot_id: 77 }])
    // The booked slot is refetched away from the picker (once to load, once after booking).
    await waitFor(() =>
      expect(
        requestMock.mock.calls.filter((call) => call[0] === '/doctors/5/slots'),
      ).toHaveLength(2),
    )
  })

  it('sends patient_id in admin walk-in mode', async () => {
    render(<BookingWizard patientId={9} patientName="Nour" />)
    expect(await screen.findByText('Booking for Nour — pick a department, then a doctor, then a slot.')).toBeInTheDocument()

    await bookFirstSlot()

    expect(bookings).toEqual([{ slot_id: 77, patient_id: 9 }])
  })
})