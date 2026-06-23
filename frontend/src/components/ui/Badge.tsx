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

const SVG_ICONS: Record<string, string> = {
  _oz:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" rx="4" fill="#1414CC"/><text x="10" y="14.5" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="900" font-size="11">OZ</text></svg>`,
  _ozm: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" rx="4" fill="#1414CC"/><text x="10" y="8" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="700" font-size="5.5">MIX</text><text x="10" y="16" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="900" font-size="10">OZ</text></svg>`,
  _tz:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" rx="4" fill="#AA2222"/><text x="10" y="14.5" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="900" font-size="11">TZ</text></svg>`,
  _tzm: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" rx="4" fill="#AA2222"/><text x="10" y="8" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="700" font-size="5.5">MIX</text><text x="10" y="16" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="900" font-size="10">TZ</text></svg>`,
}

export const CUSTOM_SVG_ICONS = [
  { key: '_oz',  label: 'OZ' },
  { key: '_ozm', label: 'MIX OZ' },
  { key: '_tz',  label: 'TZ' },
  { key: '_tzm', label: 'MIX TZ' },
]

export function svgIconSrc(key: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG_ICONS[key])}`
}

interface StatusBadgeProps {
  name: string
  color: string
  icon?: string | null
  className?: string
}

export function StatusBadge({ name, color, icon, className }: StatusBadgeProps) {
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
      {icon
        ? SVG_ICONS[icon]
          ? <img src={svgIconSrc(icon)} alt="" className="w-4 h-4 flex-shrink-0" />
          : <span className="text-[13px] leading-none">{icon}</span>
        : <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />}
      {name}
    </span>
  )
}
