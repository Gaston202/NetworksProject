import { Badge } from '@/components/ui/badge'
import type { AppointmentStatus, InvoiceStatus } from '@/lib/types'

/** Soft tinted pills; color is never the only signal (label always shown). */
const TONE = {
  info: 'border-primary/25 bg-primary/10 text-primary',
  progress: 'border-chart-4/30 bg-chart-4/10 text-chart-4',
  success: 'border-success/25 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/15 text-warning-foreground',
  danger: 'border-destructive/25 bg-destructive/10 text-destructive',
} as const

const APPOINTMENT_STATUS: Record<AppointmentStatus, { label: string; tone: keyof typeof TONE }> = {
  booked: { label: 'Booked', tone: 'info' },
  consulted: { label: 'Consulted', tone: 'progress' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
}

const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: keyof typeof TONE }> = {
  unpaid: { label: 'Unpaid', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
}

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  const meta = APPOINTMENT_STATUS[status]
  return (
    <Badge variant="outline" className={TONE[meta.tone]}>
      {meta.label}
    </Badge>
  )
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const meta = INVOICE_STATUS[status]
  return (
    <Badge variant="outline" className={TONE[meta.tone]}>
      {meta.label}
    </Badge>
  )
}
