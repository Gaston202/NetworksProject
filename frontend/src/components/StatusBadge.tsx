import { Badge } from '@/components/ui/badge'
import type { AppointmentStatus, InvoiceStatus } from '@/lib/types'

const APPOINTMENT_STATUS: Record<
  AppointmentStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  booked: { label: 'Booked', variant: 'outline' },
  consulted: { label: 'Consulted', variant: 'secondary' },
  completed: { label: 'Completed', variant: 'default' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
}

const INVOICE_STATUS: Record<
  InvoiceStatus,
  { label: string; variant: 'default' | 'secondary' }
> = {
  unpaid: { label: 'Unpaid', variant: 'secondary' },
  paid: { label: 'Paid', variant: 'default' },
}

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  const meta = APPOINTMENT_STATUS[status]
  return <Badge variant={meta.variant}>{meta.label}</Badge>
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const meta = INVOICE_STATUS[status]
  return <Badge variant={meta.variant}>{meta.label}</Badge>
}