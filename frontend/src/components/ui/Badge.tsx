import React from 'react'
import { clsx } from '../../utils/clsx'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple'
  className?: string
}

const variants = {
  default: 'bg-slate-100 text-slate-600',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-primary/10 text-primary',
  purple: 'bg-purple-100 text-purple-700',
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  )
}

interface StatusBadgeProps {
  name: string
  color: string
  className?: string
}

export function StatusBadge({ name, color, className }: StatusBadgeProps) {
  // Convert hex to rgb for background with opacity
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold',
        className
      )}
      style={{
        backgroundColor: `rgba(${r}, ${g}, ${b}, 0.15)`,
        color: color,
        border: `1px solid rgba(${r}, ${g}, ${b}, 0.3)`,
      }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {name}
    </span>
  )
}
