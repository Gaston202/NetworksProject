import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { InvoiceStatusBadge } from '@/components/StatusBadge'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
import { SearchInput } from '@/components/SearchInput'
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
import { useTableFilter } from '@/hooks/useTableFilter'
import { errorMessage, request } from '@/lib/api'
import { formatDateTime, formatMoney } from '@/lib/format'
import type { InvoiceOut } from '@/lib/types'

const whenFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const invoiceText = (invoice: InvoiceOut) => [
  `#${invoice.id}`,
  invoice.patient_name,
  invoice.doctor_name,
  invoice.department_name,
]

/** Act 3 — all invoices; the admin records payment (unpaid → paid, one way). */
export default function BillingPage() {
  const [invoices, setInvoices] = useState<InvoiceOut[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [payingId, setPayingId] = useState<number | null>(null)
  const { query, setQuery, filtered } = useTableFilter(invoices, { text: invoiceText })
  const outstanding = (invoices ?? []).filter((invoice) => invoice.status === 'unpaid')

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
      toast.success(
        `Invoice #${invoice.id} marked paid${invoice.patient_name ? ` — ${invoice.patient_name}` : ''}`,
      )
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
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <SearchInput
            value={query}
            onChange={setQuery}
            label="Search invoices"
            placeholder="Patient, doctor, #invoice"
          />
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
      </div>

      {invoices !== null && statusFilter !== 'paid' && outstanding.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          <span className="tabular font-medium text-foreground">
            {formatMoney(outstanding.reduce((sum, invoice) => sum + invoice.total, 0))}
          </span>{' '}
          outstanding across {outstanding.length} unpaid invoice
          {outstanding.length === 1 ? '' : 's'}.
        </p>
      ) : null}

      {error !== null ? (
        <PageError error={error} />
      ) : filtered === null ? (
        <PageLoading rows={3} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query === '' ? 'No invoices' : 'No invoices match your search'}
          hint={query === '' ? 'They appear automatically once visits are completed.' : undefined}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead className="hidden md:table-cell">Visit</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <p className="tabular font-medium">#{invoice.id}</p>
                    <p className="text-xs text-muted-foreground">
                      {whenFormat.format(new Date(invoice.created_at))}
                    </p>
                  </TableCell>
                  <TableCell className="font-medium">{invoice.patient_name ?? '—'}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <p>{invoice.doctor_name ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">
                      {invoice.department_name ?? ''}
                      {invoice.visit_starts_at ? ` · ${formatDateTime(invoice.visit_starts_at)}` : ''}
                    </p>
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {formatMoney(invoice.total)}
                  </TableCell>
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