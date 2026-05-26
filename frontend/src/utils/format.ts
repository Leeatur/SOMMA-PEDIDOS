export function formatCurrency(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(n)) return 'R$ 0,00'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function formatDateTime(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatOrderNumber(n: number): string {
  return `#${String(n).padStart(4, '0')}`
}

export function formatPct(n: number | string): string {
  return `${Number(n).toFixed(1)}%`
}
