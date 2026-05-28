import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart, TrendingUp, Clock, CheckCircle, ArrowRight, Package } from 'lucide-react'
import { ordersApi, statusesApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { StatusBadge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import { formatCurrency, formatDate, formatOrderNumber } from '../utils/format'

interface Order {
  id: string; order_number: number; client_name: string; factory_name: string
  total_value: number; total_pieces: number; status_name: string
  status_color: string; status_id: string; created_at: string; rep_name: string
}
interface Status { id: string; name: string; color: string }

export function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const { data: orders, isLoading } = useQuery<Order[]>({
    queryKey: ['orders'],
    queryFn: () => ordersApi.list().then(r => r.data),
  })
  const { data: statuses } = useQuery<Status[]>({
    queryKey: ['statuses'],
    queryFn: () => statusesApi.list().then(r => r.data),
  })

  if (isLoading) return <PageSpinner />

  const allOrders = orders || []
  const today = new Date().toISOString().split('T')[0]
  const todayOrders = allOrders.filter(o => o.created_at.startsWith(today))
  const recentOrders = allOrders.slice(0, 8)
  const statusCounts = (statuses || []).map(s => ({
    ...s, count: allOrders.filter(o => o.status_id === s.id).length,
  }))
  const totalValue = allOrders.reduce((s, o) => s + Number(o.total_value), 0)
  const todayValue = todayOrders.reduce((s, o) => s + Number(o.total_value), 0)

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  return (
    <div className="pb-28 lg:pb-8">

      {/* ─── Page header ─────────────────────────────────────── */}
      <div className="px-5 pt-6 pb-5 lg:px-8 lg:pt-8">
        <p className="text-[12px] text-on-surface-variant">{greeting()},</p>
        <h1 className="font-display text-[24px] font-bold text-on-surface leading-tight mt-0.5">{user?.name}</h1>
        <p className="text-[12px] text-outline mt-1">
          {isAdmin ? 'Administrador' : 'Representante'} &bull;{' '}
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* ─── Stats — scroll horizontal no mobile, grid no desktop ─ */}
      <div className="flex overflow-x-auto gap-3 px-5 lg:px-8 snap-x snap-mandatory scrollbar-hide
                      lg:grid lg:overflow-visible lg:snap-none
                      lg:grid-cols-4">

        {/* Card 1 — Total Pedidos (destacado / azul no mobile) */}
        <div className="flex-none w-[240px] snap-center lg:w-auto
                        bg-primary rounded-2xl p-5 shadow-md shadow-primary/20 text-white">
          <div className="flex items-center justify-between mb-4">
            <span className="p-2 bg-white/20 rounded-lg"><ShoppingCart className="h-5 w-5" /></span>
          </div>
          <p className="text-[10px] font-bold uppercase opacity-70 mb-1">Total Pedidos</p>
          <p className="font-display text-[36px] font-bold leading-none">{allOrders.length}</p>
        </div>

        {/* Card 2 — Hoje */}
        <div className="flex-none w-[240px] snap-center lg:w-auto
                        bg-white rounded-2xl border border-outline-variant p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="p-2 bg-emerald-100 rounded-lg text-emerald-600"><Clock className="h-5 w-5" /></span>
            <span className="text-[10px] font-bold text-on-surface-variant">Hoje</span>
          </div>
          <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Pedidos Hoje</p>
          <p className="font-display text-[36px] font-bold text-on-surface leading-none">{todayOrders.length}</p>
        </div>

        {isAdmin && <>
          {/* Card 3 — Total */}
          <div className="flex-none w-[240px] snap-center lg:w-auto
                          bg-white rounded-2xl border border-outline-variant p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="p-2 bg-purple-100 rounded-lg text-purple-600"><TrendingUp className="h-5 w-5" /></span>
            </div>
            <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Faturado Total</p>
            <p className="font-display text-[26px] font-bold text-on-surface leading-none">{formatCurrency(totalValue)}</p>
          </div>

          {/* Card 4 — Hoje R$ */}
          <div className="flex-none w-[240px] snap-center lg:w-auto
                          bg-white rounded-2xl border border-outline-variant p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="p-2 bg-amber-100 rounded-lg text-amber-600"><CheckCircle className="h-5 w-5" /></span>
            </div>
            <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Hoje (R$)</p>
            <p className="font-display text-[26px] font-bold text-on-surface leading-none">{formatCurrency(todayValue)}</p>
          </div>
        </>}
      </div>

      <div className="px-4 lg:px-8 mt-6 space-y-6">

        {/* ─── Status breakdown ───────────────────────────────── */}
        {statusCounts.length > 0 && (
          <div>
            <h2 className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-2.5">Por Status</h2>
            <div className="flex flex-wrap gap-2">
              {statusCounts.map(s => (
                <button
                  key={s.id}
                  onClick={() => navigate(`/orders?status_id=${s.id}`)}
                  className="flex items-center gap-2 bg-white border border-outline-variant rounded-xl px-3 py-2 hover:border-primary/30 hover:shadow-sm transition-all"
                >
                  <StatusBadge name={s.name} color={s.color} />
                  <span className="text-[13px] font-bold text-on-surface">{s.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── Recent orders ─────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Pedidos Recentes</h2>
            <button onClick={() => navigate('/orders')} className="text-[12px] text-primary font-semibold flex items-center gap-1 hover:underline">
              Ver todos <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {recentOrders.length === 0 ? (
            <div className="bg-white rounded-2xl border border-outline-variant shadow-sm p-8 flex flex-col items-center text-center">
              <div className="w-14 h-14 bg-surface-container rounded-2xl flex items-center justify-center mb-3">
                <Package className="h-7 w-7 text-outline" />
              </div>
              <p className="text-[14px] text-on-surface-variant font-medium">Nenhum pedido ainda</p>
              <button onClick={() => navigate('/orders/new')} className="mt-3 text-[13px] text-primary font-medium hover:underline">
                Criar primeiro pedido
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-outline-variant shadow-sm overflow-hidden divide-y divide-outline-variant/40">
              {recentOrders.map(order => (
                <div
                  key={order.id}
                  onClick={() => navigate(`/orders/${order.id}`)}
                  className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-container-low active:bg-surface-container cursor-pointer transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <ShoppingCart className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-primary font-mono">{formatOrderNumber(order.order_number)}</span>
                      <span className="text-outline text-[12px]">·</span>
                      <span className="text-[13px] font-semibold text-on-surface truncate">{order.client_name}</span>
                    </div>
                    <p className="text-[11px] text-outline truncate">{order.factory_name} · {formatDate(order.created_at)}</p>
                  </div>
                  <div className="flex-shrink-0 text-right space-y-1">
                    {order.status_name && <StatusBadge name={order.status_name} color={order.status_color || '#737686'} />}
                    <p className="text-[12px] font-bold text-on-surface">{formatCurrency(order.total_value)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
