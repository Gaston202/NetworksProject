import type { ReactNode } from 'react'
import { CalendarCheck2, FileHeart, ReceiptText } from 'lucide-react'
import { BRAND_NAME, BrandMark } from '@/components/BrandMark'

const HIGHLIGHTS = [
  { icon: CalendarCheck2, text: 'Book a specialist in three clicks — slots update live.' },
  { icon: FileHeart, text: 'Diagnoses and prescriptions in one private record.' },
  { icon: ReceiptText, text: 'Transparent invoices, issued the moment a visit ends.' },
]

/** Decorative row of Punic arches along the bottom of the brand panel. */
function Arches() {
  return (
    <svg
      viewBox="0 0 400 120"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full text-white/10"
    >
      {[0, 1, 2, 3, 4].map((index) => (
        <path
          key={index}
          d={`M${index * 84 + 12} 120V70a30 30 0 0 1 60 0v50`}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
        />
      ))}
    </svg>
  )
}

/**
 * Split-screen frame for login/register: brand panel on md+, form on the
 * right. On phones the panel collapses to a logo above the form.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground md:flex">
        <BrandMark inverted />
        <div className="relative z-10 flex max-w-md flex-col gap-6">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight lg:text-4xl">
            Care that keeps its appointments.
          </h1>
          <ul className="flex flex-col gap-3">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-white/85">
                <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-xs text-white/60">
          {BRAND_NAME} is a fictional hospital — CS411 Computer Networks demo.
        </p>
        <Arches />
      </aside>

      <main className="flex flex-col items-center justify-center gap-8 px-4 py-10">
        <BrandMark className="md:hidden" />
        {children}
      </main>
    </div>
  )
}
