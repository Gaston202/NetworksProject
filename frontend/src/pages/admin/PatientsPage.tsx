import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BookingWizard } from '@/components/BookingWizard'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
import { SearchInput } from '@/components/SearchInput'
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
import { useTableFilter } from '@/hooks/useTableFilter'
import { request } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { AppointmentOut, PatientOut } from '@/lib/types'

const patientText = (patient: PatientOut) => [patient.full_name, patient.email, patient.phone]

function ageOf(dateOfBirth: string | null): string {
  if (dateOfBirth === null) return '—'
  const born = new Date(dateOfBirth)
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  const beforeBirthday =
    now.getMonth() < born.getMonth() ||
    (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())
  if (beforeBirthday) age -= 1
  return String(age)
}

/** Act 1's walk-in beat — the front desk books on behalf of a registered patient. */
export default function PatientsPage() {
  const [patients, setPatients] = useState<PatientOut[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [selected, setSelected] = useState<PatientOut | null>(null)
  const { query, setQuery, filtered } = useTableFilter(patients, { text: patientText })

  const load = useCallback(async () => {
    try {
      setPatients(await request<PatientOut[]>('/patients'))
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function handleBooked(appointment: AppointmentOut, patient: PatientOut) {
    toast.success(`Booked ${patient.full_name} — ${formatDateTime(appointment.starts_at)}`)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Patients &amp; walk-in booking</h1>
          <p className="text-sm text-muted-foreground">
            Select a patient, then book the same way a patient would.
          </p>
        </div>
        <SearchInput
          value={query}
          onChange={setQuery}
          label="Search patients"
          placeholder="Name, email or phone"
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <div>
          {error !== null ? (
            <PageError error={error} />
          ) : filtered === null ? (
            <PageLoading rows={3} />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={query === '' ? 'No registered patients yet' : 'No patients match your search'}
            />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead className="hidden xl:table-cell">Phone</TableHead>
                    <TableHead className="hidden sm:table-cell">Age</TableHead>
                    <TableHead className="text-right">Book</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((patient) => {
                    const isSelected = selected !== null && selected.id === patient.id
                    return (
                      <TableRow
                        key={patient.id}
                        aria-selected={isSelected}
                        className={isSelected ? 'bg-primary/10' : ''}
                      >
                        <TableCell>
                          <p className="font-medium">{patient.full_name}</p>
                          <p className="text-xs text-muted-foreground">{patient.email}</p>
                        </TableCell>
                        <TableCell className="tabular hidden text-muted-foreground xl:table-cell">
                          {patient.phone ?? '—'}
                        </TableCell>
                        <TableCell className="tabular hidden sm:table-cell">
                          {ageOf(patient.date_of_birth)}
                        </TableCell>
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