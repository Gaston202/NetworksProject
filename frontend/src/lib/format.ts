/** Shared date/time display helpers — all render in the viewer's locale/timezone. */

/** "YYYY-MM-DD" group key for an ISO timestamp. */
export function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function formatDateTime(iso: string): string {
  return `${new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })} · ${formatTime(iso)}`
}

/** Today as "YYYY-MM-DD" in local time (what <input type="date"> expects). */
export function todayInputValue(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
