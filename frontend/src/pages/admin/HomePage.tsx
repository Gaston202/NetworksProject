import { Link } from 'react-router'
import { Banknote, CalendarDays, ReceiptText, Stethoscope } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
import { StatCard } from '@/components/StatCard'
import { InvoiceStatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useResource } from '@/hooks/useResource'
import {
  formatDateTime,
  formatLongDate,
  formatMoney,
  greeting,
  isSameLocalDay,
} from '@/lib/format'
import type { AppointmentOut, DoctorOut, InvoiceOut, PatientOut } from '@/lib/types'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const RECENT_UNPAID = 5

/** Admin landing page: the hospital at a glance (all client-side aggregates). */
export default function AdminHomePage() {
  const { user } = useAuth()
  const appointments = useResource<AppointmentOut[]>('/appointments')
  const invoices = useResource<InvoiceOut[]>('/invoices')
  const patients = useResource<PatientOut[]>('/patients')
  const doctors = useResource<DoctorOut[]>('/doctors')
  const error = appointments.error ?? invoices.error ?? patients.error ?? doctors.error

  const now = new Date()
  const today =
    appointments.data?.filter((a) => a.status !== 'cancelled' && isSameLocalDay(a.starts_at, now)) ??
    null
  const unpaid = invoices.data?.filter((invoice) => invoice.status === 'unpaid') ?? null
  const weekBehind = new Date(now.getTime() - WEEK_MS)
  const collected = invoices.data
    ?.filter((i) => i.status === 'paid' && new Date(i.created_at) >= weekBehind)
    .reduce((sum, i) => sum + i.total, 0)

  // Today's load per department, busiest first.
  const byDepartment = new Map<string, number>()
  for (const appointment of today ?? []) {
    const name = appointment.department_name ?? 'Unassigned'
    byDepartment.set(name, (byDepartment.get(name) ?? 0) + 1)
  }
  const departmentLoad = [...byDepartment.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{formatLongDate(now)}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting(now)}
          {user ? `, ${user.full_name.split(' ')[0]}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">Carthage Medical Center at a glance.</p>
      </div>

      {error !== null ? <PageError error={error} /> : null}

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Appointments today"
          icon={CalendarDays}
          value={today?.length ?? null}
          hint={
            today === null
              ? undefined
              : `${today.filter((a) => a.status === 'completed').length} completed so far`
          }
        />
        <StatCard
          label="Outstanding"
          icon={ReceiptText}
          value={unpaid === null ? null : formatMoney(unpaid.reduce((sum, i) => sum + i.total, 0))}
          hint={unpaid === null ? undefined : `${unpaid.length} unpaid invoices`}
        />
        <StatCard
          label="Collected, last 7 days"
          icon={Banknote}
          value={collected === undefined ? null : formatMoney(collected)}
        />
        <StatCard
          label="Care team"
          icon={Stethoscope}
          value={doctors.data?.length ?? null}
          hint={patients.data ? `${patients.data.length} registered patients` : undefined}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Today by department</CardTitle>
            <CardDescription>Booked and completed visits</CardDescription>
          </CardHeader>
          <CardContent>
            {today === null ? (
              <PageLoading rows={3} />
            ) : departmentLoad.length === 0 ? (
              <EmptyState title="No visits today" />
            ) : (
              <ul className="flex flex-col divide-y">
                {departmentLoad.map(([name, count]) => (
                  <li key={name} className="flex items-center justify-between py-2.5 text-sm">
                    <span>{name}</span>
                    <span className="tabular font-medium">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent unpaid invoices</CardTitle>
            <CardDescription>Newest first</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {unpaid === null ? (
              <PageLoading rows={3} />
            ) : unpaid.length === 0 ? (
              <EmptyState title="Everything is settled" />
            ) : (
              <ul className="flex flex-col divide-y">
                {unpaid.slice(0, RECENT_UNPAID).map((invoice) => (
                  <li key={invoice.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{invoice.patient_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        #{invoice.id} · {invoice.doctor_name}
                        {invoice.visit_starts_at ? ` · ${formatDateTime(invoice.visit_starts_at)}` : ''}
                      </p>
                    </div>
                    <span className="tabular">{formatMoney(invoice.total)}</span>
                    <InvoiceStatusBadge status={invoice.status} />
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="outline" size="sm" className="self-start">
              <Link to="/admin/billing">Go to billing</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
