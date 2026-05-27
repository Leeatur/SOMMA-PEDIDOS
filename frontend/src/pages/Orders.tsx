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

function StatusDot({ name, color }: { name: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-white"
        style={{ backgroundColor: color }}
      />
      <span className="text-xs font-medium text-gray-700 truncate">{name}</span>
    </div>
  )
}

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
              {(statuses || []).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select
              value={factoryFilter}
              onChange={(e) => setFactoryFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">Todas as fábricas</option>
              {(factories || []).map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
          </div>
        )}
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <PageSpinner />
        </div>
      ) : total === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShoppingCart className="h-8 w-8 text-gray-300" />
          </div>
          <p className="text-gray-500 font-medium">Nenhum pedido encontrado</p>
          <p className="text-sm text-gray-400 mt-1">
            {search || statusFilter || factoryFilter
              ? 'Tente ajustar os filtros.'
              : 'Crie o primeiro pedido.'}
          </p>
          <button
            onClick={() => navigate('/orders/new')}
            className="mt-4 flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <PlusCircle className="h-4 w-4" />
            Criar Pedido
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="pl-3 pr-2 py-2 text-xs font-semibold text-gray-500 w-16">Data</th>
                <th className="px-2 py-2 text-xs font-semibold text-gray-500 w-20">Nº</th>
                <th className="px-2 py-2 text-xs font-semibold text-gray-500">Cliente</th>
                <th className="px-2 py-2 text-xs font-semibold text-gray-500 hidden sm:table-cell">Cidade</th>
                <th className="px-2 py-2 text-xs font-semibold text-gray-500 hidden md:table-cell">Fábrica</th>
                {isAdmin && (
                  <th className="px-2 py-2 text-xs font-semibold text-gray-500 hidden lg:table-cell">Vendedor</th>
                )}
                <th className="px-2 py-2 text-xs font-semibold text-gray-500 text-center hidden sm:table-cell w-14">Itens</th>
                <th className="px-2 py-2 text-xs font-semibold text-gray-500 text-right w-28">Valor</th>
                <th className="px-2 pr-3 py-2 text-xs font-semibold text-gray-500 w-36">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {(orders || []).map(o => (
                <tr
                  key={o.id}
                  className="border-b border-gray-100 hover:bg-indigo-50/40 cursor-pointer transition-colors"
                  onClick={() => navigate(`/orders/${o.id}`)}
                >
                  {/* Data */}
                  <td className="pl-3 pr-2 py-2.5 whitespace-nowrap">
                    <span className="text-xs text-gray-500">{formatDate(o.created_at)}</span>
                  </td>

                  {/* Nº */}
                  <td className="px-2 py-2.5 whitespace-nowrap">
                    <span className="text-xs font-bold text-indigo-600">{formatOrderNumber(o.order_number)}</span>
                  </td>

                  {/* Cliente */}
                  <td className="px-2 py-2.5 max-w-[200px]">
                    <p className="text-sm font-semibold text-gray-900 truncate leading-tight">{o.client_name}</p>
                    {/* Mobile: mostra cidade embaixo */}
                    <p className="text-xs text-gray-400 truncate sm:hidden">{o.client_city || ''}</p>
                  </td>

                  {/* Cidade */}
                  <td className="px-2 py-2.5 hidden sm:table-cell max-w-[120px]">
                    <span className="text-xs text-gray-600 truncate block">{o.client_city || '—'}</span>
                  </td>

                  {/* Fábrica */}
                  <td className="px-2 py-2.5 hidden md:table-cell max-w-[130px]">
                    <span className="text-xs text-gray-600 truncate block">{o.factory_name}</span>
                    <span className="text-[10px] text-gray-400 truncate block">{o.price_table_name}</span>
                  </td>

                  {/* Vendedor — admin */}
                  {isAdmin && (
                    <td className="px-2 py-2.5 hidden lg:table-cell max-w-[120px]">
                      <span className="text-xs text-gray-500 truncate block">{o.rep_name || '—'}</span>
                    </td>
                  )}

                  {/* Itens (peças) */}
                  <td className="px-2 py-2.5 text-center hidden sm:table-cell">
                    <span className="text-xs font-medium text-gray-700">
                      {o.total_pieces > 0 ? o.total_pieces : '—'}
                    </span>
                    {o.total_pieces > 0 && (
                      <span className="text-[10px] text-gray-400 block">pç</span>
                    )}
                  </td>

                  {/* Valor */}
                  <td className="px-2 py-2.5 text-right whitespace-nowrap">
                    <span className="text-sm font-bold text-gray-900">{formatCurrency(o.total_value)}</span>
                    {o.discount_pct > 0 && (
                      <span className="text-[10px] text-emerald-500 block text-right">-{o.discount_pct}% desc</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-2 pr-3 py-2.5">
                    {o.status_name && o.status_color ? (
                      <StatusDot name={o.status_name} color={o.status_color} />
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
