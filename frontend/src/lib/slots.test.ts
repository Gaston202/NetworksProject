import { describe, expect, it } from 'vitest'
import { countSlots, slotsPerDay, toSlotBulkIn, validateSlotWindow } from './slots'
import type { SlotWindowValues } from './slots'

const BASE: SlotWindowValues = {
  firstDate: '2026-10-05',
  days: 5,
  startTime: '09:30',
  hoursPerDay: 3,
  slotMinutes: 30,
}

describe('slot window helpers', () => {
  it('counts whole slots per day times days (same as the backend)', () => {
    expect(slotsPerDay(BASE)).toBe(6)
    expect(countSlots(BASE)).toBe(30)
    expect(countSlots({ ...BASE, hoursPerDay: 1, slotMinutes: 45 })).toBe(5)
  })

  it('treats empty or invalid numbers as zero slots', () => {
    expect(countSlots({ ...BASE, days: Number.NaN })).toBe(0)
    expect(countSlots({ ...BASE, hoursPerDay: Number.NaN })).toBe(0)
    expect(countSlots({ ...BASE, hoursPerDay: 0.25 })).toBe(0)
  })

  it('maps form values to the SlotBulkIn payload', () => {
    expect(toSlotBulkIn(BASE)).toEqual({
      first_date: '2026-10-05',
      days: 5,
      start_hour: 9,
      start_minute: 30,
      hours_per_day: 3,
      slot_minutes: 30,
    })
  })

  it('validates bounds before the request is sent', () => {
    expect(validateSlotWindow(BASE)).toBeNull()
    expect(validateSlotWindow({ ...BASE, days: 61 })).toMatch(/Days/)
    expect(validateSlotWindow({ ...BASE, hoursPerDay: 13 })).toMatch(/Hours/)
    expect(validateSlotWindow({ ...BASE, startTime: '22:00' })).toMatch(/midnight/)
    expect(validateSlotWindow({ ...BASE, firstDate: '' })).toMatch(/date/)
  })
})
