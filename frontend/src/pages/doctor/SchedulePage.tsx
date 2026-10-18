import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { useOwnDoctorProfile } from '@/hooks/useOwnDoctorProfile'
import { request } from '@/lib/api'
import { dayKey, formatDay, formatTime } from '@/lib/format'
import type { SlotOut } from '@/lib/types'

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
  const { doctor, error: profileError } = useOwnDoctorProfile()
  const [slots, setSlots] = useState<SlotOut[] | null>(null)
  const [slotsError, setSlotsError] = useState<unknown>(null)
  const error = profileError ?? slotsError

  const loadSlots = useCallback(async (doctorId: number) => {
    try {
      setSlots(await request<SlotOut[]>(`/doctors/${doctorId}/slots`))
      setSlotsError(null)
    } catch (err) {
      setSlotsError(err)
    }
  }, [])

  useEffect(() => {
    if (doctor !== null) void loadSlots(doctor.id)
  }, [doctor, loadSlots])

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
              <span className="text-xs text-muted-foreground">
                {freeCount} free · booked slots are struck through
              </span>
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
                          variant="outline"
                          className={
                            slot.is_free
                              ? 'tabular border-primary/25 bg-primary/5 text-primary'
                              : 'tabular bg-muted text-muted-foreground line-through'
                          }
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
