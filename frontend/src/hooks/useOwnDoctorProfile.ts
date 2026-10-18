import { useEffect, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { request } from '@/lib/api'
import type { DoctorOut } from '@/lib/types'

/**
 * The signed-in doctor's directory entry. The doctor_profile id (needed for
 * slot paths) is only exposed by GET /doctors; emails are unique, so match on it.
 */
export function useOwnDoctorProfile() {
  const { user } = useAuth()
  const [doctor, setDoctor] = useState<DoctorOut | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (user === null) return
    request<DoctorOut[]>('/doctors')
      .then((doctors) => {
        const own = doctors.find((candidate) => candidate.email === user.email)
        if (own === undefined) throw new Error('No doctor profile is linked to this account')
        setDoctor(own)
      })
      .catch(setError)
  }, [user])

  return { doctor, error }
}
