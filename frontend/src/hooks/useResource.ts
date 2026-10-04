import { useCallback, useEffect, useState } from 'react'
import { request } from '@/lib/api'

/**
 * GET one API path into state: `data` is null while loading, `error` holds the
 * failure, `reload` refetches. Pass `null` as the path to wait (e.g. until an
 * id is known).
 */
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)

  const reload = useCallback(async () => {
    if (path === null) return
    try {
      setData(await request<T>(path))
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [path])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, error, reload }
}
