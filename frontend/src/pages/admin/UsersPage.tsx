import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
import { RoleBadge } from '@/components/RoleBadge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import type { DepartmentOut, Role, UserOut, UserUpdateIn } from '@/lib/types'

const ROLES: Role[] = ['admin', 'doctor', 'patient']

/** Act 4 — user directory, staff account creation, doctor assignment. */
export default function UsersPage() {
  const [users, setUsers] = useState<UserOut[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [departments, setDepartments] = useState<DepartmentOut[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<UserOut | null>(null)

  const load = useCallback(
    async (filter: string) => {
      try {
        const list = await request<UserOut[]>('/admin/users', {
          query: {
            role: filter === 'all' ? undefined : filter,
          },
        })
        setUsers(list)
        setError(null)
      } catch (err) {
        setError(err)
      }
    },
    [],
  )

  useEffect(() => {
    void load(roleFilter)
  }, [load, roleFilter])

  useEffect(() => {
    // Departments are needed for the doctor pickers in both dialogs.
    request<DepartmentOut[]>('/departments')
      .then(setDepartments)
      .catch(() => {
        // The dialogs show a loadable-empty department list; the main list is unaffected.
      })
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Directory of all accounts; staff accounts are created here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-36" aria-label="Filter by role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setCreateOpen(true)}>New staff account</Button>
        </div>
      </div>

      {error !== null ? (
        <PageError error={error} />
      ) : users === null ? (
        <PageLoading rows={3} />
      ) : users.length === 0 ? (
        <EmptyState title="No users match this filter" />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.id}</TableCell>
                  <TableCell className="font-medium">{user.full_name}</TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    <RoleBadge role={user.role} />
                  </TableCell>
                  <TableCell className="text-right">
                    {user.role !== 'patient' && (
                      <Button size="sm" variant="outline" onClick={() => setEditing(user)}>
                        Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateStaffDialog
        open={createOpen}
        departments={departments}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void load(roleFilter)}
      />

      {editing !== null && (
        <EditUserDialog
          user={editing}
          departments={departments}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load(roleFilter)
          }}
        />
      )}
    </div>
  )
}

function CreateStaffDialog({
  open,
  departments,
  onClose,
  onCreated,
}: {
  open: boolean
  departments: DepartmentOut[]
  onClose: () => void
  onCreated: () => void
}) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<string>('doctor')
  const [departmentId, setDepartmentId] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setFullName('')
    setEmail('')
    setPassword('')
    setRole('doctor')
    setDepartmentId('')
    setSpecialty('')
    setError(null)
  }

  async function handleSubmit(event: { preventDefault(): void }) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const payload: {
        full_name: string
        email: string
        password: string
        role: 'admin' | 'doctor'
        department_id?: number
        specialty?: string
      } = {
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        role: role === 'admin' ? 'admin' : 'doctor',
      }
      if (payload.role === 'doctor') {
        if (departmentId === '') {
          setError('Pick a department for this doctor')
          setSubmitting(false)
          return
        }
        payload.department_id = Number(departmentId)
        if (specialty.trim() !== '') payload.specialty = specialty.trim()
      }
      await request<UserOut>('/auth/staff', { method: 'POST', body: payload })
      toast.success(`${payload.role === 'admin' ? 'Admin' : 'Doctor'} account created`)
      reset()
      onCreated()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New staff account</DialogTitle>
          <DialogDescription>
            Admin and doctor accounts; patients register themselves.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-name">Full name</Label>
            <Input
              id="staff-name"
              required
              minLength={2}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-email">Email</Label>
            <Input
              id="staff-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-password">Temporary password</Label>
            <Input
              id="staff-password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="doctor">Doctor</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {role === 'doctor' && (
            <>
              <div className="flex flex-col gap-2">
                <Label>Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={departments.length === 0 ? 'No departments yet' : 'Select department'} />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((department) => (
                      <SelectItem key={department.id} value={String(department.id)}>
                        {department.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="staff-specialty">Specialty (optional)</Label>
                <Input
                  id="staff-specialty"
                  value={specialty}
                  onChange={(event) => setSpecialty(event.target.value)}
                  placeholder="e.g. Interventional cardiology"
                />
              </div>
            </>
          )}
          {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditUserDialog({
  user,
  departments,
  onClose,
  onSaved,
}: {
  user: UserOut
  departments: DepartmentOut[]
  onClose: () => void
  onSaved: () => void
}) {
  const [fullName, setFullName] = useState(user.full_name)
  const [departmentId, setDepartmentId] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [activeChoice, setActiveChoice] = useState('keep')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isDoctor = user.role === 'doctor'

  async function handleSubmit(event: { preventDefault(): void }) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      // Note: the directory response doesn't expose is_active per user
      // (UserOut doesn't include it), so the picker is explicit no-op/activate/deactivate.
      const body: UserUpdateIn = {}
      const name = fullName.trim()
      if (name !== user.full_name && name.length >= 2) body.full_name = name
      if (activeChoice !== 'keep') body.is_active = activeChoice === 'activate'
      if (isDoctor) {
        if (departmentId !== '') body.department_id = Number(departmentId)
        if (specialty.trim() !== '') body.specialty = specialty.trim()
      }
      const updated = await request<UserOut>(`/admin/users/${user.id}`, {
        method: 'PATCH',
        body,
      })
      toast.success(`Updated ${updated.full_name}`)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {user.full_name}</DialogTitle>
          <DialogDescription>
            {isDoctor
              ? 'Move the doctor between departments or update their specialty.'
              : 'Rename the account or (de)activate it.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-name">Full name</Label>
            <Input
              id="edit-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>
          {isDoctor && (
            <>
              <div className="flex flex-col gap-2">
                <Label>Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Keep current department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((department) => (
                      <SelectItem key={department.id} value={String(department.id)}>
                        {department.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-specialty">Specialty</Label>
                <Input
                  id="edit-specialty"
                  value={specialty}
                  onChange={(event) => setSpecialty(event.target.value)}
                  placeholder="Keep current specialty"
                />
              </div>
            </>
          )}
          <div className="flex flex-col gap-2">
            <Label>Account status</Label>
            <Select value={activeChoice} onValueChange={setActiveChoice}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">Keep current</SelectItem>
                <SelectItem value="activate">Activate</SelectItem>
                <SelectItem value="deactivate">Deactivate</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}