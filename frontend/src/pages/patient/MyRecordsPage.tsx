import { useCallback, useEffect, useState } from 'react'
import { InvoiceStatusBadge } from '@/components/StatusBadge'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { request } from '@/lib/api'
import type { ConsultationOut, InvoiceOut } from '@/lib/types'

const whenFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** Act 3 — the patient's timeline of consultations and invoices (own rows only). */
export default function MyRecordsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">My records</h1>
        <p className="text-sm text-muted-foreground">
          Your consultation history and invoices.
        </p>
      </div>
      <Tabs defaultValue="consultations">
        <TabsList>
          <TabsTrigger value="consultations">Consultations</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>
        <TabsContent value="consultations">
          <ConsultationsTab />
        </TabsContent>
        <TabsContent value="invoices">
          <InvoicesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ConsultationsTab() {
  const [consultations, setConsultations] = useState<ConsultationOut[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    try {
      setConsultations(await request<ConsultationOut[]>('/consultations'))
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (error !== null) return <PageError error={error} />
  if (consultations === null) {
    return <PageLoading rows={2} />
  }
  if (consultations.length === 0) {
    return (
      <EmptyState
        title="No consultations yet"
        hint="They appear here after a visit is closed by the doctor."
      />
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {consultations.map((consultation) => (
        <Card key={consultation.id}>
          <CardContent className="flex flex-col gap-2 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{consultation.diagnosis}</p>
              <p className="shrink-0 text-xs text-muted-foreground">
                #{consultation.appointment_id} · {whenFormat.format(new Date(consultation.created_at))}
              </p>
            </div>
            {consultation.notes !== null && (
              <p className="text-sm text-muted-foreground">{consultation.notes}</p>
            )}
            {consultation.prescription !== null && (
              <div className="rounded-md border bg-muted/40 px-3 py-2">
                <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  Prescription
                </p>
                <p className="font-mono text-sm">{consultation.prescription}</p>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function InvoicesTab() {
  const [invoices, setInvoices] = useState<InvoiceOut[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    try {
      setInvoices(await request<InvoiceOut[]>('/invoices'))
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (error !== null) return <PageError error={error} />
  if (invoices === null) {
    return <PageLoading rows={2} />
  }
  if (invoices.length === 0) {
    return (
      <EmptyState
        title="No invoices yet"
        hint="Invoices are created automatically when a visit is completed."
      />
    )
  }
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead>Visit</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => (
            <TableRow key={invoice.id}>
              <TableCell>
                #{invoice.id} · {whenFormat.format(new Date(invoice.created_at))}
              </TableCell>
              <TableCell>#{invoice.appointment_id}</TableCell>
              <TableCell>${invoice.total.toFixed(2)}</TableCell>
              <TableCell>
                <InvoiceStatusBadge status={invoice.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}