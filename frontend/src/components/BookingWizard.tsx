import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PageError, PageLoading, EmptyState } from '@/components/PageState'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { errorMessage, request } from '@/lib/api'
import type {
  AppointmentOut,
  DepartmentOut,
  DoctorOut,
  SlotOut,
} from '@/lib/types'

/** "YYYY-MM-DD" group key. The API has no date filter on slots
 * (only `?free=true`), so the wizard groups all free slots by day. */
function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

interface BookingWizardProps {
  /** Walk-in mode: the admin books on behalf of this patient profile id. */
  patientId?: number
  patientName?: string
  /** Called after a successful booking (parents refresh their lists). */
  onBooked?: (appointment: AppointmentOut) => void
}

/**
 * Department → doctor → free-slot picker shared by the patient booking page
 * and the admin walk-in flow (Act 1). After booking the slot list is
 * refetched, so the booked slot disappears from the picker.
 */
export function BookingWizard({ patientId, patientName, onBooked }: BookingWizardProps) {
  const [departments, setDepartments] = useState<DepartmentOut[] | null>(null)
  const [departmentsError, setDepartmentsError] = useState<unknown>(null)
  const [departmentId, setDepartmentId] = useState('')

  const [doctors, setDoctors] = useState<DoctorOut[] | null>(null)
  const [doctorsError, setDoctorsError] = useState<unknown>(null)
  const [doctorId, setDoctorId] = useState('')

  const [slots, setSlots] = useState<SlotOut[] | null>(null)
  const [slotsError, setSlotsError] = useState<unknown>(null)
  const [loadingSlots, setLoadingSlots] = useState(false)

  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null)
  const [booking, setBooking] = useState(false)

  const reloadSlots = useCallback(async (id: string) => {
    if (id === '') {
      setSlots(null)
      setSlotsError(null)
      return
    }
    setLoadingSlots(true)
    try {
      const free = await request<SlotOut[]>(`/doctors/${id}/slots`, {
        query: { free: true },
      })
      setSlots(free)
      setSlotsError(null)
    } catch (error) {
      setSlotsError(error)
      setSlots(null)
    } finally {
      setLoadingSlots(false)
    }
  }, [])

  useEffect(() => {
    void reloadSlots(doctorId)
  }, [doctorId, reloadSlots])

  useEffect(() => {
    request<DepartmentOut[]>('/departments')
      .then((list) => {
        setDepartments(list)
        setDepartmentsError(null)
      })
      .catch(setDepartmentsError)
  }, [])

  useEffect(() => {
    if (departmentId === '') {
      setDoctors(null)
      setDoctorId('')
      return
    }
    setDoctorId('')
    request<DoctorOut[]>('/doctors', { query: { department_id: departmentId } })
      .then((list) => {
        setDoctors(list)
        setDoctorsError(null)
      })
      .catch((error) => {
        setDoctorsError(error)
        setDoctors(null)
      })
  }, [departmentId])

  const grouped = useMemo(() => {
    const groups = new Map<string, SlotOut[]>()
    for (const slot of slots ?? []) {
      const key = dayKey(slot.starts_at)
      const list = groups.get(key)
      if (list === undefined) groups.set(key, [slot])
      else list.push(slot)
    }
    return [...groups.entries()]
  }, [slots])

  async function handleBook() {
    if (selectedSlotId === null) return
    setBooking(true)
    try {
      const body: { slot_id: number; patient_id?: number } = {
        slot_id: selectedSlotId,
      }
      if (patientId !== undefined) body.patient_id = patientId
      const appointment = await request<AppointmentOut>('/appointments', {
        method: 'POST',
        body,
      })
      toast.success('Appointment booked', {
        description: new Date(appointment.starts_at).toLocaleString(),
      })
      onBooked?.(appointment)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      // Refresh in both paths: the booked slot (or one just raced away on a
      // 409 "slot taken") must vanish from the picker.
      setSelectedSlotId(null)
      await reloadSlots(doctorId)
      setBooking(false)
    }
  }

  const selectedSlot = slots?.find((slot) => slot.id === selectedSlotId)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Choose a visit</CardTitle>
          <CardDescription>
            {patientName !== undefined
              ? `Booking for ${patientName} — pick a department, then a doctor, then a slot.`
              : 'Pick a department, then a doctor, then a free slot.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="booking-department">Department</Label>
            {departmentsError !== null ? (
              <PageError error={departmentsError} />
            ) : (
              <Select
                value={departmentId}
                onValueChange={setDepartmentId}
                disabled={departments === null}
              >
                <SelectTrigger className="w-full" id="booking-department">
                  <SelectValue
                    placeholder={departments === null ? 'Loading…' : 'Select department'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(departments ?? []).map((department) => (
                    <SelectItem key={department.id} value={String(department.id)}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="booking-doctor">Doctor</Label>
            {doctorsError !== null ? (
              <PageError error={doctorsError} />
            ) : (
              <Select
                value={doctorId}
                onValueChange={setDoctorId}
                disabled={departmentId === '' || doctors === null}
              >
                <SelectTrigger className="w-full" id="booking-doctor">
                  <SelectValue
                    placeholder={
                      departmentId === ''
                        ? 'Select a department first'
                        : doctors === null
                          ? 'Loading…'
                          : (doctors.length ?? 0) === 0
                            ? 'No doctors in this department'
                            : 'Select doctor'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(doctors ?? []).map((doctor) => (
                    <SelectItem key={doctor.id} value={String(doctor.id)}>
                      {doctor.full_name}
                      {doctor.specialty !== null ? ` — ${doctor.specialty}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Free slots</CardTitle>
          <CardDescription>Times shown in your local timezone.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {doctorId === '' ? (
            <EmptyState
              title="No doctor selected"
              hint="Pick a department and a doctor to see availability."
            />
          ) : slotsError !== null ? (
            <PageError error={slotsError} />
          ) : loadingSlots || slots === null ? (
            <PageLoading rows={2} />
          ) : slots.length === 0 ? (
            <EmptyState
              title="No free slots for this doctor"
              hint="Try another doctor, or ask the front desk about walk-in availability."
            />
          ) : (
            grouped.map(([date, daySlots]) => (
              <div key={date} className="flex flex-col gap-2">
                <p className="text-sm font-medium">{formatDay(daySlots[0].starts_at)}</p>
                <div className="flex flex-wrap gap-2">
                  {daySlots.map((slot) => {
                    const selected = slot.id === selectedSlotId
                    return (
                      <Button
                        key={slot.id}
                        type="button"
                        size="sm"
                        variant={selected ? 'default' : 'outline'}
                        aria-pressed={selected}
                        onClick={() => setSelectedSlotId(selected ? null : slot.id)}
                      >
                        {formatTime(slot.starts_at)}
                      </Button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
          <Button
            type="button"
            className="self-start"
            disabled={selectedSlotId === null || booking}
            onClick={() => void handleBook()}
          >
            {booking
              ? 'Booking…'
              : selectedSlot !== undefined
                ? `Book ${formatTime(selectedSlot.starts_at)}`
                : 'Book appointment'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}