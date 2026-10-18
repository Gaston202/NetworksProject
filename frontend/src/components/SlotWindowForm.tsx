import { useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { errorMessage, request } from '@/lib/api'
import { todayInputValue } from '@/lib/format'
import {
  SLOT_LENGTH_OPTIONS,
  SLOT_LIMITS,
  countSlots,
  slotsPerDay,
  toSlotBulkIn,
  validateSlotWindow,
} from '@/lib/slots'
import type { SlotWindowValues } from '@/lib/slots'
import type { SlotOut } from '@/lib/types'

const DEFAULT_VALUES: Omit<SlotWindowValues, 'firstDate'> = {
  days: 5,
  startTime: '09:00',
  hoursPerDay: 3,
  slotMinutes: 30,
}

interface SlotWindowFormProps {
  /** doctor_profile id — the path parameter of POST /doctors/{id}/slots */
  doctorId: number
  /** Called with the created slots after a 201. */
  onCreated?: (slots: SlotOut[]) => void
  /** Optional secondary action (e.g. close a dialog). */
  onCancel?: () => void
}

/**
 * "Open availability" form (ADR-0009 bulk windows): one daily window repeated
 * over N days, split into fixed-length slots. Shared by the doctor's schedule
 * page and the admin's per-doctor dialog (Act 4).
 */
export function SlotWindowForm({ doctorId, onCreated, onCancel }: SlotWindowFormProps) {
  const [values, setValues] = useState<SlotWindowValues>({
    firstDate: todayInputValue(),
    ...DEFAULT_VALUES,
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const total = countSlots(values)

  function update<K extends keyof SlotWindowValues>(key: K, value: SlotWindowValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const invalid = validateSlotWindow(values)
    if (invalid !== null) {
      setError(invalid)
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const created = await request<SlotOut[]>(`/doctors/${doctorId}/slots`, {
        method: 'POST',
        body: toSlotBulkIn(values),
      })
      toast.success(`Opened ${created.length} slot${created.length === 1 ? '' : 's'}`)
      onCreated?.(created)
    } catch (err) {
      // 409 carries the first overlapping range verbatim — nothing was created.
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="slot-first-date">First day</Label>
          <Input
            id="slot-first-date"
            type="date"
            required
            min={todayInputValue()}
            value={values.firstDate}
            onChange={(event) => update('firstDate', event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="slot-days">Number of days</Label>
          <Input
            id="slot-days"
            type="number"
            required
            min={1}
            max={SLOT_LIMITS.maxDays}
            value={values.days}
            onChange={(event) => update('days', Number(event.target.value))}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="slot-start">Starts at</Label>
          <Input
            id="slot-start"
            type="time"
            required
            step={300}
            value={values.startTime}
            onChange={(event) => update('startTime', event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="slot-hours">Hours per day</Label>
          <Input
            id="slot-hours"
            type="number"
            required
            min={0.5}
            max={SLOT_LIMITS.maxHoursPerDay}
            step={0.5}
            value={values.hoursPerDay}
            onChange={(event) => update('hoursPerDay', Number(event.target.value))}
          />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label id="slot-length-label">Slot length</Label>
          <Select
            value={String(values.slotMinutes)}
            onValueChange={(value) => update('slotMinutes', Number(value))}
          >
            <SelectTrigger className="w-full" aria-labelledby="slot-length-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SLOT_LENGTH_OPTIONS.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {minutes} minutes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        Creates <span className="font-semibold text-foreground">{total}</span> slot
        {total === 1 ? '' : 's'} ({slotsPerDay(values)} per
        day). Overlapping an existing slot cancels the whole batch.
      </p>

      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={submitting || total === 0}>
          {submitting ? 'Opening…' : 'Open availability'}
        </Button>
      </div>
    </form>
  )
}
