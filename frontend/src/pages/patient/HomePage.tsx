import { Link } from 'react-router'
import { CalendarCheck2, CalendarPlus, FileHeart, Wallet } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { EmptyState, PageError } from '@/components/PageState'
import { StatCard } from '@/components/StatCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useResource } from '@/hooks/useResource'
import { formatDateTime, formatLongDate, formatMoney, greeting } from '@/lib/format'
import type { AppointmentOut, ConsultationOut, InvoiceOut } from '@/lib/types'

/** Patient landing page: next visit, balance, latest record, quick booking. */
export default function PatientHomePage() {
  const { user } = useAuth()
  const appointments = useResource<AppointmentOut[]>('/appointments')
  const invoices = useResource<InvoiceOut[]>('/invoices')
  const consultations = useResource<ConsultationOut[]>('/consultations')
  const error = appointments.error ?? invoices.error ?? consultations.error

  const now = new Date()
  // The API sorts newest first; upcoming visits read soonest first.
  const upcoming =
    appointments.data
      ?.filter((a) => a.status === 'booked' && new Date(a.starts_at) > now)
      .reverse() ?? null
  const next = upcoming?.[0]
  const unpaid = invoices.data?.filter((invoice) => invoice.status === 'unpaid') ?? null
  const completedCount = appointments.data?.filter((a) => a.status === 'completed').length
  const latest = consultations.data?.[0]
  const latestVisit = latest
    ? appointments.data?.find((a) => a.id === latest.appointment_id)
    : undefined

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{formatLongDate(now)}</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting(now)}
            {user ? `, ${user.full_name.split(' ')[0]}` : ''}
          </h1>
        </div>
        <Button asChild>
          <Link to="/patient/book">
            <CalendarPlus className="size-4" />
            Book appointment
          </Link>
        </Button>
      </div>

      {error !== null ? <PageError error={error} /> : null}

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardDescription>Your next visit</CardDescription>
          {upcoming === null ? (
            <Skeleton className="h-7 w-64" />
          ) : next === undefined ? (
            <CardTitle className="text-lg">No upcoming visits</CardTitle>
          ) : (
            <CardTitle className="text-lg">{formatDateTime(next.starts_at)}</CardTitle>
          )}
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          {next === undefined ? (
            <p className="text-sm text-muted-foreground">
              Pick a department and a doctor — free slots update live.
            </p>
          ) : (
            <p className="text-sm">
              <span className="font-medium">{next.doctor_name}</span>
              <span className="text-muted-foreground"> · {next.department_name}</span>
            </p>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to="/patient/appointments">All appointments</Link>
          </Button>
        </CardContent>
      </Card>

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Upcoming visits"
          icon={CalendarCheck2}
          value={upcoming?.length ?? null}
        />
        <StatCard
          label="Balance due"
          icon={Wallet}
          value={unpaid === null ? null : formatMoney(unpaid.reduce((sum, i) => sum + i.total, 0))}
          hint={
            unpaid === null
              ? undefined
              : unpaid.length === 0
                ? 'All invoices settled'
                : `${unpaid.length} unpaid invoice${unpaid.length === 1 ? '' : 's'} — pay at the front desk`
          }
        />
        <StatCard
          label="Completed visits"
          icon={FileHeart}
          value={completedCount ?? null}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Latest consultation</CardTitle>
          <CardDescription>From your medical record</CardDescription>
        </CardHeader>
        <CardContent>
          {consultations.data === null ? (
            <Skeleton className="h-16 w-full" />
          ) : latest === undefined ? (
            <EmptyState title="No consultations yet" hint="Records appear after your first visit." />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{latest.diagnosis}</p>
                <p className="text-xs text-muted-foreground">
                  {latestVisit?.doctor_name ? `${latestVisit.doctor_name} · ` : ''}
                  {formatDateTime(latest.created_at)}
                </p>
              </div>
              {latest.prescription ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">
                  <span className="font-medium">Rx </span>
                  {latest.prescription}
                </p>
              ) : null}
              <Link
                to="/patient/records"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Open my records
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
