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

/** Tunisian dinar — the fictional hospital is in Carthage. */
export const CURRENCY = 'TND'

const moneyFormat = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: CURRENCY,
})

export function formatMoney(amount: number): string {
  return moneyFormat.format(amount)
}


export function isSameLocalDay(iso: string, day: Date = new Date()): boolean {
  const date = new Date(iso)
  return (
    date.getFullYear() === day.getFullYear() &&
    date.getMonth() === day.getMonth() &&
    date.getDate() === day.getDate()
  )
}

export function greeting(now: Date = new Date()): string {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function formatLongDate(now: Date = new Date()): string {
  return now.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
