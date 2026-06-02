import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart, TrendingUp, Clock, CheckCircle, Package, Plus, Users, Award, Target, Pencil, Trash2, X } from 'lucide-react'
import { ordersApi, reportsApi, goalsApi, factoriesApi, usersApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { PageSpinner } from '../components/ui/Spinner'
import { formatCurrency, formatOrderNumber } from '../utils/format'

interface Order {
  id: string; order_number: number; client_name: string; factory_name: string
  total_value: number; total_pieces: number; status_name: string
  status_color: string; status_id: string; created_at: string; rep_name: string
  rep_commission_value: number
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

interface Goal {
  id: string; type: 'factory'|'rep'; factory_id: string|null; rep_id: string|null
  label: string; target_pieces: number; period_label: string|null
  factory_name: string|null; rep_name: string|null; achieved_pieces: number
}

export function Dashboard() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const [showGoalModal, setShowGoalModal] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [goalForm, setGoalForm] = useState({ type: 'factory', factory_id: '', rep_id: '', label: '', target_pieces: '', period_label: '' })

  // Filtro de período
  const spDate = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(d)
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return spDate(d) }) // início do mês
  const [dateTo,   setDateTo]   = useState(() => spDate(new Date()))
  const [activePeriod, setActivePeriod] = useState('month')

  function setPeriod(p: string) {
    setActivePeriod(p)
    const now = new Date()
    if (p === 'today')  { setDateFrom(spDate(now)); setDateTo(spDate(now)) }
    if (p === '7d')     { const d=new Date(now); d.setDate(d.getDate()-6); setDateFrom(spDate(d)); setDateTo(spDate(now)) }
    if (p === '30d')    { const d=new Date(now); d.setDate(d.getDate()-29); setDateFrom(spDate(d)); setDateTo(spDate(now)) }
    if (p === 'month')  { const d=new Date(now); d.setDate(1); setDateFrom(spDate(d)); setDateTo(spDate(now)) }
    if (p === 'custom') { /* usuário digita nas caixas */ }
  }

  // Usa horário de Brasília (America/Sao_Paulo) para evitar bug de timezone UTC vs UTC-3
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date())

  const { data: orders, isLoading } = useQuery<Order[]>({
    queryKey: ['orders'],
    queryFn: () => ordersApi.list().then(r => r.data),
  })

  const { data: goals = [] } = useQuery<Goal[]>({
    queryKey: ['goals'],
    queryFn: () => goalsApi.list().then(r => r.data),
    // tanto admin quanto rep buscam metas (backend filtra o que cada um vê)
  })
  const { data: factories = [] } = useQuery<{id:string;name:string}[]>({
    queryKey: ['factories'],
    queryFn: () => factoriesApi.list().then(r => r.data),
    enabled: isAdmin,
  })
  const { data: repUsers = [] } = useQuery<{id:string;name:string;role:string}[]>({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
    enabled: isAdmin,
  })
  const reps = repUsers.filter(u => u.role !== 'admin')

  const createGoalMut = useMutation({
    mutationFn: (data: object) => editingGoal ? goalsApi.update(editingGoal.id, data) : goalsApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['goals'] }); setShowGoalModal(false); setEditingGoal(null) },
  })
  const deleteGoalMut = useMutation({
    mutationFn: (id: string) => goalsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })

  function openNewGoal() {
    setEditingGoal(null)
    setGoalForm({ type: 'factory', factory_id: '', rep_id: '', label: '', target_pieces: '', period_label: '' })
    setShowGoalModal(true)
  }
  function openEditGoal(g: Goal) {
    setEditingGoal(g)
    setGoalForm({ type: g.type, factory_id: g.factory_id||'', rep_id: g.rep_id||'', label: g.label, target_pieces: String(g.target_pieces), period_label: g.period_label||'' })
    setShowGoalModal(true)
  }

  const { data: todaysSales, isLoading: salesLoading } = useQuery<DaySaleRow[]>({
    queryKey: ['dashboard-today-sales', today],
    queryFn: () => reportsApi.commissions({ date_from: today, date_to: today }).then(r => r.data),
    enabled: isAdmin,
  })

  if (isLoading) return <PageSpinner />

  const allOrders = orders || []
  const todayOrders = allOrders.filter(o => {
    const d = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(o.created_at))
    return d === today
  })

  // Pedidos filtrados pelo período selecionado
  const filteredOrders = allOrders.filter(o => {
    const d = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(o.created_at))
    return d >= dateFrom && d <= dateTo
  })

  const totalValue  = filteredOrders.reduce((s, o) => s + Number(o.total_value), 0)
  const todayValue  = todayOrders.reduce((s, o) => s + Number(o.total_value), 0)

  // Métricas compartilhadas (baseadas no período filtrado)
  const totalPieces      = filteredOrders.reduce((s, o) => s + Number(o.total_pieces || 0), 0)
  const totalRepComm     = filteredOrders.reduce((s, o) => s + Number(o.rep_commission_value || 0), 0)
  const totalOfficeComm  = filteredOrders.reduce((s, o) => s + Number((o as Order & {office_commission_value?:number}).office_commission_value || 0), 0)
  const ticketMedio      = filteredOrders.length > 0 ? totalValue / filteredOrders.length : 0
  const uniqueClients    = new Set(filteredOrders.map(o => o.client_name)).size
  const recentOrders     = [...allOrders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5)
  const pendingOrders    = allOrders.filter(o => o.status_name && !['Entregue','Cancelado','Faturado'].includes(o.status_name))

  // Admin: ranking de reps e status
  // Peças por marca/fábrica
  const repRanking = isAdmin ? Object.entries(
    filteredOrders.reduce((acc, o) => {
      const k = o.rep_name || 'N/A'
      acc[k] = (acc[k] || 0) + Number(o.total_value)
      return acc
    }, {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1]).slice(0, 5) : []

  const statusSummary = isAdmin ? Object.entries(
    filteredOrders.reduce((acc, o) => {
      const k = o.status_name || 'Sem status'
      if (!acc[k]) acc[k] = { count: 0, color: o.status_color || '#9CA3AF' }
      acc[k].count++
      return acc
    }, {} as Record<string, { count: number; color: string }>)
  ).sort((a, b) => b[1].count - a[1].count) : []

  const totalCommission  = isAdmin ? totalOfficeComm : totalRepComm

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

  return (<>
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

      {/* ─── Filtro de período ───────────────────────────── */}
      <div className="px-4 lg:px-8 pt-3 pb-1">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: 'today', label: 'Hoje' },
            { id: '7d',    label: '7 dias' },
            { id: '30d',   label: '30 dias' },
            { id: 'month', label: 'Este mês' },
            { id: 'custom',label: 'Personalizado' },
          ].map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`px-3 py-1 rounded-xl text-[12px] font-semibold border transition-colors ${
                activePeriod === p.id
                  ? 'bg-white text-primary border-white shadow-sm'
                  : 'bg-white/10 text-white/80 border-white/20 hover:bg-white/20'
              }`}>
              {p.label}
            </button>
          ))}
          {activePeriod === 'custom' && (
            <div className="flex items-center gap-1.5 ml-1">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="px-2 py-1 rounded-lg text-[12px] bg-white text-on-surface border-0 focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <span className="text-white/60 text-[12px]">até</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="px-2 py-1 rounded-lg text-[12px] bg-white text-on-surface border-0 focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          )}
        </div>
        {activePeriod !== 'today' && (
          <p className="text-white/50 text-[11px] mt-1">
            {new Date(dateFrom+'T12:00:00').toLocaleDateString('pt-BR')} a {new Date(dateTo+'T12:00:00').toLocaleDateString('pt-BR')} · {filteredOrders.length} pedido{filteredOrders.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* ─── Stat cards — overlap hero ──────────────────── */}
      <div className="px-4 lg:px-8 -mt-5">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">

          <StatCard
            icon={<ShoppingCart className="h-4.5 w-4.5 text-blue-600" />}
            iconBg="bg-blue-100"
            label="Total de pedidos"
            value={isAdmin ? filteredOrders.length.toString() : formatCurrency(totalValue)}
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

      {/* ─── Cards extras Admin ──────────────────────────── */}
      {isAdmin && (
        <div className="px-4 lg:px-8 mt-2">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatCard
              icon={<Award className="h-4.5 w-4.5 text-emerald-600" />}
              iconBg="bg-emerald-100"
              label="Comissão Escritório"
              value={formatCurrency(totalOfficeComm)}
              accentColor="#10B981"
            />
            <StatCard
              icon={<Package className="h-4.5 w-4.5 text-violet-600" />}
              iconBg="bg-violet-100"
              label="Total de Peças"
              value={totalPieces.toLocaleString('pt-BR')}
              accentColor="#7C3AED"
            />
            <StatCard
              icon={<TrendingUp className="h-4.5 w-4.5 text-blue-600" />}
              iconBg="bg-blue-100"
              label="Ticket Médio"
              value={formatCurrency(ticketMedio)}
              accentColor="#3B82F6"
            />
            <StatCard
              icon={<Users className="h-4.5 w-4.5 text-amber-600" />}
              iconBg="bg-amber-100"
              label="Clientes Atendidos"
              value={uniqueClients.toString()}
              accentColor="#F59E0B"
            />
          </div>
        </div>
      )}

      <div className="px-4 lg:px-8 mt-3 space-y-3">

        {/* ─── Admin: Metas ────────────────────────────── */}
        {isAdmin && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <SectionTitle className="mb-0">🎯 Metas</SectionTitle>
              <button onClick={openNewGoal} className="flex items-center gap-1 text-[12px] text-primary font-semibold hover:text-primary/80">
                <Plus className="h-3.5 w-3.5" /> Nova meta
              </button>
            </div>
            {goals.length === 0 ? (
              <button onClick={openNewGoal} className="w-full bg-white rounded-2xl border border-dashed border-outline-variant/60 p-6 text-center hover:border-primary/40 hover:bg-primary/5 transition-colors">
                <Target className="h-7 w-7 text-outline/40 mx-auto mb-1" />
                <p className="text-[12px] text-outline/70">Nenhuma meta cadastrada. Clique para adicionar.</p>
              </button>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {goals.map(g => {
                  const pct = g.target_pieces > 0 ? Math.min(100, (g.achieved_pieces / g.target_pieces) * 100) : 0
                  const color = pct >= 100 ? '#10B981' : pct >= 70 ? '#F59E0B' : pct >= 40 ? '#3B82F6' : '#EF4444'
                  return (
                    <div key={g.id} className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm p-4">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${g.type === 'factory' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>
                              {g.type === 'factory' ? '🏭 FÁBRICA' : '👤 REP'}
                            </span>
                            {g.period_label && <span className="text-[10px] text-outline">{g.period_label}</span>}
                          </div>
                          <p className="text-[13px] font-bold text-on-surface truncate">{g.label}</p>
                          <p className="text-[11px] text-outline">{g.factory_name || g.rep_name}</p>
                        </div>
                        <div className="flex gap-0.5 flex-shrink-0">
                          <button onClick={() => openEditGoal(g)} className="p-1 text-outline/50 hover:text-primary rounded-lg transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => window.confirm('Excluir meta?') && deleteGoalMut.mutate(g.id)} className="p-1 text-outline/50 hover:text-red-500 rounded-lg transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                      {/* Barra de progresso */}
                      <div className="space-y-1.5">
                        <div className="flex items-end justify-between">
                          <span className="text-[22px] font-bold leading-none" style={{ color }}>{g.achieved_pieces.toLocaleString('pt-BR')}</span>
                          <span className="text-[12px] text-outline">/ {g.target_pieces.toLocaleString('pt-BR')} pç</span>
                        </div>
                        <div className="w-full bg-surface-container-low rounded-full h-2 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-outline">{g.target_pieces - g.achieved_pieces > 0 ? `Faltam ${(g.target_pieces - g.achieved_pieces).toLocaleString('pt-BR')} pç` : '✅ Meta atingida!'}</span>
                          <span className="text-[13px] font-bold" style={{ color }}>{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}


        {/* ─── Admin: Status e Ranking ─────────────────── */}
        {isAdmin && (statusSummary.length > 0 || repRanking.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

            {/* Pedidos por Status */}
            {statusSummary.length > 0 && (
              <section>
                <SectionTitle>Pedidos por Status</SectionTitle>
                <div className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm p-4 space-y-2">
                  {statusSummary.map(([name, { count, color }]) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="flex-1 text-[12px] text-on-surface font-medium truncate">{name}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-surface-container-low rounded-full h-1.5 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(count/filteredOrders.length*100)}%`, backgroundColor: color }} />
                        </div>
                        <span className="text-[12px] font-bold text-on-surface w-6 text-right">{count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Ranking de Representantes */}
            {repRanking.length > 0 && (
              <section>
                <SectionTitle>🏆 Ranking de Representantes</SectionTitle>
                <div className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm p-4 space-y-2">
                  {repRanking.map(([name, value], i) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className={`text-[12px] font-bold w-5 text-center ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-gray-400' : 'text-amber-700'}`}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}º`}
                      </span>
                      <span className="flex-1 text-[12px] text-on-surface font-medium truncate">{name}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-surface-container-low rounded-full h-1.5 overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${(value/repRanking[0][1]*100)}%` }} />
                        </div>
                        <span className="text-[12px] font-bold text-primary">{formatCurrency(value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ─── Seção do Representante ──────────────────── */}
        {!isAdmin && (
          <div className="space-y-3">

            {/* Cards adicionais: Peças, Comissão, Clientes, Pendentes */}
            <div className="grid grid-cols-2 gap-2.5">
              <StatCard
                icon={<Package className="h-4.5 w-4.5 text-violet-600" />}
                iconBg="bg-violet-100"
                label="Total de peças"
                value={totalPieces.toLocaleString('pt-BR')}
                accentColor="#7C3AED"
              />
              <StatCard
                icon={<Award className="h-4.5 w-4.5 text-emerald-600" />}
                iconBg="bg-emerald-100"
                label="Minha comissão"
                value={formatCurrency(totalCommission)}
                accentColor="#10B981"
              />
              <StatCard
                icon={<Users className="h-4.5 w-4.5 text-blue-600" />}
                iconBg="bg-blue-100"
                label="Clientes atendidos"
                value={uniqueClients.toString()}
                accentColor="#3B82F6"
              />
              <StatCard
                icon={<CheckCircle className="h-4.5 w-4.5 text-amber-600" />}
                iconBg="bg-amber-100"
                label="Em aberto"
                value={pendingOrders.length.toString()}
                accentColor="#F59E0B"
              />
            </div>

            {/* Pedidos recentes */}
            <section>
              <SectionTitle>Últimos Pedidos</SectionTitle>
              <div className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm overflow-hidden">
                {recentOrders.length === 0 ? (
                  <div className="p-8 flex flex-col items-center text-center">
                    <Package className="h-7 w-7 text-outline/40 mb-2" />
                    <p className="text-[12px] text-outline/70">Nenhum pedido ainda</p>
                  </div>
                ) : (
                  <div className="divide-y divide-outline-variant/20">
                    {recentOrders.map(o => (
                      <button
                        key={o.id}
                        onClick={() => navigate(`/orders/${o.id}`)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/5 transition-colors text-left"
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: o.status_color || '#9CA3AF' }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[12px] font-bold text-primary">{formatOrderNumber(o.order_number)}</span>
                            <span className="text-[12px] font-medium text-on-surface truncate">{o.client_name}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[12px] text-outline">
                            <span>{o.factory_name}</span>
                            <span>{o.total_pieces} pç</span>
                            {o.status_name && <span className="text-[11px]" style={{ color: o.status_color }}>{o.status_name}</span>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[12px] font-bold text-on-surface">{formatCurrency(o.total_value)}</p>
                          <p className="text-[11px] text-outline">
                            {(() => { const d = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(o.created_at)); const [y,m,day] = d.split('-'); return `${day}/${m}/${y}` })()}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="px-4 py-2 border-t border-outline-variant/20 bg-surface-container-low/50">
                  <button onClick={() => navigate('/orders')} className="text-[12px] text-primary font-semibold hover:underline">
                    Ver todos os pedidos →
                  </button>
                </div>
              </div>
            </section>

            {/* Metas do representante */}
            {goals.length > 0 && (
              <section>
                <SectionTitle>🎯 Minhas Metas</SectionTitle>
                <div className="space-y-2">
                  {goals.map(g => {
                    const pct = g.target_pieces > 0 ? Math.min(100, (g.achieved_pieces / g.target_pieces) * 100) : 0
                    const color = pct >= 100 ? '#10B981' : pct >= 70 ? '#F59E0B' : pct >= 40 ? '#3B82F6' : '#EF4444'
                    return (
                      <div key={g.id} className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm p-4">
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                            <Target className="h-4.5 w-4.5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-bold text-on-surface">{g.label}</p>
                            <p className="text-[11px] text-outline">{g.factory_name || g.rep_name}{g.period_label ? ` · ${g.period_label}` : ''}</p>
                          </div>
                          <span className="text-[14px] font-bold flex-shrink-0" style={{ color }}>{pct.toFixed(0)}%</span>
                        </div>
                        <div className="space-y-1.5">
                          <div className="w-full bg-surface-container-low rounded-full h-3 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                          </div>
                          <div className="flex items-center justify-between text-[12px]">
                            <span className="font-bold text-on-surface">{g.achieved_pieces.toLocaleString('pt-BR')} peças</span>
                            <span className="text-outline">meta: {g.target_pieces.toLocaleString('pt-BR')} pç</span>
                          </div>
                          {pct < 100 && (
                            <p className="text-[11px] text-outline/70">
                              Faltam <span className="font-semibold text-on-surface">{(g.target_pieces - g.achieved_pieces).toLocaleString('pt-BR')} peças</span> para atingir a meta
                            </p>
                          )}
                          {pct >= 100 && (
                            <p className="text-[11px] text-emerald-600 font-semibold">✅ Meta atingida!</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

          </div>
        )}

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

    {/* ── Modal Nova/Editar Meta ── */}
    {/* ── Modal Nova/Editar Meta ── */}
    {showGoalModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowGoalModal(false)} />
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-on-surface text-base">{editingGoal ? 'Editar Meta' : 'Nova Meta'}</h3>
            <button onClick={() => setShowGoalModal(false)} className="p-1.5 rounded-lg text-outline hover:bg-surface-container">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            {['factory','rep'].map(t => (
              <button key={t} type="button" onClick={() => setGoalForm(f => ({...f, type: t}))}
                className={`py-2 rounded-xl text-[12px] font-semibold border transition-colors ${goalForm.type === t ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant text-outline hover:bg-surface-container'}`}>
                {t === 'factory' ? '🏭 Por Fábrica' : '👤 Por Representante'}
              </button>
            ))}
          </div>

          {/* Entidade */}
          {goalForm.type === 'factory' ? (
            <div>
              <label className="block text-[12px] font-medium text-outline mb-1">Fábrica</label>
              <select value={goalForm.factory_id} onChange={e => setGoalForm(f => ({...f, factory_id: e.target.value}))}
                className="w-full border border-outline-variant rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">Selecione...</option>
                {(factories as {id:string;name:string}[]).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-[12px] font-medium text-outline mb-1">Representante</label>
              <select value={goalForm.rep_id} onChange={e => setGoalForm(f => ({...f, rep_id: e.target.value}))}
                className="w-full border border-outline-variant rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">Selecione...</option>
                {reps.map((r: {id:string;name:string}) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}

          {/* Label e coleção */}
          <div>
            <label className="block text-[12px] font-medium text-outline mb-1">Descrição / Coleção</label>
            <input value={goalForm.label} onChange={e => setGoalForm(f => ({...f, label: e.target.value}))}
              placeholder="Ex: OUZZARE VE27 2026" className="w-full border border-outline-variant rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-outline mb-1">Meta (peças)</label>
              <input type="number" value={goalForm.target_pieces} onChange={e => setGoalForm(f => ({...f, target_pieces: e.target.value}))}
                placeholder="Ex: 5000" className="w-full border border-outline-variant rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-outline mb-1">Período</label>
              <input value={goalForm.period_label} onChange={e => setGoalForm(f => ({...f, period_label: e.target.value}))}
                placeholder="Ex: Inverno 2026" className="w-full border border-outline-variant rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => setShowGoalModal(false)} className="px-4 py-2 text-[12px] text-outline hover:text-on-surface">Cancelar</button>
            <button
              onClick={() => createGoalMut.mutate({
                type: goalForm.type,
                factory_id: goalForm.factory_id || null,
                rep_id: goalForm.rep_id || null,
                label: goalForm.label,
                target_pieces: parseInt(goalForm.target_pieces) || 0,
                period_label: goalForm.period_label || null,
              })}
              disabled={!goalForm.label || !goalForm.target_pieces || createGoalMut.isPending}
              className="px-5 py-2 bg-primary text-white rounded-xl text-[12px] font-semibold disabled:opacity-50 hover:bg-primary/90 active:scale-95"
            >
              {createGoalMut.isPending ? 'Salvando...' : editingGoal ? 'Salvar' : 'Criar Meta'}
            </button>
          </div>
        </div>
      </div>
    )}
  </>)
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
