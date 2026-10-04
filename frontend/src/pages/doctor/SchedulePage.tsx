import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
import { SlotWindowForm } from '@/components/SlotWindowForm'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { request } from '@/lib/api'
import { dayKey, formatDay, formatTime } from '@/lib/format'
import type { DoctorOut, SlotOut } from '@/lib/types'

const DAYS_SHOWN = 7

/** Upcoming slots in the next DAYS_SHOWN days, grouped by local day. */
function groupUpcoming(slots: SlotOut[], now: Date): [string, SlotOut[]][] {
  const horizon = new Date(now)
  horizon.setDate(horizon.getDate() + DAYS_SHOWN)
  const groups = new Map<string, SlotOut[]>()
  for (const slot of slots) {
    const start = new Date(slot.starts_at)
    if (start < now || start >= horizon) continue
    const key = dayKey(slot.starts_at)
    groups.set(key, [...(groups.get(key) ?? []), slot])
  }
  return [...groups.entries()]
}

/** Doctor's own calendar: the next week of slots + "Open availability". */
export default function SchedulePage() {
  const { user } = useAuth()
  const [doctor, setDoctor] = useState<DoctorOut | null>(null)
  const [slots, setSlots] = useState<SlotOut[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  const loadSlots = useCallback(async (doctorId: number) => {
    try {
      setSlots(await request<SlotOut[]>(`/doctors/${doctorId}/slots`))
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    if (user === null) return
    // The directory is the only place the doctor_profile id is exposed;
    // emails are unique, so match the signed-in account on it.
    request<DoctorOut[]>('/doctors')
      .then((doctors) => {
        const own = doctors.find((candidate) => candidate.email === user.email)
        if (own === undefined) throw new Error('No doctor profile is linked to this account')
        setDoctor(own)
        return loadSlots(own.id)
      })
      .catch(setError)
  }, [user, loadSlots])

  const days = useMemo(() => (slots === null ? [] : groupUpcoming(slots, new Date())), [slots])
  const freeCount = days.reduce(
    (sum, [, daySlots]) => sum + daySlots.filter((slot) => slot.is_free).length,
    0,
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">My schedule</h1>
        <p className="text-sm text-muted-foreground">
          Your bookable slots for the next {DAYS_SHOWN} days. Patients only see free slots.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="week-heading" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 id="week-heading" className="text-sm font-medium">
              This week
            </h2>
            {slots !== null ? (
              <span className="text-xs text-muted-foreground">{freeCount} free</span>
            ) : null}
          </div>
          {error !== null ? (
            <PageError error={error} />
          ) : slots === null ? (
            <PageLoading rows={4} />
          ) : days.length === 0 ? (
            <EmptyState
              title="No slots this week"
              hint="Open availability to let patients book you."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {days.map(([key, daySlots]) => (
                <li key={key} className="rounded-lg border p-3">
                  <p className="mb-2 text-sm font-medium">{formatDay(daySlots[0].starts_at)}</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {daySlots.map((slot) => (
                      <li key={slot.id}>
                        <Badge
                          variant={slot.is_free ? 'outline' : 'secondary'}
                          className={slot.is_free ? '' : 'line-through opacity-70'}
                          title={slot.is_free ? 'Free' : 'Booked'}
                        >
                          {formatTime(slot.starts_at)}
                          <span className="sr-only">{slot.is_free ? ' free' : ' booked'}</span>
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Open availability</CardTitle>
            <CardDescription>
              Repeat one daily window over several days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {doctor === null ? (
              error === null ? <PageLoading rows={2} /> : null
            ) : (
              <SlotWindowForm doctorId={doctor.id} onCreated={() => void loadSlots(doctor.id)} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
