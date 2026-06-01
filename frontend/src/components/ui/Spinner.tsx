import { Loader2 } from 'lucide-react'
import { clsx } from '../../utils/clsx'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  label?: string
}

export function Spinner({ size = 'md', className, label = 'Carregando...' }: SpinnerProps) {
  const sizes = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' }
  return (
    <div className={clsx('flex items-center justify-center gap-2', className)}>
      <Loader2 className={clsx('animate-spin text-primary', sizes[size])} />
      {label && <span className="text-[12px] text-outline">{label}</span>}
    </div>
  )
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <Spinner size="lg" />
    </div>
  )
}
