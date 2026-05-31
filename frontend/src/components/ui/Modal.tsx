import React, { useEffect } from 'react'
import { X } from 'lucide-react'
import { clsx } from '../../utils/clsx'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  footer?: React.ReactNode
}

export function Modal({ open, onClose, title, children, size = 'md', footer }: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-full mx-4',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        className={clsx(
          'relative w-full bg-white rounded-t-2xl sm:rounded-2xl shadow-xl',
          'flex flex-col max-h-[90vh]',
          sizes[size],
          'mx-0 sm:mx-4'
        )}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-5 py-2.5 border-b border-outline-variant flex-shrink-0">
            <h2 className="text-[16px] font-semibold text-on-surface font-display">{title}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-2.5 custom-scrollbar">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-5 py-2.5 border-t border-outline-variant flex-shrink-0 bg-surface-container-low rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
