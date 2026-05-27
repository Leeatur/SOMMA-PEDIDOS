import { useState, ReactNode } from 'react'
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
  client_city: string | null
  factory_name: string
  price_table_name: string
  rep_name: string
  total_value: number
  total_pieces: number
  discount_pct: number
  status_id: string | null
  status_name: string | null
  status_color: string | null
  created_at: string
}

interface Status { id: string; name: string; color: string }
interface Factory { id: string; name: string }

// ─── Column definitions ───────────────────────────────────────────────────────

const ALL_COL_DEFS: ColumnDef[] = [
  { id: 'date',     label: 'Data' },
  { id: 'number',   label: 'Nº Pedido',   alwaysVisible: true },
  { id: 'client',   label: 'Cliente',     alwaysVisible: true },
  { id: 'city',     label: 'Cidade' },
  { id: 'factory',  label: 'Fábrica' },
  { id: 'table',    label: 'Tabela',      defaultVisible: false },
  { id: 'rep',      label: 'Vendedor' },
  { id: 'items',    label: 'Itens (pç)' },
  { id: 'value',    label: 'Valor' },
  { id: 'discount', label: 'Desconto',    defaultVisible: false },
  { id: 'status',   label: 'Status' },
]

// Column header meta (alignment / width)
const COL_META: Record<string, { align?: string; width?: string }> = {
  date:     { width: 'w-16' },
  number:   { width: 'w-20' },
  items:    { align: 'text-center', width: 'w-16' },
  value:    { align: 'text-right',  width: 'w-28' },
  discount: { align: 'text-right',  width: 'w-20' },
  status:   { width: 'w-36' },
}

function OrderHeader({ id, label }: { id: string; label: string }) {
  const meta = COL_META[id] || {}
  return (
    <th
      className={`px-2 py-2 text-xs font-semibold text-gray-500 first:pl-3 last:pr-3 ${meta.width ?? ''} ${meta.align ?? ''}`}
    >
      {label}
    </th>
  )
}

function OrderCell({ id, o }: { id: string; o: Order }) {
  switch (id) {
    case 'date':
      return (
        <td className="pl-3 pr-2 py-2.5 whitespace-nowrap">
          <span className="text-xs text-gray-500">{formatDate(o.created_at)}</span>
        </td>
      )
    case 'number':
      return (
        <td className="px-2 py-2.5 whitespace-nowrap first:pl-3">
          <span className="text-xs font-bold text-indigo-600">{formatOrderNumber(o.order_number)}</span>
        </td>
      )
    case 'client':
      return (
        <td className="px-2 py-2.5 max-w-[200px]">
          <p className="text-sm font-semibold text-gray-900 truncate leading-tight">{o.client_name}</p>
        </td>
      )
    case 'city':
      return (
        <td className="px-2 py-2.5 max-w-[130px]">
          <span className="text-xs text-gray-600 truncate block">{o.client_city || '—'}</span>
        </td>
      )
    case 'factory':
      return (
        <td className="px-2 py-2.5 max-w-[140px]">
          <span className="text-xs text-gray-600 truncate block">{o.factory_name}</span>
        </td>
      )
    case 'table':
      return (
        <td className="px-2 py-2.5 max-w-[150px]">
          <span className="text-xs text-gray-400 truncate block">{o.price_table_name}</span>
        </td>
      )
    case 'rep':
      return (
        <td className="px-2 py-2.5 max-w-[120px]">
          <span className="text-xs text-gray-500 truncate block">{o.rep_name || '—'}</span>
        </td>
      )
    case 'items':
      return (
        <td className="px-2 py-2.5 text-center">
          <span className="text-xs font-medium text-gray-700">
            {o.total_pieces > 0 ? o.total_pieces : '—'}
          </span>
        </td>
      )
    case 'value':
      return (
        <td className="px-2 py-2.5 text-right whitespace-nowrap">
          <span className="text-sm font-bold text-gray-900">{formatCurrency(o.total_value)}</span>
        </td>
      )
    case 'discount':
      return (
        <td className="px-2 py-2.5 text-right whitespace-nowrap last:pr-3">
          {o.discount_pct > 0
            ? <span className="text-xs font-semibold text-emerald-600">-{o.discount_pct}%</span>
            : <span className="text-xs text-gray-300">—</span>}
        </td>
      )
    case 'status':
      return (
        <td className="px-2 pr-3 py-2.5">
          {o.status_name && o.status_color ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: o.status_color }}
              />
              <span className="text-xs font-medium text-gray-700 truncate">{o.status_name}</span>
            </div>
          ) : (
            <span className="text-xs text-gray-300">—</span>
          )}
        </td>
      )
    default:
      return <td className="px-2 py-2.5" />
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

  // Column config — exclude admin-only col if not admin
  const colDefs = ALL_COL_DEFS.filter(c => c.id !== 'rep' || isAdmin)
  const { orderedDefs, config, save, reset } = useColumnConfig('orders', colDefs)
  const visibleCols = orderedDefs.filter(c => c.visible)

  const total = orders?.length || 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 lg:px-6 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Pedidos</h1>
            <p className="text-xs text-gray-500">
              {isLoading ? 'Carregando…' : `${total} pedido${total !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ColumnConfigButton
              defs={colDefs}
              config={config}
              onSave={save}
              onReset={reset}
            />
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1 text-sm px-3 py-2 border rounded-lg transition-colors ${
                showFilters || statusFilter || factoryFilter || dateFrom || dateTo
                  ? 'text-indigo-600 border-indigo-300 bg-indigo-50'
                  : 'text-gray-500 border-gray-300 bg-white hover:text-gray-700'
              }`}
            >
              <Filter className="h-4 w-4" />
              {showFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            <Button
              onClick={() => navigate('/orders/new')}
              icon={<PlusCircle className="h-4 w-4" />}
              size="sm"
            >
              Novo
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              placeholder="Buscar cliente, nº pedido, cidade..."
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
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">Todos os status</option>
              {(statuses || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select
              value={factoryFilter}
              onChange={(e) => setFactoryFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">Todas as fábricas</option>
              {(factories || []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
          </div>
        )}
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center"><PageSpinner /></div>
      ) : total === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShoppingCart className="h-8 w-8 text-gray-300" />
          </div>
          <p className="text-gray-500 font-medium">Nenhum pedido encontrado</p>
          <p className="text-sm text-gray-400 mt-1">
            {search || statusFilter || factoryFilter ? 'Tente ajustar os filtros.' : 'Crie o primeiro pedido.'}
          </p>
          <button
            onClick={() => navigate('/orders/new')}
            className="mt-4 flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <PlusCircle className="h-4 w-4" /> Criar Pedido
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              <tr>
                {visibleCols.map(col => (
                  <OrderHeader key={col.id} id={col.id} label={col.label} />
                ))}
              </tr>
            </thead>
            <tbody className="bg-white">
              {(orders || []).map(o => (
                <tr
                  key={o.id}
                  className="border-b border-gray-100 hover:bg-indigo-50/40 cursor-pointer transition-colors"
                  onClick={() => navigate(`/orders/${o.id}`)}
                >
                  {visibleCols.map(col => (
                    <OrderCell key={col.id} id={col.id} o={o} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
