import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

/** One KPI tile: label, big number, optional context line. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  /** null renders a loading placeholder */
  value: ReactNode | null
  hint?: ReactNode
  icon: LucideIcon
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="rounded-md bg-secondary p-1.5 text-secondary-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      {value === null ? (
        <Skeleton className="h-8 w-20" />
      ) : (
        <p className="tabular text-2xl font-semibold tracking-tight">{value}</p>
      )}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
