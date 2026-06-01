import React from 'react'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
      {icon && (
        <div className="mb-4 p-4 bg-surface-container rounded-full text-outline/70">{icon}</div>
      )}
      <h3 className="text-[13px] font-semibold text-on-surface">{title}</h3>
      {description && (
        <p className="mt-1 text-[13px] text-outline max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
