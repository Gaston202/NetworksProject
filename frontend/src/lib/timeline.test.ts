import { describe, expect, it } from 'vitest'
import { buildTimeline, groupByYear } from './timeline'
import type { AppointmentOut, ConsultationOut, InvoiceOut } from './types'

function appointment(id: number, startsAt: string, status: AppointmentOut['status']): AppointmentOut {
  return {
    id,
    slot_id: id,
    patient_id: 1,
    doctor_id: 2,
    status,
    starts_at: startsAt,
    ends_at: startsAt,
    created_at: startsAt,
    patient_name: 'Sami Patient',
    doctor_name: 'Dr. Amina Haddad',
    department_name: 'Cardiology',
  }
}

const consultation: ConsultationOut = {
  id: 10,
  appointment_id: 10,
  diagnosis: 'Essential hypertension',
  notes: null,
  prescription: 'Amlodipine 5 mg',
  created_at: '2026-09-20T09:20:00',
}
const invoice: InvoiceOut = {
  id: 7,
  appointment_id: 10,
  total: 25,
  status: 'unpaid',
  created_at: '2026-09-20T09:30:00',
  patient_name: 'Sami Patient',
  doctor_name: 'Dr. Amina Haddad',
  department_name: 'Cardiology',
  visit_starts_at: '2026-09-20T09:00:00',
}

describe('buildTimeline', () => {
  it('keeps only visits with a record and joins consultation + invoice', () => {
    const entries = buildTimeline(
      [
        appointment(10, '2026-09-20T09:00:00', 'completed'),
        appointment(11, '2026-10-09T09:00:00', 'booked'),
        appointment(12, '2026-09-01T09:00:00', 'cancelled'),
      ],
      [consultation],
      [invoice],
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].consultation?.diagnosis).toBe('Essential hypertension')
    expect(entries[0].invoice?.status).toBe('unpaid')
  })

  it('sorts newest first and groups by year', () => {
    const entries = buildTimeline(
      [
        appointment(1, '2025-12-01T09:00:00', 'completed'),
        appointment(2, '2026-03-01T09:00:00', 'completed'),
        appointment(3, '2026-08-01T09:00:00', 'completed'),
      ],
      [],
      [],
    )
    expect(entries.map((e) => e.appointment.id)).toEqual([3, 2, 1])
    expect(groupByYear(entries).map(([year, items]) => [year, items.length])).toEqual([
      [2026, 2],
      [2025, 1],
    ])
  })
})
