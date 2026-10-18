import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { filterRows, useTableFilter } from './useTableFilter'

interface Row {
  name: string
  email: string
  state: 'paid' | 'unpaid'
}

const ROWS: Row[] = [
  { name: 'Leila Mansour', email: 'leila@example.com', state: 'unpaid' },
  { name: 'Omar Benâli', email: 'omar@example.com', state: 'paid' },
  { name: 'Sami Patient', email: 'patient@example.com', state: 'paid' },
]
const text = (row: Row) => [row.name, row.email]

describe('filterRows', () => {
  it('returns everything for an empty query', () => {
    expect(filterRows(ROWS, '   ', text)).toHaveLength(3)
  })

  it('matches case- and accent-insensitively on every term', () => {
    expect(filterRows(ROWS, 'BENALI', text).map((r) => r.name)).toEqual(['Omar Benâli'])
    expect(filterRows(ROWS, 'sami example', text)).toHaveLength(1)
    expect(filterRows(ROWS, 'sami leila', text)).toHaveLength(0)
  })

  it('ignores null fields', () => {
    expect(filterRows([{ a: null as string | null }], 'x', (r) => [r.a])).toHaveLength(0)
  })
})

describe('useTableFilter', () => {
  it('combines the status bucket with the search query', () => {
    const { result } = renderHook(() =>
      useTableFilter(ROWS, { text, status: (row) => row.state }),
    )
    expect(result.current.filtered).toHaveLength(3)

    act(() => result.current.setStatusFilter('paid'))
    expect(result.current.filtered?.map((r) => r.name)).toEqual(['Omar Benâli', 'Sami Patient'])

    act(() => result.current.setQuery('omar'))
    expect(result.current.filtered?.map((r) => r.name)).toEqual(['Omar Benâli'])
  })

  it('stays null while rows are loading', () => {
    const { result } = renderHook(() => useTableFilter<Row>(null, { text }))
    expect(result.current.filtered).toBeNull()
  })
})
