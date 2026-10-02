import { Badge } from '@/components/ui/badge'
import type { Role } from '@/lib/types'

const LABELS: Record<Role, string> = {
  admin: 'Admin',
  doctor: 'Doctor',
  patient: 'Patient',
}

const VARIANTS: Record<Role, 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  doctor: 'secondary',
  patient: 'outline',
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge variant={VARIANTS[role]}>
      {LABELS[role]}
    </Badge>
  )
}