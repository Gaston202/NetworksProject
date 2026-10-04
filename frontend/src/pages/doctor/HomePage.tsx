import { Link } from 'react-router'
import { CalendarClock, ClipboardCheck, Stethoscope, Users } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
import { StatCard } from '@/components/StatCard'
import { AppointmentStatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useOwnDoctorProfile } from '@/hooks/useOwnDoctorProfile'
import { useResource } from '@/hooks/useResource'
import { formatLongDate, formatTime, greeting, isSameLocalDay } from '@/lib/format'
import type { AppointmentOut, SlotOut } from '@/lib/types'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Doctor landing page: today's list, next patient, availability at a glance. */
export default function DoctorHomePage() {
  const { user } = useAuth()
  const { doctor, error: profileError } = useOwnDoctorProfile()
  const appointments = useResource<AppointmentOut[]>('/appointments')
  const slots = useResource<SlotOut[]>(doctor === null ? null : `/doctors/${doctor.id}/slots`)
  const error = profileError ?? appointments.error ?? slots.error

  const now = new Date()
  const today =
    appointments.data
      ?.filter((a) => a.status !== 'cancelled' && isSameLocalDay(a.starts_at, now))
      .reverse() ?? null
  const open = (a: AppointmentOut) => a.status === 'booked' || a.status === 'consulted'
  const next = today?.find((a) => open(a) && new Date(a.ends_at) > now)
  const weekAhead = new Date(now.getTime() + WEEK_MS)
  const weekBehind = new Date(now.getTime() - WEEK_MS)
  const openThisWeek = appointments.data?.filter(
    (a) => open(a) && new Date(a.starts_at) >= now && new Date(a.starts_at) < weekAhead,
  ).length
  const completedLastWeek = appointments.data?.filter(
    (a) => a.status === 'completed' && new Date(a.starts_at) >= weekBehind,
  ).length
  const freeSlots = slots.data?.filter(
    (s) => s.is_free && new Date(s.starts_at) > now && new Date(s.starts_at) < weekAhead,
  ).length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{formatLongDate(now)}</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting(now)}
            {user ? `, ${user.full_name}` : ''}
          </h1>
          {doctor ? (
            <p className="text-sm text-muted-foreground">
              {doctor.department_name}
              {doctor.specialty ? ` · ${doctor.specialty}` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/doctor/schedule">My schedule</Link>
          </Button>
          <Button asChild>
            <Link to="/doctor/queue">Open queue</Link>
          </Button>
        </div>
      </div>

      {error !== null ? <PageError error={error} /> : null}

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Patients today" icon={Users} value={today?.length ?? null} />
        <StatCard
          label="Open visits, next 7 days"
          icon={Stethoscope}
          value={openThisWeek ?? null}
        />
        <StatCard
          label="Free slots, next 7 days"
          icon={CalendarClock}
          value={freeSlots ?? null}
          hint={freeSlots === 0 ? 'Open availability so patients can book' : undefined}
        />
        <StatCard
          label="Completed, last 7 days"
          icon={ClipboardCheck}
          value={completedLastWeek ?? null}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Today</CardTitle>
          <CardDescription>
            {next
              ? `Next: ${next.patient_name} at ${formatTime(next.starts_at)}`
              : 'No more patients waiting today'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {today === null ? (
            <PageLoading rows={3} />
          ) : today.length === 0 ? (
            <EmptyState title="No visits today" hint="Upcoming bookings are in your queue." />
          ) : (
            <ol className="flex flex-col divide-y">
              {today.map((appointment) => (
                <li
                  key={appointment.id}
                  className={`flex items-center gap-4 py-2.5 ${
                    appointment.id === next?.id ? 'font-medium' : ''
                  }`}
                >
                  <span className="tabular w-12 text-sm text-muted-foreground">
                    {formatTime(appointment.starts_at)}
                  </span>
                  <span className="flex-1 text-sm">{appointment.patient_name}</span>
                  <AppointmentStatusBadge status={appointment.status} />
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
