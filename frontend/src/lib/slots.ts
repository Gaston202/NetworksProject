/** Pure helpers for the availability (slot window) form — mirrors SlotBulkIn. */

export interface SlotBulkIn {
  first_date: string
  days: number
  start_hour: number
  start_minute: number
  hours_per_day: number
  slot_minutes: number
}

export interface SlotWindowValues {
  /** "YYYY-MM-DD" */
  firstDate: string
  days: number
  /** "HH:MM" */
  startTime: string
  hoursPerDay: number
  slotMinutes: number
}

/** Backend bounds (backend/app/schemas.py SlotBulkIn). */
export const SLOT_LIMITS = {
  maxDays: 60,
  maxHoursPerDay: 12,
  minSlotMinutes: 10,
  maxSlotMinutes: 120,
} as const

export const SLOT_LENGTH_OPTIONS = [15, 20, 30, 45, 60] as const

/** Same arithmetic as create_slots: whole slots that fit each daily window. */
export function countSlots(values: SlotWindowValues): number {
  return slotsPerDay(values) * (Number.isInteger(values.days) && values.days > 0 ? values.days : 0)
}

/** Whole slots in one daily window (0 for empty/invalid input). */
export function slotsPerDay(values: Pick<SlotWindowValues, 'hoursPerDay' | 'slotMinutes'>): number {
  const { hoursPerDay, slotMinutes } = values
  if (!Number.isFinite(hoursPerDay) || hoursPerDay <= 0 || !(slotMinutes > 0)) return 0
  return Math.floor((hoursPerDay * 60) / slotMinutes)
}

/** Client-side check before POSTing; returns a message or null when valid. */
export function validateSlotWindow(values: SlotWindowValues): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.firstDate)) return 'Pick a first date'
  if (!/^\d{2}:\d{2}$/.test(values.startTime)) return 'Pick a start time'
  if (!Number.isInteger(values.days) || values.days < 1 || values.days > SLOT_LIMITS.maxDays) {
    return `Days must be between 1 and ${SLOT_LIMITS.maxDays}`
  }
  if (values.hoursPerDay <= 0 || values.hoursPerDay > SLOT_LIMITS.maxHoursPerDay) {
    return `Hours per day must be above 0 and at most ${SLOT_LIMITS.maxHoursPerDay}`
  }
  const [hour, minute] = values.startTime.split(':').map(Number)
  if (hour * 60 + minute + values.hoursPerDay * 60 > 24 * 60) {
    return 'The daily window must end before midnight'
  }
  if (countSlots(values) === 0) return 'The window is shorter than one slot'
  return null
}

export function toSlotBulkIn(values: SlotWindowValues): SlotBulkIn {
  const [hour, minute] = values.startTime.split(':').map(Number)
  return {
    first_date: values.firstDate,
    days: values.days,
    start_hour: hour,
    start_minute: minute,
    hours_per_day: values.hoursPerDay,
    slot_minutes: values.slotMinutes,
  }
}
