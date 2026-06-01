import React from 'react'
import { Loader2 } from 'lucide-react'
import { clsx } from '../../utils/clsx'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
  fullWidth?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  fullWidth = false,
  children,
  disabled,
  className,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]'

  const variants = {
    primary:
      'bg-primary text-on-primary hover:brightness-110 focus:ring-primary shadow-md shadow-primary/20',
    secondary:
      'bg-surface-container text-on-surface hover:bg-surface-container-high focus:ring-outline',
    danger:
      'bg-error text-on-error hover:brightness-110 focus:ring-error shadow-sm',
    ghost:
      'text-on-surface-variant hover:bg-surface-container focus:ring-outline',
    outline:
      'border border-outline-variant text-on-surface hover:bg-surface-container-low focus:ring-outline bg-white',
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-[12px]',
    md: 'px-4 py-1.5 text-[12px]',
    lg: 'px-6 py-2 text-[14px]',
  }

  return (
    <button
      disabled={disabled || loading}
      className={clsx(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}
