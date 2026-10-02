/** DTOs mirroring backend/app/schemas.py response shapes (snake_case kept). */

export type Role = 'admin' | 'doctor' | 'patient'
export type AppointmentStatus = 'booked' | 'consulted' | 'completed' | 'cancelled'
export type InvoiceStatus = 'unpaid' | 'paid'

// --- Auth ---

export interface TokenOut {
  access_token: string
  role: Role
  full_name: string
}

export interface UserOut {
  id: number
  full_name: string
  email: string
  role: Role
  created_at: string
}

export interface RegisterIn {
  full_name: string
  email: string
  password: string
  date_of_birth?: string
  phone?: string
  address?: string
}

export interface StaffCreateIn {
  full_name: string
  email: string
  password: string
  role: 'admin' | 'doctor'
  department_id?: number
  specialty?: string
}

export interface UserUpdateIn {
  full_name?: string
  department_id?: number
  specialty?: string
  is_active?: boolean
}

// --- Scheduling ---

export interface DepartmentOut {
  id: number
  name: string
}

export interface DoctorOut {
  /** `id` is the doctor_profile id (slot/appointment paths use it). */
  id: number
  full_name: string
  email: string
  department_id: number | null
  department_name: string | null
  specialty: string | null
}

export interface SlotOut {
  id: number
  doctor_id: number
  starts_at: string
  ends_at: string
  is_free: boolean
}

export interface AppointmentOut {
  id: number
  slot_id: number
  /** patient _profile_ id (walk-in booking targets it) */
  patient_id: number
  doctor_id: number
  status: AppointmentStatus
  starts_at: string
  ends_at: string
  created_at: string
}

export interface AppointmentDetailOut extends AppointmentOut {
  consultation: ConsultationOut | null
  invoice: InvoiceOut | null
}

/** Admin-only: patients directory (walk-in booking) */
export interface PatientOut {
  id: number
  full_name: string
  email: string
  phone: string | null
  date_of_birth: string | null
}

// --- Clinical ---

export interface ConsultationOut {
  id: number
  appointment_id: number
  diagnosis: string
  notes: string | null
  prescription: string | null
  created_at: string
}

export interface ConsultationCreateIn {
  diagnosis: string
  notes?: string
  prescription?: string
}

// --- Billing ---

export interface InvoiceOut {
  id: number
  appointment_id: number
  total: number
  status: InvoiceStatus
  created_at: string
}