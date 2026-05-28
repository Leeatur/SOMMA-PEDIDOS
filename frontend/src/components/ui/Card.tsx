import React from 'react'
import { clsx } from '../../utils/clsx'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

export function Card({ children, className, onClick, padding = 'md' }: CardProps) {
  const paddings = { none: '', sm: 'p-3', md: 'p-5', lg: 'p-6' }

  return (
    <div
      className={clsx(
        'bg-white rounded-xl border border-outline-variant shadow-sm',
        paddings[padding],
        onClick && 'cursor-pointer hover:border-primary/30 hover:shadow-md transition-all duration-150',
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}
