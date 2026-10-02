import { BookingWizard } from '@/components/BookingWizard'
import { useAuth } from '@/auth/AuthContext'

/** Act 1 — the patient books their own appointment. */
export default function BookPage() {
  const { user } = useAuth()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Book an appointment</h1>
        <p className="text-sm text-muted-foreground">
          Hi{user === null ? '' : `, ${user.full_name}`} — once booked, the slot
          leaves the list for everyone else.
        </p>
      </div>
      <BookingWizard />
    </div>
  )
}