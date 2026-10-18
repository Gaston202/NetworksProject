import type { AppointmentOut, ConsultationOut, InvoiceOut } from './types'

/** One visit in the patient's medical timeline. */
export interface TimelineEntry {
  appointment: AppointmentOut
  consultation: ConsultationOut | null
  invoice: InvoiceOut | null
}

/**
 * Join the three role-scoped lists by appointment id. A visit belongs on the
 * timeline once it has a consultation or is completed; newest first.
 */
export function buildTimeline(
  appointments: readonly AppointmentOut[],
  consultations: readonly ConsultationOut[],
  invoices: readonly InvoiceOut[],
): TimelineEntry[] {
  const consultationByVisit = new Map(consultations.map((c) => [c.appointment_id, c]))
  const invoiceByVisit = new Map(invoices.map((i) => [i.appointment_id, i]))
  return appointments
    .filter((a) => a.status === 'completed' || consultationByVisit.has(a.id))
    .map((appointment) => ({
      appointment,
      consultation: consultationByVisit.get(appointment.id) ?? null,
      invoice: invoiceByVisit.get(appointment.id) ?? null,
    }))
    .sort((a, b) => b.appointment.starts_at.localeCompare(a.appointment.starts_at))
}

/** Group consecutive entries by calendar year, preserving order. */
export function groupByYear(entries: readonly TimelineEntry[]): [number, TimelineEntry[]][] {
  const groups: [number, TimelineEntry[]][] = []
  for (const entry of entries) {
    const year = new Date(entry.appointment.starts_at).getFullYear()
    const last = groups.at(-1)
    if (last && last[0] === year) last[1].push(entry)
    else groups.push([year, [entry]])
  }
  return groups
}
