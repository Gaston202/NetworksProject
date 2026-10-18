import { cn } from 'cn'

export const BRAND_NAME = 'Carthage Medical Center'

/**
 * Logo: a Punic arch (Carthage) framing a medical cross. Inline SVG so it
 * inherits currentColor and works offline on the lab network.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M8 25V15a8 8 0 0 1 16 0v10"
        fill="none"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path d="M16 13v8M12 17h8" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/** Logo + two-line wordmark used in the sidebar and auth screens. */
export function BrandMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <BrandLogo className={inverted ? 'text-white/15' : 'text-primary'} />
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-tight">Carthage</span>
        <span
          className={cn(
            'text-[11px] font-medium uppercase tracking-[0.12em]',
            inverted ? 'text-white/70' : 'text-muted-foreground',
          )}
        >
          Medical Center
        </span>
      </div>
    </div>
  )
}
