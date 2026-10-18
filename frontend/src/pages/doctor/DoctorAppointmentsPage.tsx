import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AppointmentStatusBadge, InvoiceStatusBadge } from '@/components/StatusBadge'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
import { SearchInput } from '@/components/SearchInput'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useTableFilter } from '@/hooks/useTableFilter'
import { errorMessage, request } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import type { AppointmentDetailOut, AppointmentOut } from '@/lib/types'

const whenFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

type QueueBucket = 'open' | 'completed' | 'cancelled'

/** booked + consulted are the visits still waiting on the doctor. */
const queueBucket = (appointment: AppointmentOut): QueueBucket =>
  appointment.status === 'completed'
    ? 'completed'
    : appointment.status === 'booked' || appointment.status === 'consulted'
      ? 'open'
      : 'cancelled'

const queueText = (appointment: AppointmentOut) => [appointment.patient_name]

/** Act 2 — the doctor's own queue; opening an appointment is the consultation
 * screen (write diagnosis → mark completed → invoice is returned). */
export default function DoctorAppointmentsPage() {
  const [appointments, setAppointments] = useState<AppointmentOut[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const { query, setQuery, statusFilter, setStatusFilter, filtered } = useTableFilter(
    appointments,
    { text: queueText, status: queueBucket, initialStatus: 'open' },
  )
  // Open visits read like a day planner (soonest first); history newest first.
  const rows =
    filtered === null
      ? null
      : statusFilter === 'open'
        ? [...filtered].reverse()
        : filtered

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">My queue</h1>
          <p className="text-sm text-muted-foreground">
            Write the consultation, then mark the visit complete — the invoice is
            derived automatically.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <SearchInput value={query} onChange={setQuery} label="Search patients" />
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as QueueBucket | 'all')}
          >
            <SelectTrigger className="w-36" aria-label="Filter visits">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open visits</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="all">All visits</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error !== null ? (
        <PageError error={error} />
      ) : rows === null ? (
        <PageLoading rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={query === '' ? 'Nothing in this view' : 'No patients match your search'}
          hint={
            statusFilter === 'open' && query === ''
              ? 'Patients book you through the scheduling flow.'
              : undefined
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((appointment) => (
                <TableRow key={appointment.id}>
                  <TableCell className="tabular">
                    {whenFormat.format(new Date(appointment.starts_at))}
                  </TableCell>
                  <TableCell className="font-medium">
                    {appointment.patient_name ?? `Patient #${appointment.patient_id}`}
                  </TableCell>
                  <TableCell>
                    <AppointmentStatusBadge status={appointment.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpenId(appointment.id)}>
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={openId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOpenId(null)
            void load() // reflect consultation/completion in the list
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          {openId !== null && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {appointments?.find((row) => row.id === openId)?.patient_name ??
                    `Appointment #${openId}`}
                </DialogTitle>
                <DialogDescription>
                  Visit #{openId} — consultation and completion.
                </DialogDescription>
              </DialogHeader>
              <AppointmentDetail id={openId} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AppointmentDetail({ id }: { id: number }) {
  const [detail, setDetail] = useState<AppointmentDetailOut | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)

  const [diagnosis, setDiagnosis] = useState('')
  const [notes, setNotes] = useState('')
  const [prescription, setPrescription] = useState('')

  const load = useCallback(async () => {
    try {
      const loaded = await request<AppointmentDetailOut>(`/appointments/${id}`)
      setDetail(loaded)
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSaveConsultation() {
    if (diagnosis.trim() === '') {
      toast.error('Diagnosis is required')
      return
    }
    setSaving(true)
    try {
      await request(`/appointments/${id}/consultation`, {
        method: 'POST',
        body: {
          diagnosis: diagnosis.trim(),
          notes: notes.trim() === '' ? undefined : notes.trim(),
          prescription: prescription.trim() === '' ? undefined : prescription.trim(),
        },
      })
      toast.success('Consultation saved')
      setDiagnosis('')
      setNotes('')
      setPrescription('')
      await load()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleComplete() {
    setCompleting(true)
    try {
      // The completion response carries the derived invoice (ADR-0012) — shown below.
      const completed = await request<AppointmentDetailOut>(`/appointments/${id}/complete`, {
        method: 'PATCH',
      })
      setDetail(completed)
      toast.success('Visit completed', {
        description:
          completed.invoice !== null
            ? `Invoice #${completed.invoice.id} — ${formatMoney(completed.invoice.total)}`
            : undefined,
      })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setCompleting(false)
    }
  }

  if (error !== null) return <PageError error={error} />
  if (detail === null) return <PageLoading rows={2} />

  const canWriteConsultation = detail.status === 'booked' && detail.consultation === null
  // Only pre-completion visits can be completed; cancelled/completed rows
  // fail the check by construction.
  const canComplete = detail.status === 'booked' || detail.status === 'consulted'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div>
          <p className="font-medium">{whenFormat.format(new Date(detail.starts_at))}</p>
          <p className="text-xs text-muted-foreground">
            {detail.patient_name ?? `Patient #${detail.patient_id}`} ·{' '}
            {detail.department_name ?? 'Visit'}
          </p>
        </div>
        <AppointmentStatusBadge status={detail.status} />
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold">Consultation</p>
        {detail.consultation !== null ? (
          <Card>
            <CardContent className="flex flex-col gap-2 py-4">
              <p className="font-medium">{detail.consultation.diagnosis}</p>
              {detail.consultation.notes !== null && (
                <p className="text-sm text-muted-foreground">{detail.consultation.notes}</p>
              )}
              {detail.consultation.prescription !== null && (
                <div className="rounded-md border bg-muted/40 px-3 py-2">
                  <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                    Prescription
                  </p>
                  <p className="font-mono text-sm">{detail.consultation.prescription}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : canWriteConsultation ? (
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="consultation-diagnosis">Diagnosis</Label>
              <Textarea
                id="consultation-diagnosis"
                required
                value={diagnosis}
                onChange={(event) => setDiagnosis(event.target.value)}
                placeholder="e.g. Seasonal flu, rest and hydration advised"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="consultation-notes">Notes (optional)</Label>
              <Textarea
                id="consultation-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="consultation-prescription">Prescription (free text, optional)</Label>
              <Textarea
                id="consultation-prescription"
                value={prescription}
                onChange={(event) => setPrescription(event.target.value)}
                placeholder="e.g. Paracetamol 500mg, 1 tablet every 8h for 5 days"
              />
            </div>
            <Button
              type="button"
              className="self-start"
              disabled={saving}
              onClick={() => void handleSaveConsultation()}
            >
              {saving ? 'Saving…' : 'Save consultation'}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Consultation not written yet — it opens while the appointment is booked.
          </p>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold">Invoice</p>
        {detail.invoice !== null ? (
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium">
                  Invoice #{detail.invoice.id} — {formatMoney(detail.invoice.total)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Derived on completion; payment is recorded by the front desk.
                </p>
              </div>
              <InvoiceStatusBadge status={detail.invoice.status} />
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">
            Created automatically when you mark the visit complete.
          </p>
        )}
        {canComplete && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Finish the visit</CardTitle>
              <CardDescription>
                Completing derives the invoice exactly once (same transaction).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                disabled={completing}
                onClick={() => void handleComplete()}
              >
                {completing ? 'Completing…' : 'Mark completed'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}