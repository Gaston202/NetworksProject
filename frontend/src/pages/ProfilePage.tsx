import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthContext'
import { PageError, PageLoading } from '@/components/PageState'
import { RoleBadge } from '@/components/RoleBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useResource } from '@/hooks/useResource'
import { errorMessage, request } from '@/lib/api'
import type { PasswordChangeIn, ProfileOut, ProfileUpdateIn, Role } from '@/lib/types'

const MIN_PASSWORD_LENGTH = 8

/** Self-service account page for every role (PATCH /auth/me, POST /auth/me/password). */
export default function ProfilePage() {
  const profile = useResource<ProfileOut>('/auth/me/profile')

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
        <p className="text-sm text-muted-foreground">
          Email, role and department are managed by the hospital administration.
        </p>
      </div>

      {profile.error !== null ? (
        <PageError error={profile.error} />
      ) : profile.data === null ? (
        <PageLoading rows={4} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <DetailsCard profile={profile.data} onSaved={() => void profile.reload()} />
          <PasswordCard />
        </div>
      )}
    </div>
  )
}

function ReadOnlyRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}

function DetailsCard({ profile, onSaved }: { profile: ProfileOut; onSaved: () => void }) {
  const { refreshUser } = useAuth()
  const isPatient = profile.role === 'patient'
  const [fullName, setFullName] = useState(profile.full_name)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [address, setAddress] = useState(profile.address ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sync the form after a save (the reloaded profile is authoritative).
  useEffect(() => {
    setFullName(profile.full_name)
    setPhone(profile.phone ?? '')
    setAddress(profile.address ?? '')
  }, [profile])

  const dirty =
    fullName.trim() !== profile.full_name ||
    (isPatient && (phone.trim() !== (profile.phone ?? '') || address.trim() !== (profile.address ?? '')))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    // Send only what changed; empty contact fields clear the stored value.
    const body: ProfileUpdateIn = {}
    if (fullName.trim() !== profile.full_name) body.full_name = fullName.trim()
    if (isPatient && phone.trim() !== (profile.phone ?? '')) body.phone = phone.trim()
    if (isPatient && address.trim() !== (profile.address ?? '')) body.address = address.trim()
    setSaving(true)
    try {
      await request<ProfileOut>('/auth/me', { method: 'PATCH', body })
      await refreshUser()
      toast.success('Profile updated')
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal details</CardTitle>
        <CardDescription>How you appear to the care team.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3">
          <ReadOnlyRow label="Email" value={profile.email} />
          <ReadOnlyRow label="Role" value={<RoleBadge role={profile.role as Role} />} />
          {profile.department_name ? (
            <ReadOnlyRow
              label="Department"
              value={`${profile.department_name}${profile.specialty ? ` · ${profile.specialty}` : ''}`}
            />
          ) : null}
          {profile.date_of_birth ? (
            <ReadOnlyRow
              label="Date of birth"
              value={new Date(profile.date_of_birth).toLocaleDateString(undefined, {
                dateStyle: 'long',
              })}
            />
          ) : null}
          <ReadOnlyRow
            label="Member since"
            value={new Date(profile.created_at).toLocaleDateString(undefined, { dateStyle: 'long' })}
          />
        </dl>

        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-name">Full name</Label>
            <Input
              id="profile-name"
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>
          {isPatient ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="profile-phone">Phone</Label>
                <Input
                  id="profile-phone"
                  type="tel"
                  maxLength={32}
                  autoComplete="tel"
                  pattern="[0-9+()\-\s]*"
                  title="Digits, spaces, +, - and parentheses"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="profile-address">Address</Label>
                <Input
                  id="profile-address"
                  maxLength={200}
                  autoComplete="street-address"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
              </div>
            </>
          ) : null}
          {error !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="self-end" disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (next !== confirm) {
      setError('The new passwords do not match')
      return
    }
    setSaving(true)
    try {
      const body: PasswordChangeIn = { current_password: current, new_password: next }
      await request<void>('/auth/me/password', { method: 'POST', body })
      toast.success('Password changed')
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          Your current password is required. Use at least {MIN_PASSWORD_LENGTH} characters.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password-current">Current password</Label>
            <Input
              id="password-current"
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password-new">New password</Label>
            <Input
              id="password-new"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={128}
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password-confirm">Confirm new password</Label>
            <Input
              id="password-confirm"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={128}
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
          {error !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="self-end" disabled={saving}>
            {saving ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
