import { useMemo, useState } from 'react'

/** Lowercase and strip accents so "benali" matches "Benâli". */
export function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Rows whose text fields contain every whitespace-separated query term. */
export function filterRows<T>(
  rows: readonly T[],
  query: string,
  textOf: (row: T) => readonly (string | number | null | undefined)[],
): T[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...rows]
  return rows.filter((row) => {
    const haystack = normalize(
      textOf(row)
        .filter((part) => part !== null && part !== undefined)
        .join(' '),
    )
    return terms.every((term) => haystack.includes(term))
  })
}

/** Pass module-level (stable) `text`/`status` functions so memoization holds. */
interface TableFilterOptions<T, S extends string> {
  /** Searchable text for a row (names, emails, ids…). */
  text: (row: T) => readonly (string | number | null | undefined)[]
  /** Optional client-side status bucket; 'all' disables it. */
  status?: (row: T) => S
  initialStatus?: S | 'all'
}

/** Search box + status select state for a client-side table. */
export function useTableFilter<T, S extends string = string>(
  rows: readonly T[] | null,
  { text, status, initialStatus = 'all' }: TableFilterOptions<T, S>,
) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<S | 'all'>(initialStatus)

  const filtered = useMemo(() => {
    if (rows === null) return null
    const byStatus =
      status === undefined || statusFilter === 'all'
        ? rows
        : rows.filter((row) => status(row) === statusFilter)
    return filterRows(byStatus, query, text)
  }, [rows, query, statusFilter, text, status])

  return { query, setQuery, statusFilter, setStatusFilter, filtered }
}
