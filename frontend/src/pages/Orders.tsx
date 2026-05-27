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
  Building2,
} from 'lucide-react'
import { ordersApi, statusesApi, factoriesApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { Input, Select } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { StatusBadge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
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

  const statusOptions = (statuses || []).map((s) => ({ value: s.id, label: s.name }))
  const factoryOptions = (factories || []).map((f) => ({ value: f.id, label: f.name }))

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-5 py-4 lg:px-8 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex-1">
              <Input
                placeholder="Buscar cliente ou nº pedido..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leftIcon={<Search className="h-4 w-4" />}
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 px-3 py-2.5 border border-gray-300 rounded-lg bg-white"
            >
              <Filter className="h-4 w-4" />
              {showFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-2 gap-2 mb-1">
              <Select
                options={statusOptions}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                placeholder="Todos os status"
                label="Status"
              />
              <Select
                options={factoryOptions}
                value={factoryFilter}
                onChange={(e) => setFactoryFilter(e.target.value)}
                placeholder="Todas as fábricas"
                label="Fábrica"
              />
              <Input
                label="Data início"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <Input
                label="Data fim"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-5 lg:px-8 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold text-gray-900">Pedidos</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{orders?.length || 0} pedidos</span>
            <Button
              onClick={() => navigate('/orders/new')}
              icon={<PlusCircle className="h-4 w-4" />}
              size="sm"
            >
              Novo
            </Button>
          </div>
        </div>

        {isLoading ? (
          <PageSpinner />
        ) : !orders?.length ? (
          <EmptyState
            icon={<ShoppingCart className="h-8 w-8" />}
            title="Nenhum pedido encontrado"
            description={search || statusFilter || factoryFilter ? 'Tente ajustar os filtros.' : 'Crie o primeiro pedido.'}
            action={
              <Button onClick={() => navigate('/orders/new')} icon={<PlusCircle className="h-4 w-4" />}>
                Criar Pedido
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Card key={o.id} padding="md" onClick={() => navigate(`/orders/${o.id}`)}>
                <div className="flex items-start gap-3">
                  {/* Order number */}
                  <div className="flex-shrink-0 text-center min-w-[44px]">
                    <p className="text-xs font-bold text-indigo-600">
                      {formatOrderNumber(o.order_number)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(o.created_at)}</p>
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{o.client_name}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Building2 className="h-3 w-3" />
                        {o.factory_name}
                      </span>
                      {o.client_city && (
                        <span className="text-xs text-gray-400">{o.client_city}</span>
                      )}
                    </div>
                    {isAdmin && (
                      <p className="text-xs text-gray-400 mt-0.5">Rep: {o.rep_name}</p>
                    )}
                  </div>

                  {/* Right side */}
                  <div className="flex-shrink-0 text-right space-y-1">
                    {o.status_name && o.status_color ? (
                      <StatusBadge name={o.status_name} color={o.status_color} />
                    ) : (
                      <span className="text-xs text-gray-400">Sem status</span>
                    )}
                    <p className="text-sm font-bold text-gray-900">{formatCurrency(o.total_value)}</p>
                    <p className="text-xs text-gray-400">{o.total_pieces} pç</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
