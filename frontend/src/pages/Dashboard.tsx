import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart, TrendingUp, Clock, CheckCircle, Package, Plus } from 'lucide-react'
import { ordersApi, reportsApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { PageSpinner } from '../components/ui/Spinner'
import { formatCurrency } from '../utils/format'

interface Order {
  id: string; order_number: number; client_name: string; factory_name: string
  total_value: number; total_pieces: number; status_name: string
  status_color: string; status_id: string; created_at: string; rep_name: string
}

interface DaySaleRow {
  id: string
  order_number: number
  data_venda: string
  vendedor: string
  industria: string
  razao_social: string
  cliente: string | null
  cidade: string | null
  uf: string | null
  total_pieces: number
  total_value: number
  rep_commission_value: number
  office_commission_value: number
}

export function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const today = new Date().toISOString().split('T')[0]

  const { data: orders, isLoading } = useQuery<Order[]>({
    queryKey: ['orders'],
    queryFn: () => ordersApi.list().then(r => r.data),
  })

  const { data: todaysSales, isLoading: salesLoading } = useQuery<DaySaleRow[]>({
    queryKey: ['dashboard-today-sales', today],
    queryFn: () => reportsApi.commissions({ date_from: today, date_to: today }).then(r => r.data),
    enabled: isAdmin,
  })

  if (isLoading) return <PageSpinner />

  const allOrders = orders || []
  const todayOrders = allOrders.filter(o => o.created_at.startsWith(today))
  const totalValue = allOrders.reduce((s, o) => s + Number(o.total_value), 0)
  const todayValue = todayOrders.reduce((s, o) => s + Number(o.total_value), 0)

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  const fmtR = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)

  const sales = todaysSales || []
  const salesTotalPcs   = sales.reduce((s, r) => s + Number(r.total_pieces), 0)
  const salesTotalVal   = sales.reduce((s, r) => s + Number(r.total_value), 0)
  const salesTotalRepCom = sales.reduce((s, r) => s + Number(r.rep_commission_value), 0)
  const salesTotalEscCom = sales.reduce((s, r) => s + Number(r.office_commission_value), 0)

  return (
    <div className="pb-24 lg:pb-8 min-h-full">

      {/* ─── Hero header ─────────────────────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#2E1065] via-[#4C1D95] to-[#6D28D9] px-5 pt-6 pb-8 lg:px-8 lg:pt-8 lg:pb-10">
        <div className="absolute -top-10 -right-10 w-52 h-52 bg-white/10 rounded-full pointer-events-none" />
        <div className="absolute top-8 right-20 w-28 h-28 bg-white/5 rounded-full pointer-events-none" />
        <div className="absolute -bottom-6 left-1/3 w-36 h-36 bg-white/5 rounded-full pointer-events-none" />

        <p className="text-white/70 text-[12px] font-medium">{greeting()},</p>
        <h1 className="font-display text-[32px] font-bold text-white leading-tight mt-0.5">{user?.name}</h1>
        <p className="text-white/60 text-[12px] mt-1.5">
          {isAdmin ? 'Administrador' : 'Representante'} &bull;{' '}
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>

        <button
          onClick={() => navigate('/orders/new')}
          className="hidden lg:flex absolute top-8 right-8 items-center gap-2 bg-white/15 hover:bg-white/25 text-white text-[12px] font-semibold px-4 py-1 rounded-xl border border-white/20 transition-all backdrop-blur-sm"
        >
          <Plus className="h-4 w-4" /> Novo pedido
        </button>
      </div>

      {/* ─── Stat cards — overlap hero ──────────────────── */}
      <div className="px-4 lg:px-8 -mt-5">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">

          <StatCard
            icon={<ShoppingCart className="h-4.5 w-4.5 text-blue-600" />}
            iconBg="bg-blue-100"
            label="Total de pedidos"
            value={isAdmin ? allOrders.length.toString() : formatCurrency(totalValue)}
            accentColor="#3B82F6"
            large={isAdmin}
          />

          <StatCard
            icon={<Clock className="h-4.5 w-4.5 text-emerald-600" />}
            iconBg="bg-emerald-100"
            label="Pedidos hoje"
            value={isAdmin ? todayOrders.length.toString() : formatCurrency(todayValue)}
            badge="HOJE"
            badgeColor="emerald"
            accentColor="#10B981"
            large={isAdmin}
          />

          {isAdmin && (
            <StatCard
              icon={<TrendingUp className="h-4.5 w-4.5 text-violet-600" />}
              iconBg="bg-violet-100"
              label="Total vendas"
              value={formatCurrency(totalValue)}
              accentColor="#7C3AED"
            />
          )}

          {isAdmin && (
            <StatCard
              icon={<CheckCircle className="h-4.5 w-4.5 text-amber-600" />}
              iconBg="bg-amber-100"
              label="Vendido hoje"
              value={formatCurrency(todayValue)}
              badge="HOJE"
              badgeColor="amber"
              accentColor="#F59E0B"
            />
          )}
        </div>
      </div>

      <div className="px-4 lg:px-8 mt-3 space-y-3">

        {/* ─── Resumo de vendas do dia — admin only ────── */}
        {isAdmin && (
          <section>
            <SectionTitle>Resumo de Vendas do Dia</SectionTitle>
            {salesLoading ? (
              <div className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm p-6 flex justify-center">
                <PageSpinner />
              </div>
            ) : sales.length === 0 ? (
              <div className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm p-8 flex flex-col items-center text-center">
                <Package className="h-7 w-7 text-outline/40 mb-2" />
                <p className="text-[12px] text-outline/70 font-medium">Nenhuma venda registrada hoje</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-[12px]">
                    <thead className="bg-surface-container-low border-b border-outline-variant/50 sticky top-0">
                      <tr>
                        {[
                          'Data','Representante','Marca','Razão Social','Cliente',
                          'Cidade','UF','Qt. Peças','Valor Pedido',
                          'Com. Rep (R$)','Com. Escr (R$)',
                        ].map(h => (
                          <th key={h} className="px-3 py-1.5 text-left font-semibold text-outline whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {sales.map(r => (
                        <tr
                          key={r.id}
                          onClick={() => navigate(`/orders/${r.id}`)}
                          className="hover:bg-primary/5 cursor-pointer transition-colors"
                        >
                          <td className="px-3 py-1.5 whitespace-nowrap text-outline/70">
                            {(() => { const s = String(r.data_venda).substring(0,10); const [y,m,d] = s.split('-'); return `${d}/${m}/${y}` })()}
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap font-semibold text-primary">
                            {r.vendedor}
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap font-medium text-on-surface">
                            {r.industria}
                          </td>
                          <td className="px-3 py-1.5 max-w-[160px]">
                            <span className="block truncate font-medium text-on-surface" title={r.razao_social}>
                              {r.razao_social}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 max-w-[130px]">
                            <span className="block truncate text-on-surface-variant" title={r.cliente || ''}>
                              {r.cliente || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap text-on-surface-variant">
                            {r.cidade || '—'}
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap text-on-surface-variant">
                            {r.uf || '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap font-bold text-on-surface">
                            {Number(r.total_pieces).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap font-bold text-on-surface">
                            {fmtR(r.total_value)}
                          </td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap font-bold text-emerald-700">
                            {fmtR(r.rep_commission_value)}
                          </td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap font-bold text-blue-700">
                            {fmtR(r.office_commission_value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-surface-container-low border-t-2 border-outline-variant font-bold text-[12px]">
                        <td colSpan={7} className="px-3 py-1.5 text-on-surface-variant">
                          {sales.length} pedido{sales.length !== 1 ? 's' : ''}
                        </td>
                        <td className="px-3 py-1.5 text-right text-on-surface">
                          {salesTotalPcs.toLocaleString('pt-BR')}
                        </td>
                        <td className="px-3 py-1.5 text-right text-on-surface">
                          {fmtR(salesTotalVal)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-emerald-700">
                          {fmtR(salesTotalRepCom)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-blue-700">
                          {fmtR(salesTotalEscCom)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

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
      className="bg-white rounded-2xl p-3 border-0 relative overflow-hidden"
      style={{
        boxShadow: accentColor
          ? `0 10px 28px -6px ${accentColor}35, 0 4px 10px -4px ${accentColor}20`
          : '0 8px 24px -4px rgba(0,0,0,0.10)',
      }}
    >
      {accentColor && (
        <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl" style={{ background: accentColor }} />
      )}
      <div className="flex items-center justify-between mb-2 mt-0.5">
        <div className={`w-9 h-9 ${iconBg} rounded-xl flex items-center justify-center`}>
          {icon}
        </div>
        {badge && (
          <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full ${badgeCls}`}>
            {badge}
          </span>
        )}
      </div>
      <p className="text-[12px] font-bold uppercase text-outline tracking-wide mb-1.5">{label}</p>
      <p className={`font-display font-bold text-on-surface leading-none ${large ? 'text-[38px]' : 'text-[28px]'}`}>
        {value}
      </p>
    </div>
  )
}

function SectionTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`text-[12px] font-bold text-outline uppercase tracking-wider mb-2 ${className}`}>
      {children}
    </h2>
  )
}
