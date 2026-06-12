export function formatCurrency(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(n)) return 'R$ 0,00'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
}

/**
 * Formata data em pt-BR (dd/mm/aa).
 * Aceita tanto "YYYY-MM-DD" (coluna DATE do PostgreSQL) quanto timestamps ISO completos.
 *
 * Bug evitado: new Date("2026-06-12") parseia como UTC midnight → no UTC-3
 * do Brasil isso vira o dia ANTERIOR. Para datas sem hora usamos manipulação
 * de string direta; para timestamps completos usamos Date() normalmente.
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const s = String(dateStr).trim()
  if (!s) return ''
  // Timestamp completo (contém 'T' ou 'Z'): usar Date() — converte para tz local do browser
  if (s.includes('T') || s.includes('Z')) {
    const dt = new Date(s)
    if (isNaN(dt.getTime())) return ''
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  }
  // Data sem hora "YYYY-MM-DD": manipulação de string — evita UTC→local (-1 dia no Brasil)
  const [y, m, d] = s.substring(0, 10).split('-')
  if (!y || !m || !d) return ''
  return `${d}/${m}/${y.slice(-2)}`
}

export function formatDateTime(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
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
