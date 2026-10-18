import { useMemo } from 'react'
import { Pill, Stethoscope } from 'lucide-react'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
import { InvoiceStatusBadge } from '@/components/StatusBadge'
import { useResource } from '@/hooks/useResource'
import { formatDateTime, formatMoney } from '@/lib/format'
import { buildTimeline, groupByYear } from '@/lib/timeline'
import type { TimelineEntry } from '@/lib/timeline'
import type { AppointmentOut, ConsultationOut, InvoiceOut } from '@/lib/types'

/**
 * Act 3 — the patient's medical timeline: one card per visit (diagnosis,
 * notes, prescription, invoice). All three lists are scoped to this patient
 * by the backend.
 */
export default function MyRecordsPage() {
  const appointments = useResource<AppointmentOut[]>('/appointments')
  const consultations = useResource<ConsultationOut[]>('/consultations')
  const invoices = useResource<InvoiceOut[]>('/invoices')
  const error = appointments.error ?? consultations.error ?? invoices.error

  const years = useMemo(() => {
    if (appointments.data === null || consultations.data === null || invoices.data === null) {
      return null
    }
    return groupByYear(buildTimeline(appointments.data, consultations.data, invoices.data))
  }, [appointments.data, consultations.data, invoices.data])

  const unpaid = invoices.data?.filter((invoice) => invoice.status === 'unpaid') ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">My records</h1>
        <p className="text-sm text-muted-foreground">
          Every visit with its diagnosis, prescription, and invoice — visible only to you.
        </p>
      </div>

      {unpaid.length > 0 ? (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <span className="tabular font-medium">
            {formatMoney(unpaid.reduce((sum, invoice) => sum + invoice.total, 0))}
          </span>{' '}
          due across {unpaid.length} unpaid invoice{unpaid.length === 1 ? '' : 's'} — settle at
          the front desk.
        </p>
      ) : null}

      {error !== null ? (
        <PageError error={error} />
      ) : years === null ? (
        <PageLoading rows={4} />
      ) : years.length === 0 ? (
        <EmptyState
          title="No medical records yet"
          hint="Your diagnosis and prescription appear here after your first visit."
        />
      ) : (
        years.map(([year, entries]) => (
          <section key={year} aria-labelledby={`year-${year}`} className="flex flex-col gap-3">
            <h2 id={`year-${year}`} className="text-sm font-semibold text-muted-foreground">
              {year}
            </h2>
            <ol className="relative flex flex-col gap-4 border-l pl-6">
              {entries.map((entry) => (
                <TimelineCard key={entry.appointment.id} entry={entry} />
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  )
}

function TimelineCard({ entry }: { entry: TimelineEntry }) {
  const { appointment, consultation, invoice } = entry
  return (
    <li className="relative">
      <span
        aria-hidden="true"
        className="absolute top-4 -left-[1.95rem] size-3 rounded-full border-2 border-background bg-primary"
      />
      <article className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{formatDateTime(appointment.starts_at)}</p>
            <p className="text-xs text-muted-foreground">
              {appointment.doctor_name ?? 'Doctor'} · {appointment.department_name ?? 'Visit'}
            </p>
          </div>
          {invoice ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="tabular">{formatMoney(invoice.total)}</span>
              <InvoiceStatusBadge status={invoice.status} />
            </div>
          ) : null}
        </header>

        {consultation ? (
          <>
            <div className="flex items-start gap-2">
              <Stethoscope className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="font-medium">{consultation.diagnosis}</p>
                {consultation.notes ? (
                  <p className="text-sm text-muted-foreground">{consultation.notes}</p>
                ) : null}
              </div>
            </div>
            {consultation.prescription ? (
              <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                <Pill className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <p>
                  <span className="sr-only">Prescription: </span>
                  {consultation.prescription}
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No consultation notes for this visit.</p>
        )}
      </article>
    </li>
  )
}
