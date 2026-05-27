import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ShoppingCart,
  TrendingUp,
  Clock,
  CheckCircle,
  ArrowRight,
  Package,
  PlusCircle,
} from 'lucide-react'
import { ordersApi } from '../api/client'
import { statusesApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { Card } from '../components/ui/Card'
import { StatusBadge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import { Button } from '../components/ui/Button'
import { formatCurrency, formatDate } from '../utils/format'

interface Order {
  id: string
  order_number: number
  client_name: string
  factory_name: string
  total_value: number
  total_pieces: number
  status_name: string
  status_color: string
  status_id: string
  created_at: string
  rep_name: string
}

interface Status {
  id: string
  name: string
  color: string
}

export function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const { data: orders, isLoading: loadingOrders } = useQuery<Order[]>({
    queryKey: ['orders'],
    queryFn: () => ordersApi.list().then((r) => r.data),
  })

  const { data: statuses } = useQuery<Status[]>({
    queryKey: ['statuses'],
    queryFn: () => statusesApi.list().then((r) => r.data),
  })

  if (loadingOrders) return <PageSpinner />

  const allOrders = orders || []
  const today = new Date().toISOString().split('T')[0]
  const todayOrders = allOrders.filter((o) => o.created_at.startsWith(today))
  const recentOrders = allOrders.slice(0, 8)

  // Count by status
  const statusCounts = (statuses || []).map((s) => ({
    ...s,
    count: allOrders.filter((o) => o.status_id === s.id).length,
  }))

  const totalValue = allOrders.reduce((sum, o) => sum + Number(o.total_value), 0)
  const todayValue = todayOrders.reduce((sum, o) => sum + Number(o.total_value), 0)

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-700 to-amber-500 px-5 py-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-amber-100 text-sm">{greeting()},</p>
          <h1 className="text-xl font-bold text-white">{user?.name}</h1>
          <p className="text-amber-200 text-xs mt-0.5">
            {isAdmin ? 'Administrador' : 'Representante'} &bull;{' '}
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      <div className="px-4 py-5 lg:px-8 max-w-5xl mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card className="col-span-1">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 font-medium">Total Pedidos</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{allOrders.length}</p>
              </div>
              <div className="p-2 bg-indigo-100 rounded-lg">
                <ShoppingCart className="h-5 w-5 text-indigo-500" />
              </div>
            </div>
          </Card>

          <Card className="col-span-1">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 font-medium">Hoje</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{todayOrders.length}</p>
              </div>
              <div className="p-2 bg-emerald-100 rounded-lg">
                <Clock className="h-5 w-5 text-emerald-600" />
              </div>
            </div>
          </Card>

          {isAdmin && (
            <>
              <Card className="col-span-1">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-gray-500 font-medium">Faturado Total</p>
                    <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(totalValue)}</p>
                  </div>
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <TrendingUp className="h-5 w-5 text-purple-600" />
                  </div>
                </div>
              </Card>

              <Card className="col-span-1">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-gray-500 font-medium">Hoje (R$)</p>
                    <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(todayValue)}</p>
                  </div>
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-amber-600" />
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>

        {/* Status breakdown */}
        {statusCounts.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Por Status</h2>
            <div className="flex flex-wrap gap-2">
              {statusCounts.map((s) => (
                <button
                  key={s.id}
                  onClick={() => navigate(`/orders?status_id=${s.id}`)}
                  className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 hover:shadow-sm transition-shadow"
                >
                  <StatusBadge name={s.name} color={s.color} />
                  <span className="text-sm font-bold text-gray-800">{s.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* New order CTA */}
        <Button
          onClick={() => navigate('/orders/new')}
          icon={<PlusCircle className="h-5 w-5" />}
          fullWidth
          size="lg"
        >
          Novo Pedido
        </Button>

        {/* Recent orders */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Pedidos Recentes</h2>
            <button
              onClick={() => navigate('/orders')}
              className="text-xs text-indigo-500 font-medium flex items-center gap-1"
            >
              Ver todos <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {recentOrders.length === 0 ? (
            <Card>
              <div className="flex flex-col items-center py-6 text-center">
                <Package className="h-8 w-8 text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">Nenhum pedido ainda</p>
                <button
                  onClick={() => navigate('/orders/new')}
                  className="mt-3 text-sm text-indigo-500 font-medium"
                >
                  Criar primeiro pedido
                </button>
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {recentOrders.map((order) => (
                <Card
                  key={order.id}
                  padding="sm"
                  onClick={() => navigate(`/orders/${order.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 text-center min-w-[48px]">
                      <p className="text-xs text-gray-400">#{String(order.order_number).padStart(4, '0')}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{order.client_name}</p>
                      <p className="text-xs text-gray-500 truncate">{order.factory_name}</p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      {order.status_name && (
                        <StatusBadge name={order.status_name} color={order.status_color || '#6B7280'} />
                      )}
                      <p className="text-xs text-gray-500 mt-1">{formatDate(order.created_at)}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
