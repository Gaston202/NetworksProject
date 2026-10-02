import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AppointmentStatusBadge } from '@/components/StatusBadge'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

/** Act 1/3 — role-scoped list (the backend returns only this patient's rows). */
export default function MyAppointmentsPage() {
  const [appointments, setAppointments] = useState<AppointmentOut[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [cancelTarget, setCancelTarget] = useState<AppointmentOut | null>(null)
  const [cancelling, setCancelling] = useState(false)

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
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">My appointments</h1>
        <p className="text-sm text-muted-foreground">
          Only your own visits are listed — the backend scopes this list to your account.
        </p>
      </div>

      {error !== null ? (
        <PageError error={error} />
      ) : appointments === null ? (
        <PageLoading rows={3} />
      ) : appointments.length === 0 ? (
        <EmptyState
          title="No appointments yet"
          hint="Book your first visit from the Book appointment page."
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
              {appointments.map((appointment) => (
                <TableRow key={appointment.id}>
                  <TableCell>{whenFormat.format(new Date(appointment.starts_at))}</TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">
                      Dr. (profile #{appointment.doctor_id})
                    </span>
                  </TableCell>
                  <TableCell>
                    <AppointmentStatusBadge status={appointment.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {appointment.status === 'booked' && (
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