import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ShoppingCart,
  Search,
  X,
  Filter,
  ChevronDown,
  ChevronUp,
  PlusCircle,
  BarChart3,
  Download,
} from 'lucide-react'
import { ordersApi, statusesApi, factoriesApi } from '../api/client'
import { svgIconSrc } from '../components/ui/Badge'
import { useAuthStore } from '../stores/authStore'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { PageSpinner } from '../components/ui/Spinner'
import { formatCurrency, formatDate, formatOrderNumber } from '../utils/format'
import {
  ColumnDef,
  ColumnConfigButton,
  useColumnConfig,
} from '../components/ui/ColumnConfig'
import { useColumnResize } from '../components/ui/useColumnResize.tsx'

interface Order {
  id: string
  order_number: number
  client_name: string
  client_trade_name: string | null
  client_city: string | null
  factory_name: string
  price_table_name: string
  rep_name: string
  total_value: number
  total_pieces: number
  discount_pct: number
  rep_commission_value: number
  office_commission_value: number
  rep_commission_pct: number
  office_commission_pct: number
  status_id: string | null
  status_name: string | null
  status_color: string | null
  status_icon?: string | null
  created_at: string
  industry_order_number: string | null
  delivery_date: string | null
  payment_terms: string | null
}

interface Status { id: string; name: string; color: string }
interface Factory { id: string; name: string }

// ─── Column definitions ───────────────────────────────────────────────────────

const ALL_COL_DEFS: ColumnDef[] = [
  { id: 'date',           label: 'Data' },
  { id: 'number',         label: 'Nº Pedido',         alwaysVisible: true },
  { id: 'factory',        label: 'Indústria' },
  { id: 'rep',            label: 'Vendedor' },
  { id: 'nr_rep',         label: 'Doc. orig.',          defaultVisible: true },
  { id: 'razao_social',   label: 'Razão Social',       alwaysVisible: true },
  { id: 'client',         label: 'Cliente' },
  { id: 'city',           label: 'Cidade' },
  { id: 'items',          label: 'Itens (pç)' },
  { id: 'value',          label: 'Valor' },
  { id: 'delivery',       label: 'Prev. Entrega',      defaultVisible: true },
  { id: 'payment',        label: 'Cond. Pagamento',    defaultVisible: true },
  { id: 'politica',       label: 'Política' },
  { id: 'commission',     label: 'Com. Rep.',          defaultVisible: false },
  { id: 'com_escr',      label: 'Com. Escrit.',       defaultVisible: false },
  { id: 'discount',       label: 'Desconto',           defaultVisible: false },
  { id: 'table',          label: 'Tabela',             defaultVisible: false },
  { id: 'status',         label: 'Status' },
]

const COL_META: Record<string, { align?: string; width?: string }> = {
  date:        { width: 'w-16' },
  number:      { width: 'w-20' },
  nr_rep:      { width: 'w-24' },
  items:       { align: 'text-center', width: 'w-16' },
  value:       { align: 'text-right',  width: 'w-28' },
  commission:  { align: 'text-right',  width: 'w-24' },
  com_escr:   { align: 'text-right',  width: 'w-24' },
  discount:    { align: 'text-right',  width: 'w-20' },
  delivery:    { width: 'w-24' },
  payment:     { width: 'w-32' },
  status:      { width: 'w-36' },
}

function OrderHeader({ id, label, sortCol, sortDir, onSort }: {
  id: string; label: string
  sortCol: string; sortDir: 'asc' | 'desc'
  onSort: (id: string) => void
}) {
  const meta = COL_META[id] || {}
  const isActive = sortCol === id
  const hasSort = ['date','number','factory','rep','razao_social','client','city','items','value','delivery','payment','commission','politica','status'].includes(id)
  return (
    <div
      onClick={hasSort ? () => onSort(id) : undefined}
      className={`px-2 py-1.5 text-[12px] font-semibold flex items-center gap-1 truncate select-none
        ${meta.align ?? ''}
        ${hasSort ? 'cursor-pointer hover:text-primary' : ''}
        ${isActive ? 'text-primary' : 'text-outline'}`}
    >
      <span className="truncate">{label}</span>
      {isActive && (
        <span className="text-[10px] flex-shrink-0">{sortDir === 'asc' ? '↑' : '↓'}</span>
      )}
      {!isActive && hasSort && (
        <span className="text-[10px] text-outline/30 flex-shrink-0">↕</span>
      )}
    </div>
  )
}

// OrderCell agora retorna o conteúdo sem <td> (o <td> é renderizado pelo loop pai)
function OrderCell({ id, o }: { id: string; o: Order }) {
  const cls = "px-2 py-1 text-[12px] truncate block"
  switch (id) {
    case 'date':      return <span className={`${cls} text-outline whitespace-nowrap`}>{formatDate(o.created_at)}</span>
    case 'number':    return <span className={`${cls} font-bold text-primary whitespace-nowrap`}>{formatOrderNumber(o.order_number)}</span>
    case 'factory':   return <span className={`${cls} font-semibold text-on-surface-variant`}>{o.factory_name}</span>
    case 'rep':       return <span className={`${cls} text-outline`}>{o.rep_name || '—'}</span>
    case 'nr_rep':    return <span className={`${cls} text-outline font-mono whitespace-nowrap`}>{o.industry_order_number || '—'}</span>
    case 'razao_social': return <span className={`${cls} font-semibold text-on-surface`}>{o.client_name}</span>
    case 'client':    return <span className={`${cls} text-on-surface-variant`}>{o.client_trade_name || '—'}</span>
    case 'city':      return <span className={`${cls} text-on-surface-variant`}>{o.client_city || '—'}</span>
    case 'items':     return <span className={`${cls} text-center text-on-surface-variant`}>{o.total_pieces > 0 ? o.total_pieces : '—'}</span>
    case 'value':     return <span className={`${cls} text-right font-bold text-on-surface whitespace-nowrap`}>{formatCurrency(o.total_value)}</span>
    case 'delivery':  return <span className={`${cls} text-on-surface-variant whitespace-nowrap`}>{o.delivery_date ? (() => { const [y,m,d] = String(o.delivery_date).substring(0,10).split('-'); return `${d}/${m}/${y}` })() : '—'}</span>
    case 'payment':   return <span className={`${cls} text-on-surface-variant`}>{o.payment_terms || '—'}</span>
    case 'commission': { const v = Number(o.total_value) * Number(o.rep_commission_pct)    / 100; return <span className={`${cls} text-right whitespace-nowrap ${v > 0 ? 'font-semibold text-emerald-600' : 'text-outline/50'}`}>{v > 0 ? formatCurrency(v) : '—'}</span> }
    case 'com_escr':   { const v = Number(o.total_value) * Number(o.office_commission_pct) / 100; return <span className={`${cls} text-right whitespace-nowrap ${v > 0 ? 'font-semibold text-blue-600' : 'text-outline/50'}`}>{v > 0 ? formatCurrency(v) : '—'}</span> }
    case 'politica':  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold mx-2 inline-block ${o.discount_pct === 0 ? 'bg-blue-50 text-blue-700' : o.discount_pct <= 5 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{o.discount_pct > 0 ? `${o.discount_pct}%` : '0%'}</span>
    case 'discount':  return <span className={`${cls} text-right whitespace-nowrap ${o.discount_pct > 0 ? 'font-semibold text-emerald-600' : 'text-outline/50'}`}>{o.discount_pct > 0 ? `-${o.discount_pct}%` : '—'}</span>
    case 'table':     return <span className={`${cls} text-outline/70`}>{o.price_table_name}</span>
    case 'status':    return o.status_name && o.status_color ? (
      <div className="flex items-center gap-1.5 px-2 py-1 min-w-0">
        {o.status_icon
          ? o.status_icon.split(' ').filter(Boolean).map((part, i) =>
              part.startsWith('_')
                ? <img key={i} src={svgIconSrc(part)} alt="" className="w-4 h-4 flex-shrink-0" />
                : <span key={i} className="text-[13px] leading-none flex-shrink-0">{part}</span>
            )
          : <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: o.status_color }} />}
        <span className="text-[12px] font-medium text-on-surface-variant truncate">{o.status_name}</span>
      </div>
    ) : <span className={`${cls} text-outline/50`}>—</span>
    default: return <span className={cls} />
  }
}

// ─── Mobile Order Card ────────────────────────────────────────────────────────

function MobileOrderCard({ o, onClick }: { o: Order; onClick: () => void }) {
  const accent = o.status_color || '#9CA3AF'
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl overflow-hidden active:scale-[0.98] transition-transform cursor-pointer"
      style={{ boxShadow: '0 1px 8px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.04)' }}
    >
      {/* Status top bar */}
      <div className="h-1 w-full" style={{ background: accent }} />

      <div className="p-3">
        {/* Row 1: number + status pill */}
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[12px] font-bold text-primary font-mono">{formatOrderNumber(o.order_number)}</span>
          {o.status_name ? (
            <span className="text-[12px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
              style={{ backgroundColor: accent + '22', color: accent }}>
              {o.status_icon && o.status_icon.split(' ').filter(Boolean).map((part, i) =>
                part.startsWith('_')
                  ? <img key={i} src={svgIconSrc(part)} alt="" className="w-3.5 h-3.5 flex-shrink-0" />
                  : <span key={i} className="text-[13px] leading-none">{part}</span>
              )}
              {o.status_name}
            </span>
          ) : null}
        </div>

        {/* Row 2: client name */}
        <p className="text-[12px] font-semibold text-on-surface leading-tight truncate">{o.client_name}</p>
        {o.client_trade_name && (
          <p className="text-[12px] text-on-surface-variant mt-0.5 truncate">{o.client_trade_name}</p>
        )}

        {/* Row 3: meta */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {o.factory_name && (
            <span className="text-[12px] font-semibold bg-surface-container px-2 py-0.5 rounded-full text-outline">{o.factory_name}</span>
          )}
          {o.client_city && (
            <span className="text-[12px] text-outline">{o.client_city}</span>
          )}
          <span className="text-[12px] text-orange-500 font-bold flex items-center gap-0.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
            {o.rep_name || '(sem vendedor)'}
          </span>
        </div>

        {/* Row 4: bottom — date + pieces + value */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
          <div>
            <p className="text-[12px] text-outline">{formatDate(o.created_at)}</p>
            {o.total_pieces > 0 && (
              <p className="text-[12px] text-outline/70">{o.total_pieces} peças</p>
            )}
          </div>
          <p className="text-[14px] font-bold text-on-surface">{formatCurrency(o.total_value)}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Resumo de Vendas (relatórios rápidos) ───────────────────────────────────

interface OrdersSummary {
  by_day: { dia: string; pedidos: number; total: number }[]
  by_rep: { vendedor: string; pedidos: number; total: number }[]
  by_factory: { fabrica: string; pedidos: number; total: number }[]
  by_status: { status: string; color: string | null; pedidos: number; total: number }[]
}

interface SummaryCardRow { label: string; pedidos: number; total: number; color?: string | null }

// Evita o problema de fuso-horário: formata "YYYY-MM-DD..." direto em "DD/MM/AAAA"
function formatDiaBR(dia: string): string {
  if (!dia) return ''
  const m = String(dia).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(dia)
  return `${m[3]}/${m[2]}/${m[1]}`
}

function SummaryCard({ title, rows, loading }: { title: string; rows: SummaryCardRow[]; loading?: boolean }) {
  const grandTotal = rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0)
  return (
    <div className="bg-white border border-outline-variant/60 rounded-xl p-3 flex flex-col min-w-0">
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-outline truncate">{title}</p>
        <p className="text-[12px] font-bold text-on-surface whitespace-nowrap">{formatCurrency(grandTotal)}</p>
      </div>
      <div className="space-y-0.5 max-h-60 overflow-auto pr-1">
        {loading ? (
          <p className="text-[12px] text-outline/60 py-6 text-center">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="text-[12px] text-outline/60 py-6 text-center">Sem dados no período</p>
        ) : (
          rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-[12px] py-1 px-1.5 rounded-lg hover:bg-surface-container-low transition-colors">
              <div className="flex items-center gap-1.5 min-w-0">
                {r.color && <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />}
                <span className="truncate text-on-surface-variant">{r.label || '—'}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-outline text-[11px]">{r.pedidos} ped.</span>
                <span className="font-semibold text-on-surface whitespace-nowrap">{formatCurrency(r.total)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Exportação / Totais ──────────────────────────────────────────────────────

interface OrderTotals { pieces: number; value: number; comRep: number; comEscr: number }

// número no padrão pt-BR (vírgula decimal) p/ abrir certinho no Excel
function numBR(x: number): string { return (Number(x) || 0).toFixed(2).replace('.', ',') }

function deliveryBR(d: string | null): string {
  if (!d) return ''
  const [y, m, dd] = String(d).substring(0, 10).split('-')
  return `${dd}/${m}/${y}`
}

// valor "cru" de cada coluna para o CSV (sem R$, datas DD/MM/AAAA, números pt-BR)
function csvCell(id: string, o: Order): string | number {
  switch (id) {
    case 'date':         return formatDate(o.created_at)
    case 'number':       return formatOrderNumber(o.order_number)
    case 'factory':      return o.factory_name || ''
    case 'rep':          return o.rep_name || ''
    case 'nr_rep':       return o.industry_order_number || ''
    case 'razao_social': return o.client_name || ''
    case 'client':       return o.client_trade_name || ''
    case 'city':         return o.client_city || ''
    case 'items':        return o.total_pieces || 0
    case 'value':        return numBR(o.total_value)
    case 'delivery':     return deliveryBR(o.delivery_date)
    case 'payment':      return o.payment_terms || ''
    case 'politica':     return `${o.discount_pct || 0}%`
    case 'commission':   return numBR(Number(o.total_value) * Number(o.rep_commission_pct) / 100)
    case 'com_escr':     return numBR(Number(o.total_value) * Number(o.office_commission_pct) / 100)
    case 'discount':     return o.discount_pct > 0 ? `-${o.discount_pct}%` : ''
    case 'table':        return o.price_table_name || ''
    case 'status':       return o.status_name || ''
    default:             return ''
  }
}

function csvTotalCell(id: string, t: OrderTotals): string | number {
  switch (id) {
    case 'items':      return t.pieces || ''
    case 'value':      return numBR(t.value)
    case 'commission': return numBR(t.comRep)
    case 'com_escr':   return numBR(t.comEscr)
    default:           return ''
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Orders() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status_id') || '')
  const [factoryFilter, setFactoryFilter] = useState('')
  const [repFilter, setRepFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [showSummary, setShowSummary] = useState(false)

  const { data: statuses } = useQuery<Status[]>({
    queryKey: ['statuses'],
    queryFn: () => statusesApi.list().then((r) => r.data),
  })

  const { data: factories } = useQuery<Factory[]>({
    queryKey: ['factories'],
    queryFn: () => factoriesApi.list().then((r) => r.data),
  })

  const { data: orders, isLoading } = useQuery<Order[]>({
    queryKey: ['orders', search, statusFilter, factoryFilter, dateFrom, dateTo],
    queryFn: () =>
      ordersApi.list({
        search: search || undefined,
        status_id: statusFilter || undefined,
        factory_id: factoryFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }).then((r) => r.data),
    // Tempo real: recarrega a lista a cada 20s (só com a aba em foco)
    refetchInterval: 20000,
  })

  const { data: summary, isLoading: summaryLoading } = useQuery<OrdersSummary>({
    queryKey: ['orders-summary', dateFrom, dateTo],
    queryFn: () =>
      ordersApi.summary({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }).then((r) => r.data),
    enabled: showSummary,
    refetchInterval: 20000,
  })

  const colDefs = ALL_COL_DEFS.filter(c => (c.id !== 'rep' && c.id !== 'com_escr') || isAdmin)
  const { orderedDefs, config, save, reset } = useColumnConfig('orders', colDefs)
  const visibleCols = orderedDefs.filter(c => c.visible)

  // Redimensionamento de colunas
  const DEFAULT_WIDTHS: Record<string, number> = {
    date: 80, number: 80, factory: 90, rep: 110, nr_rep: 90,
    razao_social: 160, client: 120, city: 90, items: 70,
    value: 100, delivery: 90, payment: 130, politica: 70,
    commission: 90, discount: 80, table: 150, status: 130,
  }
  const { widths, save: saveWidths } = useColumnResize('orders', DEFAULT_WIDTHS)

  // Ordenação por clique no cabeçalho
  const [sortCol, setSortCol] = useState<string>('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSortClick = (colId: string) => {
    if (sortCol === colId) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(colId); setSortDir('asc') }
  }

  const SORT_FIELDS: Record<string, (o: Order) => string | number> = {
    date:        o => o.created_at,
    number:      o => o.order_number,
    factory:     o => o.factory_name?.toLowerCase() || '',
    rep:         o => o.rep_name?.toLowerCase() || '',
    razao_social: o => o.client_name?.toLowerCase() || '',
    client:      o => (o.client_trade_name || '').toLowerCase(),
    city:        o => (o.client_city || '').toLowerCase(),
    items:       o => o.total_pieces || 0,
    value:       o => Number(o.total_value) || 0,
    delivery:    o => o.delivery_date || '',
    payment:     o => o.payment_terms || '',
    commission:  o => Number(o.total_value) * Number(o.rep_commission_pct) / 100,
    politica:    o => Number(o.discount_pct) || 0,
    status:      o => o.status_name?.toLowerCase() || '',
  }

  const sortedOrders = sortCol && SORT_FIELDS[sortCol]
    ? [...(orders || [])].sort((a, b) => {
        const fn = SORT_FIELDS[sortCol]
        const av = fn(a), bv = fn(b)
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
    : (orders || [])

  // Lista de vendedores que aparecem nos pedidos (para o filtro)
  const repOptions = useMemo(() => {
    const s = new Set<string>()
    ;(orders || []).forEach(o => { if (o.rep_name) s.add(o.rep_name) })
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [orders])

  // Filtro por vendedor (cliente-side, sobre a lista já ordenada)
  const displayedOrders = repFilter ? sortedOrders.filter(o => o.rep_name === repFilter) : sortedOrders
  const total = displayedOrders.length

  // Somatório das colunas numéricas (reflete os filtros aplicados)
  const totals = useMemo<OrderTotals>(() => {
    const t: OrderTotals = { pieces: 0, value: 0, comRep: 0, comEscr: 0 }
    displayedOrders.forEach(o => {
      t.pieces  += Number(o.total_pieces) || 0
      t.value   += Number(o.total_value) || 0
      t.comRep  += Number(o.total_value) * Number(o.rep_commission_pct) / 100
      t.comEscr += Number(o.total_value) * Number(o.office_commission_pct) / 100
    })
    return t
  }, [displayedOrders])

  // Coluna onde fica o rótulo "TOTAL" (na Razão Social, que é larga; senão a 1ª)
  const labelColIdx = Math.max(0, visibleCols.findIndex(c => c.id === 'razao_social'))

  function exportarCSV() {
    const cols = visibleCols
    const linhas: (string | number)[][] = [
      cols.map(c => c.label),
      ...displayedOrders.map(o => cols.map(c => csvCell(c.id, o))),
      cols.map((c, i) => i === labelColIdx ? `TOTAL (${displayedOrders.length} pedidos)` : csvTotalCell(c.id, totals)),
    ]
    const csv = '﻿' + linhas.map(r => r.map(cell => {
      const sv = String(cell ?? '')
      return /[";\n]/.test(sv) ? `"${sv.replace(/"/g, '""')}"` : sv
    }).join(';')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pedidos-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full">

      {/* ══ MOBILE VIEW ══════════════════════════════════════════════════════ */}
      <div className="lg:hidden flex flex-col h-full" style={{ background: '#F5F3FF' }}>

        {/* Mobile header */}
        <div className="sticky top-0 z-20 px-4 pt-4 pb-2 bg-white" style={{ boxShadow: '0 1px 0 #E5E7EB' }}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-[18px] font-bold text-on-surface" style={{ fontFamily: 'Plus Jakarta Sans' }}>Pedidos</h2>
              <p className="text-[12px] text-outline mt-0.5">
                {isLoading ? '' : `${total} pedido${total !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-outline/60" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cliente, nº pedido, indústria..."
              className="w-full h-11 pl-10 pr-10 bg-surface-container-low border border-outline-variant/40 rounded-2xl text-[12px] focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-outline/50 hover:text-on-surface transition-colors">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Status filter chips */}
        {statuses && statuses.length > 0 && (
          <div className="sticky top-[108px] z-20 flex gap-2 overflow-x-auto px-4 py-2 bg-white border-b border-gray-100 scrollbar-hide">
            <button
              onClick={() => setStatusFilter('')}
              className={`flex-shrink-0 px-3.5 py-1 rounded-full text-[12px] font-bold uppercase tracking-wide transition-all ${
                statusFilter === '' ? 'bg-primary text-white shadow-md shadow-primary/30' : 'bg-surface-container text-on-surface-variant'
              }`}
            >
              Todos
            </button>
            {statuses.map(s => (
              <button
                key={s.id}
                onClick={() => setStatusFilter(statusFilter === s.id ? '' : s.id)}
                className="flex-shrink-0 px-3.5 py-1 rounded-full text-[12px] font-bold uppercase tracking-wide transition-all"
                style={
                  statusFilter === s.id
                    ? { backgroundColor: s.color, color: '#fff', boxShadow: `0 2px 8px ${s.color}44` }
                    : { backgroundColor: s.color + '18', color: s.color }
                }
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {/* Cards */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><PageSpinner /></div>
          ) : total === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-8">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <ShoppingCart className="h-8 w-8 text-primary/50" />
              </div>
              <p className="text-[12px] font-semibold text-on-surface">Nenhum pedido encontrado</p>
              <p className="text-[12px] text-outline mt-1">
                {search || statusFilter ? 'Tente ajustar os filtros.' : 'Crie o primeiro pedido.'}
              </p>
            </div>
          ) : (
            <div className="px-4 pt-2.5 pb-28 space-y-2">
              {displayedOrders.map(o => (
                <MobileOrderCard
                  key={o.id}
                  o={o}
                  onClick={() => navigate(`/orders/${o.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ══ DESKTOP VIEW ═════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex flex-col h-full">

        {/* Desktop Header */}
        <div className="sticky top-0 z-20 px-8 pt-4 pb-2 border-b border-outline-variant bg-white">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="font-display text-lg font-bold text-on-surface">Pedidos</h1>
              <p className="text-[12px] text-on-surface-variant">
                {isLoading ? 'Carregando…' : `${total} pedido${total !== 1 ? 's' : ''}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ColumnConfigButton defs={colDefs} config={config} onSave={save} onReset={reset} />
              <button
                onClick={exportarCSV}
                disabled={total === 0}
                className="flex items-center gap-1 text-xs px-3 py-1 border rounded-lg transition-colors text-outline border-outline-variant bg-white hover:text-on-surface-variant disabled:opacity-40 disabled:cursor-not-allowed"
                title="Exportar a lista atual (com filtros) para Excel/CSV"
              >
                <Download className="h-4 w-4" />
                Exportar
              </button>
              <button
                onClick={() => setShowSummary(!showSummary)}
                className={`flex items-center gap-1 text-xs px-3 py-1 border rounded-lg transition-colors ${
                  showSummary
                    ? 'text-primary border-primary/40 bg-primary/10'
                    : 'text-outline border-outline-variant bg-white hover:text-on-surface-variant'
                }`}
                title="Resumo de vendas"
              >
                <BarChart3 className="h-4 w-4" />
                Resumo
              </button>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-1 text-xs px-3 py-1 border rounded-lg transition-colors ${
                  showFilters || statusFilter || factoryFilter || dateFrom || dateTo
                    ? 'text-primary border-primary/40 bg-primary/10'
                    : 'text-outline border-outline-variant bg-white hover:text-on-surface-variant'
                }`}
              >
                <Filter className="h-4 w-4" />
                {showFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              <Button onClick={() => navigate('/orders/new')} icon={<PlusCircle className="h-4 w-4" />} size="sm">
                Novo
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder="Buscar por cliente, nº pedido, indústria, vendedor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leftIcon={<Search className="h-4 w-4" />}
                onClear={() => setSearch('')}
              />
            </div>
          </div>

          {showFilters && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-outline-variant rounded-lg px-3 py-1 text-xs text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              >
                <option value="">Todos os status</option>
                {(statuses || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select
                value={factoryFilter}
                onChange={(e) => setFactoryFilter(e.target.value)}
                className="border border-outline-variant rounded-lg px-3 py-1 text-xs text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              >
                <option value="">Todas as fábricas</option>
                {(factories || []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              {isAdmin && (
                <select
                  value={repFilter}
                  onChange={(e) => setRepFilter(e.target.value)}
                  className="border border-outline-variant rounded-lg px-3 py-1 text-xs text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                >
                  <option value="">Todos os vendedores</option>
                  {repOptions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="border border-outline-variant rounded-lg px-3 py-1 text-xs text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white" />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="border border-outline-variant rounded-lg px-3 py-1 text-xs text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white" />
            </div>
          )}
        </div>

        {/* Resumo de Vendas — relatórios rápidos */}
        {showSummary && (
          <div className="border-b border-outline-variant bg-surface-container-low/40 px-8 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Resumo de Vendas
              </h3>
              <p className="text-[11px] text-outline">
                {dateFrom || dateTo
                  ? `Período: ${dateFrom ? formatDate(dateFrom) : '...'} a ${dateTo ? formatDate(dateTo) : '...'}`
                  : 'Use os filtros de data acima para definir o período (sem filtro = todos os pedidos)'}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <SummaryCard
                title="Vendas por dia"
                loading={summaryLoading}
                rows={(summary?.by_day || []).map(r => ({ label: formatDiaBR(r.dia), pedidos: r.pedidos, total: Number(r.total) }))}
              />
              <SummaryCard
                title="Vendas por vendedor"
                loading={summaryLoading}
                rows={(summary?.by_rep || []).map(r => ({ label: r.vendedor, pedidos: r.pedidos, total: Number(r.total) }))}
              />
              <SummaryCard
                title="Vendas por fábrica"
                loading={summaryLoading}
                rows={(summary?.by_factory || []).map(r => ({ label: r.fabrica, pedidos: r.pedidos, total: Number(r.total) }))}
              />
              <SummaryCard
                title="Vendas por status"
                loading={summaryLoading}
                rows={(summary?.by_status || []).map(r => ({ label: r.status, pedidos: r.pedidos, total: Number(r.total), color: r.color }))}
              />
            </div>
          </div>
        )}

        {/* Desktop Table */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center"><PageSpinner /></div>
        ) : total === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 bg-surface-container rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ShoppingCart className="h-8 w-8 text-outline/50" />
            </div>
            <p className="text-outline font-medium">Nenhum pedido encontrado</p>
            <p className="text-xs text-outline/70 mt-1">
              {search || statusFilter || factoryFilter || repFilter ? 'Tente ajustar os filtros.' : 'Crie o primeiro pedido.'}
            </p>
            <button
              onClick={() => navigate('/orders/new')}
              className="mt-4 flex items-center gap-2 px-4 py-1 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 transition-colors"
            >
              <PlusCircle className="h-4 w-4" /> Criar Pedido
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            {/* Dica de uso */}
            <div className="text-[11px] text-outline/50 px-3 py-1 bg-surface-container-low border-b border-outline-variant/30">
              Arraste a borda direita do cabeçalho para redimensionar · Clique na coluna para ordenar
            </div>
            <table className="text-left" style={{ tableLayout: 'fixed', width: '100%' }}>
              <thead className="bg-surface-container-low border-b border-outline-variant sticky top-0 z-10">
                <tr>
                  {visibleCols.map((col, colIdx) => {
                    const colWidth = widths[col.id] ?? DEFAULT_WIDTHS[col.id] ?? 100
                    return (
                      <th
                        key={col.id}
                        style={{ width: colWidth, minWidth: 50, position: 'relative' }}
                        draggable
                        onDragStart={e => { e.dataTransfer.setData('colIdx', String(colIdx)) }}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault()
                          const fromIdx = parseInt(e.dataTransfer.getData('colIdx'))
                          if (fromIdx === colIdx || isNaN(fromIdx)) return
                          // Reordena no config
                          const fromId = visibleCols[fromIdx].id
                          const toId = col.id
                          const newConfig = [...config]
                          const fromPos = newConfig.findIndex(c => c.id === fromId)
                          const toPos = newConfig.findIndex(c => c.id === toId)
                          if (fromPos >= 0 && toPos >= 0) {
                            const [moved] = newConfig.splice(fromPos, 1)
                            newConfig.splice(toPos, 0, moved)
                            save(newConfig)
                          }
                        }}
                      >
                        <OrderHeader id={col.id} label={col.label} sortCol={sortCol} sortDir={sortDir} onSort={handleSortClick} />
                        {/* Handle de resize — fora do overflow */}
                        <div
                          style={{ position: 'absolute', top: 0, right: 0, width: 6, height: '100%', cursor: 'col-resize', zIndex: 20 }}
                          className="hover:bg-primary/40 active:bg-primary/60 group"
                          title="Arraste para redimensionar"
                          onMouseDown={e => {
                            e.preventDefault()
                            e.stopPropagation()
                            const startX = e.clientX
                            const startWidth = colWidth
                            const onMove = (ev: MouseEvent) => {
                              const newW = Math.max(50, startWidth + ev.clientX - startX)
                              saveWidths({ ...widths, [col.id]: newW })
                            }
                            const onUp = () => {
                              window.removeEventListener('mousemove', onMove)
                              window.removeEventListener('mouseup', onUp)
                            }
                            window.addEventListener('mousemove', onMove)
                            window.addEventListener('mouseup', onUp)
                          }}
                        >
                          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-px h-4 bg-outline/30 group-hover:bg-primary/60" />
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="bg-white">
                {displayedOrders.map(o => (
                  <tr
                    key={o.id}
                    className="border-b border-outline-variant/50 hover:bg-primary/5 cursor-pointer transition-colors"
                    onClick={() => navigate(`/orders/${o.id}`)}
                  >
                    {visibleCols.map(col => (
                      <td key={col.id} style={{ width: widths[col.id] ?? DEFAULT_WIDTHS[col.id], overflow: 'hidden' }}>
                        <OrderCell id={col.id} o={o} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {/* Linha de totais — soma das colunas (reflete os filtros) */}
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-surface-container border-t-2 border-primary/40">
                  {visibleCols.map((col, i) => {
                    const meta = COL_META[col.id] || {}
                    let content: string | number = ''
                    let extra = 'text-on-surface'
                    if (i === labelColIdx) content = `TOTAL · ${displayedOrders.length} ped.`
                    else if (col.id === 'items') content = totals.pieces > 0 ? totals.pieces : ''
                    else if (col.id === 'value') content = formatCurrency(totals.value)
                    else if (col.id === 'commission') { content = formatCurrency(totals.comRep); extra = 'text-emerald-600' }
                    else if (col.id === 'com_escr') { content = formatCurrency(totals.comEscr); extra = 'text-blue-600' }
                    return (
                      <td key={col.id} style={{ width: widths[col.id] ?? DEFAULT_WIDTHS[col.id], overflow: 'hidden' }}
                        className={`px-2 py-2 text-[12px] font-bold whitespace-nowrap ${meta.align ?? ''} ${extra}`}>
                        {content}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
