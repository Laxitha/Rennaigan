import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <circle cx="16" cy="16" r="10" stroke="var(--color-accent)" strokeWidth="1.3" />
      <circle cx="16" cy="16" r="4.2" stroke="var(--color-accent-3)" strokeWidth="1.3" />
      <path d="M16 2.5v5M16 24.5v5M2.5 16h5M24.5 16h5" stroke="var(--color-accent)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function Brand({ to = '/', className }: { to?: string; className?: string }) {
  return (
    <Link to={to} className={cn('flex shrink-0 items-center gap-2.5', className)} aria-label="Rennaigan home">
      <BrandMark />
      <span className="text-[0.9375rem] font-[560] tracking-[0.16em] text-fg">RENNAIGAN</span>
    </Link>
  )
}
