import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BookingWizard } from '@/components/BookingWizard'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { request } from '@/lib/api'
import type { AppointmentOut, PatientOut } from '@/lib/types'

/** Act 1's walk-in beat — the front desk books on behalf of a registered patient. */
export default function PatientsPage() {
  const [patients, setPatients] = useState<PatientOut[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [selected, setSelected] = useState<PatientOut | null>(null)

  const load = useCallback(async () => {
    try {
      setPatients(await request<PatientOut[]>('/admin/patients'))
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function handleBooked(appointment: AppointmentOut, patient: PatientOut) {
    toast.success(`Booked ${patient.full_name} for ${new Date(appointment.starts_at).toLocaleString()}`)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Patients &amp; walk-in booking</h1>
        <p className="text-sm text-muted-foreground">
          Select a patient, then book the same way a patient would.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <div>
          {error !== null ? (
            <PageError error={error} />
          ) : patients === null ? (
            <PageLoading rows={3} />
          ) : patients.length === 0 ? (
            <EmptyState title="No registered patients yet" />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Profile</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-right">Book</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patients.map((patient) => {
                    const isSelected = selected !== null && selected.id === patient.id
                    return (
                      <TableRow
                        key={patient.id}
                        aria-selected={isSelected}
                        className={isSelected ? 'bg-primary/10' : ''}
                      >
                        <TableCell>{patient.id}</TableCell>
                        <TableCell className="font-medium">{patient.full_name}</TableCell>
                        <TableCell className="text-muted-foreground">{patient.email}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={isSelected ? 'default' : 'outline'}
                            onClick={() => setSelected(patient)}
                          >
                            {isSelected ? 'Selected' : 'Book walk-in'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Walk-in booking</CardTitle>
            <CardDescription>
              {selected === null
                ? 'Pick a patient on the left first.'
                : `Booking on behalf of ${selected.full_name}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selected === null ? (
              <EmptyState title="No patient selected" hint="The front desk books for a specific patient." />
            ) : (
              <BookingWizard
                patientId={selected.id}
                patientName={selected.full_name}
                onBooked={(appointment) => handleBooked(appointment, selected)}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}