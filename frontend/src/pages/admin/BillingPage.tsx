import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { InvoiceStatusBadge } from '@/components/StatusBadge'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
import { Button } from '@/components/ui/button'
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
import { errorMessage, request } from '@/lib/api'
import type { InvoiceOut } from '@/lib/types'

const whenFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** Act 3 — all invoices; the admin records payment (unpaid → paid, one way). */
export default function BillingPage() {
  const [invoices, setInvoices] = useState<InvoiceOut[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [payingId, setPayingId] = useState<number | null>(null)

  const load = useCallback(async (filter: string) => {
    try {
      const list = await request<InvoiceOut[]>('/invoices', {
        query: { status: filter === 'all' ? undefined : filter },
      })
      setInvoices(list)
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    void load(statusFilter)
  }, [load, statusFilter])

  async function handleMarkPaid(invoice: InvoiceOut) {
    setPayingId(invoice.id)
    try {
      await request<InvoiceOut>(`/invoices/${invoice.id}/paid`, { method: 'PATCH' })
      toast.success(`Invoice #${invoice.id} marked paid`)
      await load(statusFilter)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setPayingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">
            Invoices are derived from completed visits — this screen records payment.
          </p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All invoices</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error !== null ? (
        <PageError error={error} />
      ) : invoices === null ? (
        <PageLoading rows={3} />
      ) : invoices.length === 0 ? (
        <EmptyState
          title="No invoices"
          hint="They appear automatically once visits are completed."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Visit</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    #{invoice.id} · {whenFormat.format(new Date(invoice.created_at))}
                  </TableCell>
                  <TableCell>#{invoice.appointment_id}</TableCell>
                  <TableCell className="font-medium">${invoice.total.toFixed(2)}</TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={invoice.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {invoice.status === 'unpaid' && (
                      <Button
                        size="sm"
                        disabled={payingId === invoice.id}
                        onClick={() => void handleMarkPaid(invoice)}
                      >
                        {payingId === invoice.id ? 'Marking…' : 'Mark paid'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}