import type { Role } from './types'

/** Where each role lands after login; also the redirect target on role mismatch. */
export const HOME_PATH: Record<Role, string> = {
  patient: '/patient',
  doctor: '/doctor',
  admin: '/admin/users',
}