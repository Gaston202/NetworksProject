import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AppointmentStatusBadge } from '@/components/StatusBadge'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
import { SearchInput } from '@/components/SearchInput'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useTableFilter } from '@/hooks/useTableFilter'
import { errorMessage, request } from '@/lib/api'
import type { AppointmentOut } from '@/lib/types'

const whenFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

type VisitBucket = 'upcoming' | 'past' | 'cancelled'

const visitBucket = (appointment: AppointmentOut): VisitBucket =>
  appointment.status === 'cancelled'
    ? 'cancelled'
    : new Date(appointment.starts_at) > new Date()
      ? 'upcoming'
      : 'past'

const visitText = (appointment: AppointmentOut) => [
  appointment.doctor_name,
  appointment.department_name,
]

/** Act 1/3 — role-scoped list (the backend returns only this patient's rows). */
export default function MyAppointmentsPage() {
  const [appointments, setAppointments] = useState<AppointmentOut[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [cancelTarget, setCancelTarget] = useState<AppointmentOut | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const { query, setQuery, statusFilter, setStatusFilter, filtered } = useTableFilter(
    appointments,
    { text: visitText, status: visitBucket },
  )

  const load = useCallback(async () => {
    try {
      const list = await request<AppointmentOut[]>('/appointments')
      setAppointments(list)
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCancel() {
    if (cancelTarget === null) return
    setCancelling(true)
    try {
      await request<AppointmentOut>(`/appointments/${cancelTarget.id}/cancel`, {
        method: 'PATCH',
      })
      toast.success('Appointment cancelled — the slot is free again')
      setCancelTarget(null)
      await load()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">My appointments</h1>
          <p className="text-sm text-muted-foreground">
            Only your own visits are listed — the backend scopes this list to your account.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <SearchInput
            value={query}
            onChange={setQuery}
            label="Search appointments"
            placeholder="Doctor or department"
          />
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as VisitBucket | 'all')}
          >
            <SelectTrigger className="w-36" aria-label="Filter appointments">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All visits</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="past">Past</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error !== null ? (
        <PageError error={error} />
      ) : filtered === null ? (
        <PageLoading rows={3} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={appointments?.length === 0 ? 'No appointments yet' : 'Nothing matches this view'}
          hint={
            appointments?.length === 0
              ? 'Book your first visit from the Book appointment page.'
              : undefined
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((appointment) => (
                <TableRow key={appointment.id}>
                  <TableCell>{whenFormat.format(new Date(appointment.starts_at))}</TableCell>
                  <TableCell>
                    <p className="font-medium">{appointment.doctor_name ?? 'Doctor'}</p>
                    <p className="text-xs text-muted-foreground">
                      {appointment.department_name ?? ''}
                    </p>
                  </TableCell>
                  <TableCell>
                    <AppointmentStatusBadge status={appointment.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {appointment.status === 'booked' && visitBucket(appointment) === 'upcoming' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCancelTarget(appointment)}
                      >
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel this appointment?</DialogTitle>
            <DialogDescription>
              {cancelTarget === null
                ? ''
                : `${whenFormat.format(new Date(cancelTarget.starts_at))} — the slot becomes bookable again.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={cancelling}
              onClick={() => void handleCancel()}
            >
              {cancelling ? 'Cancelling…' : 'Cancel appointment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}