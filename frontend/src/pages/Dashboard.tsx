import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart, TrendingUp, Clock, CheckCircle, ArrowRight, Package, Plus } from 'lucide-react'
import { ordersApi, statusesApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
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
    <div className="pb-28 lg:pb-10 min-h-full">

      {/* ─── Hero header ─────────────────────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#2E1065] via-[#4C1D95] to-[#6D28D9] px-5 pt-8 pb-10 lg:px-8 lg:pt-10 lg:pb-12">
        {/* decorative blobs */}
        <div className="absolute -top-10 -right-10 w-52 h-52 bg-white/10 rounded-full pointer-events-none" />
        <div className="absolute top-8 right-20 w-28 h-28 bg-white/5 rounded-full pointer-events-none" />
        <div className="absolute -bottom-6 left-1/3 w-36 h-36 bg-white/5 rounded-full pointer-events-none" />

        <p className="text-white/70 text-xs font-medium">{greeting()},</p>
        <h1 className="font-display text-[32px] font-bold text-white leading-tight mt-0.5">{user?.name}</h1>
        <p className="text-white/60 text-xs mt-1.5">
          {isAdmin ? 'Administrador' : 'Representante'} &bull;{' '}
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>

        {/* FAB new order (desktop) */}
        <button
          onClick={() => navigate('/orders/new')}
          className="hidden lg:flex absolute top-8 right-8 items-center gap-2 bg-white/15 hover:bg-white/25 text-white text-xs font-semibold px-4 py-2 rounded-xl border border-white/20 transition-all backdrop-blur-sm"
        >
          <Plus className="h-4 w-4" /> Novo pedido
        </button>
      </div>

      {/* ─── Stat cards — overlap hero ──────────────────── */}
      <div className="px-4 lg:px-8 -mt-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">

          <StatCard
            icon={<ShoppingCart className="h-4.5 w-4.5 text-blue-600" />}
            iconBg="bg-blue-100"
            label="Total de pedidos"
            value={allOrders.length.toString()}
            accentColor="#3B82F6"
            large
          />

          <StatCard
            icon={<Clock className="h-4.5 w-4.5 text-emerald-600" />}
            iconBg="bg-emerald-100"
            label="Pedidos hoje"
            value={todayOrders.length.toString()}
            badge="HOJE"
            badgeColor="emerald"
            accentColor="#10B981"
            large
          />

          {isAdmin && (
            <StatCard
              icon={<TrendingUp className="h-4.5 w-4.5 text-violet-600" />}
              iconBg="bg-violet-100"
              label="Total faturado"
              value={formatCurrency(totalValue)}
              accentColor="#7C3AED"
            />
          )}

          {isAdmin && (
            <StatCard
              icon={<CheckCircle className="h-4.5 w-4.5 text-amber-600" />}
              iconBg="bg-amber-100"
              label="Faturado hoje"
              value={formatCurrency(todayValue)}
              badge="HOJE"
              badgeColor="amber"
              accentColor="#F59E0B"
            />
          )}
        </div>
      </div>

      <div className="px-4 lg:px-8 mt-5 space-y-5">

        {/* ─── Pipeline por status ──────────────────────── */}
        {statusCounts.length > 0 && (
          <section>
            <SectionTitle>Pipeline de Pedidos</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {statusCounts.map(s => (
                <button
                  key={s.id}
                  onClick={() => navigate(`/orders?status_id=${s.id}`)}
                  className="bg-white rounded-2xl p-4 text-left border border-outline-variant/40 hover:shadow-md hover:border-primary/20 active:scale-[0.98] transition-all group"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-[12px] font-semibold text-outline group-hover:text-on-surface transition-colors truncate">{s.name}</span>
                  </div>
                  <p className="font-display text-[36px] font-bold text-on-surface leading-none">{s.count}</p>
                  <p className="text-[11px] text-outline mt-1">pedido{s.count !== 1 ? 's' : ''}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ─── Pedidos recentes ────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <SectionTitle className="mb-0">Pedidos Recentes</SectionTitle>
            <button
              onClick={() => navigate('/orders')}
              className="text-[12px] text-primary font-semibold flex items-center gap-1 hover:gap-1.5 transition-all"
            >
              Ver todos <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {recentOrders.length === 0 ? (
            <div className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm p-10 flex flex-col items-center text-center">
              <div className="w-14 h-14 bg-surface-container rounded-2xl flex items-center justify-center mb-3">
                <Package className="h-7 w-7 text-outline" />
              </div>
              <p className="text-xs text-on-surface-variant font-medium">Nenhum pedido ainda</p>
              <button
                onClick={() => navigate('/orders/new')}
                className="mt-3 text-xs text-primary font-semibold hover:underline"
              >
                Criar primeiro pedido →
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm overflow-hidden">
              {recentOrders.map((order, idx) => (
                <div
                  key={order.id}
                  onClick={() => navigate(`/orders/${order.id}`)}
                  className={`flex items-center gap-3 px-4 py-3.5 hover:bg-blue-50/60 active:bg-blue-50 cursor-pointer transition-colors ${
                    idx > 0 ? 'border-t border-gray-50' : ''
                  }`}
                >
                  {/* Status bar */}
                  <div
                    className="w-1 h-10 rounded-full flex-shrink-0"
                    style={{ backgroundColor: order.status_color || '#c3c6d7' }}
                  />

                  <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
                    <ShoppingCart className="h-[17px] w-[17px] text-primary" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[12px] font-bold text-primary font-mono">{formatOrderNumber(order.order_number)}</span>
                      <span className="text-outline/40">·</span>
                      <span className="text-xs font-semibold text-on-surface truncate">{order.client_name}</span>
                    </div>
                    <p className="text-[12px] text-outline truncate">{order.factory_name} · {formatDate(order.created_at)}</p>
                  </div>

                  <div className="flex-shrink-0 text-right space-y-1">
                    {order.status_name && (
                      <span
                        className="inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: (order.status_color || '#737686') + '22',
                          color: order.status_color || '#737686',
                        }}
                      >
                        {order.status_name}
                      </span>
                    )}
                    <p className="text-xs font-bold text-on-surface">{formatCurrency(order.total_value)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  icon, iconBg, label, value, badge, badgeColor, large, accentColor,
}: {
  icon: React.ReactNode
  iconBg: string
  label: string
  value: string
  badge?: string
  badgeColor?: 'emerald' | 'amber'
  large?: boolean
  accentColor?: string
}) {
  const badgeCls = badgeColor === 'emerald'
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-amber-100 text-amber-700'

  return (
    <div
      className="bg-white rounded-2xl p-4 border-0 relative overflow-hidden"
      style={{
        boxShadow: accentColor
          ? `0 10px 28px -6px ${accentColor}35, 0 4px 10px -4px ${accentColor}20`
          : '0 8px 24px -4px rgba(0,0,0,0.10)',
      }}
    >
      {/* colored top accent bar */}
      {accentColor && (
        <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl" style={{ background: accentColor }} />
      )}
      <div className="flex items-center justify-between mb-3 mt-1">
        <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center`}>
          {icon}
        </div>
        {badge && (
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${badgeCls}`}>
            {badge}
          </span>
        )}
      </div>
      <p className="text-[11px] font-bold uppercase text-outline tracking-wide mb-1.5">{label}</p>
      <p className={`font-display font-bold text-on-surface leading-none ${large ? 'text-[38px]' : 'text-[28px]'}`}>
        {value}
      </p>
    </div>
  )
}

function SectionTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`text-xs font-bold text-outline uppercase tracking-wider mb-3 ${className}`}>
      {children}
    </h2>
  )
}
