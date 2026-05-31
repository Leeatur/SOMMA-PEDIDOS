import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ShoppingCart,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  PlusCircle,
} from 'lucide-react'
import { ordersApi, statusesApi, factoriesApi } from '../api/client'
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
  status_id: string | null
  status_name: string | null
  status_color: string | null
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
  { id: 'nr_rep',         label: 'Nº na Representada', defaultVisible: true },
  { id: 'razao_social',   label: 'Razão Social',       alwaysVisible: true },
  { id: 'client',         label: 'Cliente' },
  { id: 'city',           label: 'Cidade' },
  { id: 'items',          label: 'Itens (pç)' },
  { id: 'value',          label: 'Valor' },
  { id: 'delivery',       label: 'Prev. Entrega',      defaultVisible: true },
  { id: 'payment',        label: 'Cond. Pagamento',    defaultVisible: true },
  { id: 'commission',     label: 'Comissão',           defaultVisible: false },
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
  discount:    { align: 'text-right',  width: 'w-20' },
  delivery:    { width: 'w-24' },
  payment:     { width: 'w-32' },
  status:      { width: 'w-36' },
}

function OrderHeader({ id, label }: { id: string; label: string }) {
  const meta = COL_META[id] || {}
  return (
    <th className={`px-2 py-1.5 text-[10px] font-semibold text-outline first:pl-3 last:pr-3 ${meta.width ?? ''} ${meta.align ?? ''}`}>
      {label}
    </th>
  )
}

function OrderCell({ id, o }: { id: string; o: Order }) {
  switch (id) {
    case 'date':
      return <td className="pl-3 pr-2 py-1 whitespace-nowrap"><span className="text-[11px] text-outline">{formatDate(o.created_at)}</span></td>
    case 'number':
      return <td className="px-2 py-1 whitespace-nowrap first:pl-3"><span className="text-[11px] font-bold text-primary">{formatOrderNumber(o.order_number)}</span></td>
    case 'factory':
      return <td className="px-2 py-1 max-w-[110px]"><span className="text-[11px] font-semibold text-on-surface-variant truncate block">{o.factory_name}</span></td>
    case 'rep':
      return <td className="px-2 py-1 max-w-[120px]"><span className="text-[11px] text-outline truncate block">{o.rep_name || '—'}</span></td>
    case 'nr_rep':
      return <td className="px-2 py-1 whitespace-nowrap"><span className="text-[11px] text-outline font-mono">{o.industry_order_number || '—'}</span></td>
    case 'razao_social':
      return <td className="px-2 py-1 max-w-[200px]"><p className="text-[12px] font-semibold text-on-surface truncate leading-tight">{o.client_name}</p></td>
    case 'client':
      return <td className="px-2 py-1 max-w-[160px]"><span className="text-[11px] text-on-surface-variant truncate block">{o.client_trade_name || '—'}</span></td>
    case 'city':
      return <td className="px-2 py-1 max-w-[120px]"><span className="text-[11px] text-on-surface-variant truncate block">{o.client_city || '—'}</span></td>
    case 'items':
      return <td className="px-2 py-1 text-center"><span className="text-[11px] font-medium text-on-surface-variant">{o.total_pieces > 0 ? o.total_pieces : '—'}</span></td>
    case 'value':
      return <td className="px-2 py-1 text-right whitespace-nowrap"><span className="text-[12px] font-bold text-on-surface">{formatCurrency(o.total_value)}</span></td>
    case 'delivery':
      return <td className="px-2 py-1 whitespace-nowrap">
        {o.delivery_date
          ? <span className="text-[11px] text-on-surface-variant">{new Date(o.delivery_date + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
          : <span className="text-[11px] text-outline/50">—</span>}
      </td>
    case 'payment':
      return <td className="px-2 py-1 max-w-[130px]"><span className="text-[11px] text-on-surface-variant truncate block">{o.payment_terms || '—'}</span></td>
    case 'commission':
      return <td className="px-2 py-1 text-right whitespace-nowrap">
        {o.rep_commission_value > 0
          ? <span className="text-[11px] font-semibold text-emerald-600">{formatCurrency(o.rep_commission_value)}</span>
          : <span className="text-[11px] text-outline/50">—</span>}
      </td>
    case 'discount':
      return <td className="px-2 py-1 text-right whitespace-nowrap last:pr-3">
        {o.discount_pct > 0
          ? <span className="text-[11px] font-semibold text-emerald-600">-{o.discount_pct}%</span>
          : <span className="text-[11px] text-outline/50">—</span>}
      </td>
    case 'table':
      return <td className="px-2 py-1 max-w-[150px]"><span className="text-[11px] text-outline/70 truncate block">{o.price_table_name}</span></td>
    case 'status':
      return <td className="px-2 pr-3 py-1">
        {o.status_name && o.status_color ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: o.status_color }} />
            <span className="text-[11px] font-medium text-on-surface-variant truncate">{o.status_name}</span>
          </div>
        ) : <span className="text-[11px] text-outline/50">—</span>}
      </td>
    default:
      return <td className="px-2 py-1" />
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

      <div className="p-4">
        {/* Row 1: number + status pill */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-bold text-primary font-mono">{formatOrderNumber(o.order_number)}</span>
          {o.status_name ? (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: accent + '22', color: accent }}>
              {o.status_name}
            </span>
          ) : null}
        </div>

        {/* Row 2: client name */}
        <p className="text-[13px] font-semibold text-on-surface leading-tight truncate">{o.client_name}</p>
        {o.client_trade_name && (
          <p className="text-[11px] text-on-surface-variant mt-0.5 truncate">{o.client_trade_name}</p>
        )}

        {/* Row 3: meta */}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {o.factory_name && (
            <span className="text-[10px] font-semibold bg-surface-container px-2 py-0.5 rounded-full text-outline">{o.factory_name}</span>
          )}
          {o.client_city && (
            <span className="text-[10px] text-outline">{o.client_city}</span>
          )}
        </div>

        {/* Row 4: bottom — date + pieces + value */}
        <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-50">
          <div>
            <p className="text-[10px] text-outline">{formatDate(o.created_at)}</p>
            {o.total_pieces > 0 && (
              <p className="text-[10px] text-outline/70">{o.total_pieces} peças</p>
            )}
          </div>
          <p className="text-[15px] font-bold text-on-surface">{formatCurrency(o.total_value)}</p>
        </div>
      </div>
    </div>
  )
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
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)

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
  })

  const colDefs = ALL_COL_DEFS.filter(c => c.id !== 'rep' || isAdmin)
  const { orderedDefs, config, save, reset } = useColumnConfig('orders', colDefs)
  const visibleCols = orderedDefs.filter(c => c.visible)

  const total = orders?.length || 0

  return (
    <div className="flex flex-col h-full">

      {/* ══ MOBILE VIEW ══════════════════════════════════════════════════════ */}
      <div className="lg:hidden flex flex-col h-full" style={{ background: '#F5F3FF' }}>

        {/* Mobile header */}
        <div className="px-4 pt-5 pb-3 bg-white" style={{ boxShadow: '0 1px 0 #E5E7EB' }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-[18px] font-bold text-on-surface" style={{ fontFamily: 'Plus Jakarta Sans' }}>Pedidos</h2>
              <p className="text-[11px] text-outline mt-0.5">
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
              className="w-full h-11 pl-10 pr-4 bg-surface-container-low border border-outline-variant/40 rounded-2xl text-[11px] focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition-all"
            />
          </div>
        </div>

        {/* Status filter chips */}
        {statuses && statuses.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 py-2.5 bg-white border-b border-gray-100 scrollbar-hide">
            <button
              onClick={() => setStatusFilter('')}
              className={`flex-shrink-0 px-3.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide transition-all ${
                statusFilter === '' ? 'bg-primary text-white shadow-md shadow-primary/30' : 'bg-surface-container text-on-surface-variant'
              }`}
            >
              Todos
            </button>
            {statuses.map(s => (
              <button
                key={s.id}
                onClick={() => setStatusFilter(statusFilter === s.id ? '' : s.id)}
                className="flex-shrink-0 px-3.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide transition-all"
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
              <p className="text-[13px] font-semibold text-on-surface">Nenhum pedido encontrado</p>
              <p className="text-[11px] text-outline mt-1">
                {search || statusFilter ? 'Tente ajustar os filtros.' : 'Crie o primeiro pedido.'}
              </p>
            </div>
          ) : (
            <div className="px-4 pt-3 pb-28 space-y-2.5">
              {(orders || []).map(o => (
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
        <div className="px-8 pt-5 pb-3 border-b border-outline-variant bg-white">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="font-display text-lg font-bold text-on-surface">Pedidos</h1>
              <p className="text-[12px] text-on-surface-variant">
                {isLoading ? 'Carregando…' : `${total} pedido${total !== 1 ? 's' : ''}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ColumnConfigButton defs={colDefs} config={config} onSave={save} onReset={reset} />
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
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="border border-outline-variant rounded-lg px-3 py-1 text-xs text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white" />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="border border-outline-variant rounded-lg px-3 py-1 text-xs text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white" />
            </div>
          )}
        </div>

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
              {search || statusFilter || factoryFilter ? 'Tente ajustar os filtros.' : 'Crie o primeiro pedido.'}
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
            <table className="w-full text-left">
              <thead className="bg-surface-container-low border-b border-outline-variant sticky top-0 z-10">
                <tr>
                  {visibleCols.map(col => <OrderHeader key={col.id} id={col.id} label={col.label} />)}
                </tr>
              </thead>
              <tbody className="bg-white">
                {(orders || []).map(o => (
                  <tr
                    key={o.id}
                    className="border-b border-outline-variant/50 hover:bg-primary/5 cursor-pointer transition-colors"
                    onClick={() => navigate(`/orders/${o.id}`)}
                  >
                    {visibleCols.map(col => <OrderCell key={col.id} id={col.id} o={o} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
