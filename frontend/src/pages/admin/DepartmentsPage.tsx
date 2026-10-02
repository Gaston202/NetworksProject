import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, PageError, PageLoading } from '@/components/PageState'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { errorMessage, request } from '@/lib/api'
import type { DepartmentOut } from '@/lib/types'

/** Act 4 — department CRUD. The backend blocks deleting a department that
 * still has doctors (409), and that message is surfaced verbatim. */
export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<DepartmentOut[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [renameTarget, setRenameTarget] = useState<DepartmentOut | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DepartmentOut | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setDepartments(await request<DepartmentOut[]>('/departments'))
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate(event: { preventDefault(): void }) {
    event.preventDefault()
    const name = newName.trim()
    if (name.length < 2) return
    setCreating(true)
    try {
      await request<DepartmentOut>('/departments', { method: 'POST', body: { name } })
      toast.success(`Department "${name}" created`)
      setNewName('')
      await load()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  async function handleRename() {
    if (renameTarget === null) return
    const name = renameValue.trim()
    if (name.length < 2) return
    setBusy(true)
    try {
      await request<DepartmentOut>(`/departments/${renameTarget.id}`, {
        method: 'PATCH',
        body: { name },
      })
      toast.success('Department renamed')
      setRenameTarget(null)
      await load()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (deleteTarget === null) return
    setBusy(true)
    try {
      await request<void>(`/departments/${deleteTarget.id}`, { method: 'DELETE' })
      toast.success(`Department "${deleteTarget.name}" deleted`)
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error(errorMessage(err))
      setDeleteTarget(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Departments</h1>
        <p className="text-sm text-muted-foreground">
          Doctors are organized by department; a department with doctors can't be deleted.
        </p>
      </div>

      <form onSubmit={(event) => void handleCreate(event)} className="flex gap-2">
        <Input
          placeholder="New department name (e.g. Cardiology)"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          minLength={2}
          maxLength={100}
          required
          className="max-w-xs"
          aria-label="New department name"
        />
        <Button type="submit" disabled={creating || newName.trim().length < 2}>
          {creating ? 'Creating…' : 'Create department'}
        </Button>
      </form>

      {error !== null ? (
        <PageError error={error} />
      ) : departments === null ? (
        <PageLoading rows={2} />
      ) : departments.length === 0 ? (
        <EmptyState title="No departments yet" hint="Create the first one above." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((department) => (
                <TableRow key={department.id}>
                  <TableCell>{department.id}</TableCell>
                  <TableCell className="font-medium">{department.name}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRenameTarget(department)
                          setRenameValue(department.name)
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeleteTarget(department)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename department</DialogTitle>
            <DialogDescription>
              {renameTarget === null ? '' : `Currently "${renameTarget.name}".`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-name" className="sr-only">
              New name
            </Label>
            <Input
              id="rename-name"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              minLength={2}
              maxLength={100}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || renameValue.trim().length < 2}
              onClick={() => void handleRename()}
            >
              {busy ? 'Saving…' : 'Save name'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete department?</DialogTitle>
            <DialogDescription>
              {deleteTarget === null
                ? ''
                : `"${deleteTarget.name}" — the backend rejects this if doctors are still assigned.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void handleDelete()}
            >
              {busy ? 'Deleting…' : 'Delete department'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}