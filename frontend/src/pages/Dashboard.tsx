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
  client_city?: string
  total_value: number; total_pieces: number; status_name: string
  status_color: string; status_id: string; created_at: string; rep_name: string
  rep_commission_value: number
  office_commission_value: number
  rep_commission_pct: number
  office_commission_pct: number
  guide_commission_value?: number
  guide_commission_pct?: number
  commission_manual_override?: boolean
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
  guide_commission_value?: number
}

interface Goal {
  id: string; type: 'factory'|'rep'; factory_id: string|null; rep_id: string|null
  label: string; target_pieces: number; period_label: string|null
  factory_name: string|null; rep_name: string|null; achieved_pieces: number
  monthly_achieved: number; monthly_target: number
}

export function Dashboard() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const [showGoalModal, setShowGoalModal] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [goalForm, setGoalForm] = useState({ type: 'factory', factory_id: '', rep_id: '', label: '', target_pieces: '', period_label: '' })
  const [cardModal, setCardModal] = useState<string | null>(null)

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
  // PCT é sempre fonte da verdade; valor = pct × total (commission_manual_override só protege PCT de reset automático)
  // Distribuidora (VITE_SINGLE_COMMISSION): só comissão do representante, sem split de escritório
  const singleComm = import.meta.env.VITE_SINGLE_COMMISSION === 'true'
  // Modo fábrica (NXO): 3 vias — Loja (rep) + Escritório (office) + Guia (guide)
  const factoryComm = import.meta.env.VITE_FACTORY_COMMISSION === 'true'
  const effRepComm  = (o: Order) => Number(o.total_value) * Number(o.rep_commission_pct)    / 100
  const effOffComm  = (o: Order) => Number(o.total_value) * Number(o.office_commission_pct) / 100
  const effGuideComm = (o: Order) => Number(o.total_value) * Number(o.guide_commission_pct || 0) / 100
  const totalRepComm     = filteredOrders.reduce((s, o) => s + effRepComm(o), 0)
  const totalOfficeComm  = filteredOrders.reduce((s, o) => s + effOffComm(o), 0)
  const totalGuideComm   = filteredOrders.reduce((s, o) => s + effGuideComm(o), 0)
  const ticketMedio      = filteredOrders.length > 0 ? totalValue / filteredOrders.length : 0

  // Comissão dividida: escritório direto (PE/admin, rep_commission=0) vs sobre representantes
  const commEscritorioDireto   = filteredOrders
    .filter(o => effRepComm(o) === 0)
    .reduce((s, o) => s + effOffComm(o), 0)
  const commEscritorioSobreRep = filteredOrders
    .filter(o => effRepComm(o) > 0)
    .reduce((s, o) => s + effOffComm(o), 0)
  const uniqueClients    = new Set(filteredOrders.map(o => o.client_name)).size
  const recentOrders     = [...allOrders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5)

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

  const totalCommission = isAdmin ? totalOfficeComm : totalRepComm

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
  const salesTotalGuiaCom = sales.reduce((s, r) => s + Number(r.guide_commission_value || 0), 0)

  return (<>
    <div className="pb-24 lg:pb-8 min-h-full">

      {/* ─── Hero header ─────────────────────────────────── */}
      <div className="relative px-5 pt-6 pb-8 lg:px-8 lg:pt-8 lg:pb-10"
        style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)' }}>
        {/* Linha decorativa sutil na base */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-white/10" />

        <p className="text-white/60 text-[12px] font-medium tracking-wide uppercase">{greeting()}</p>
        <h1 className="font-display text-[34px] font-bold text-white leading-tight mt-0.5">{user?.name}</h1>
        <p className="text-white/50 text-[12px] mt-1.5">
          {isAdmin ? 'Administrador' : 'Representante'} &bull;{' '}
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>

        <button
          onClick={() => navigate('/orders/new')}
          className="hidden lg:flex absolute top-8 right-8 items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-[12px] font-semibold px-5 py-2 rounded-xl border border-white/15 transition-all"
        >
          <Plus className="h-4 w-4" /> Novo pedido
        </button>
      </div>

      {/* ─── Filtro de período ───────────────────────────── */}
      <div className="pt-3 pb-1">
        {/* Filtros — scroll horizontal no mobile */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide px-4 lg:px-8 pb-1">
          {[
            { id: 'today', label: 'Hoje' },
            { id: '7d',    label: '7 dias' },
            { id: '30d',   label: '30 dias' },
            { id: 'month', label: 'Este mês' },
            { id: 'custom',label: 'Personalizado' },
          ].map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`flex-shrink-0 px-4 py-1.5 rounded-xl text-[13px] font-semibold border transition-colors active:scale-95 ${
                activePeriod === p.id
                  ? 'bg-white text-primary border-white shadow-sm'
                  : 'bg-white/10 text-white/80 border-white/20 hover:bg-white/20'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        {activePeriod === 'custom' && (
          <div className="flex items-center gap-2 px-4 lg:px-8 mt-2 flex-wrap">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="flex-1 min-w-0 px-3 py-1.5 rounded-xl text-[12px] bg-white text-on-surface border-0 focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <span className="text-white/60 text-[12px] flex-shrink-0">até</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="flex-1 min-w-0 px-3 py-1.5 rounded-xl text-[12px] bg-white text-on-surface border-0 focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        )}
        {activePeriod !== 'today' && (
          <p className="text-white/50 text-[11px] mt-1 px-4 lg:px-8">
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
            onClick={isAdmin ? () => setCardModal('pedidos') : undefined}
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
            onClick={isAdmin ? () => setCardModal('hoje') : undefined}
          />

          {isAdmin && (
            <StatCard
              icon={<TrendingUp className="h-4.5 w-4.5 text-violet-600" />}
              iconBg="bg-violet-100"
              label="Total vendas"
              value={formatCurrency(totalValue)}
              accentColor="#7C3AED"
              onClick={() => setCardModal('vendas')}
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
              onClick={() => setCardModal('hoje')}
            />
          )}
        </div>
      </div>

      {/* ─── Cards extras Admin ──────────────────────────── */}
      {isAdmin && (
        <div className="px-4 lg:px-8 mt-2 space-y-2.5">

          {/* Row 1: cards de comissão — fábrica (Loja/Escritório/Guia), distribuidora (só rep) ou padrão SOMMA */}
          {factoryComm ? (
            <div className="grid grid-cols-3 gap-2.5">
              <StatCard
                icon={<Award className="h-4.5 w-4.5 text-teal-600" />}
                iconBg="bg-teal-100"
                label="Comissão Loja"
                value={formatCurrency(totalRepComm)}
                accentColor="#0D9488"
                onClick={() => setCardModal('comissao_rep')}
              />
              <StatCard
                icon={<Award className="h-4.5 w-4.5 text-indigo-600" />}
                iconBg="bg-indigo-100"
                label="Comissão Representante"
                value={formatCurrency(totalOfficeComm)}
                accentColor="#4F46E5"
                onClick={() => setCardModal('comissao')}
              />
              <StatCard
                icon={<Award className="h-4.5 w-4.5 text-amber-600" />}
                iconBg="bg-amber-100"
                label="Comissão Guia"
                value={formatCurrency(totalGuideComm)}
                accentColor="#D97706"
                onClick={() => setCardModal('comissao_guia')}
              />
            </div>
          ) : (
          <div className={singleComm ? 'grid grid-cols-1 gap-2.5' : 'grid grid-cols-3 gap-2.5'}>
            {!singleComm && (
              <StatCard
                icon={<Award className="h-4.5 w-4.5 text-emerald-600" />}
                iconBg="bg-emerald-100"
                label="Com. Escritório s/ Repres."
                value={formatCurrency(commEscritorioSobreRep)}
                accentColor="#10B981"
                onClick={() => setCardModal('comissao_direto')}
              />
            )}
            <StatCard
              icon={<Award className="h-4.5 w-4.5 text-teal-600" />}
              iconBg="bg-teal-100"
              label={singleComm ? 'Comissão' : 'Comissão Representantes'}
              value={formatCurrency(totalRepComm)}
              accentColor="#0D9488"
              onClick={() => setCardModal('comissao_rep')}
            />
            {!singleComm && (
              <StatCard
                icon={<Award className="h-4.5 w-4.5 text-indigo-600" />}
                iconBg="bg-indigo-100"
                label="Comissão Total Escritório"
                value={formatCurrency(totalOfficeComm)}
                accentColor="#4F46E5"
                onClick={() => setCardModal('comissao')}
              />
            )}
          </div>
          )}

          {/* Row 2: Peças, Ticket, Clientes */}
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
            <StatCard
              icon={<Package className="h-4.5 w-4.5 text-violet-600" />}
              iconBg="bg-violet-100"
              label="Total de Peças"
              value={totalPieces.toLocaleString('pt-BR')}
              accentColor="#7C3AED"
              onClick={() => setCardModal('pecas')}
            />
            <StatCard
              icon={<TrendingUp className="h-4.5 w-4.5 text-blue-600" />}
              iconBg="bg-blue-100"
              label="Ticket Médio"
              value={formatCurrency(ticketMedio)}
              accentColor="#3B82F6"
              onClick={() => setCardModal('ticket')}
            />
            <StatCard
              icon={<Users className="h-4.5 w-4.5 text-amber-600" />}
              iconBg="bg-amber-100"
              label="Clientes Atendidos"
              value={uniqueClients.toString()}
              accentColor="#F59E0B"
              onClick={() => setCardModal('clientes')}
            />
          </div>
        </div>
      )}

      <div className="px-4 lg:px-8 mt-3 space-y-3">

        {/* ─── Admin: Metas agrupadas por marca ────────── */}
        {isAdmin && (() => {
          // Agrupa por marca (1ª palavra do label)
          const getBrand = (g: Goal) => g.label.split(' ')[0]
          const groups: Record<string, { factory: Goal | null; reps: Goal[] }> = {}
          goals.forEach(g => {
            const brand = getBrand(g)
            if (!groups[brand]) groups[brand] = { factory: null, reps: [] }
            if (g.type === 'factory') groups[brand].factory = g
            else groups[brand].reps.push(g)
          })
          const brandList = Object.keys(groups).sort()

          const GoalBar = ({ g, large = false }: { g: Goal; large?: boolean }) => {
            const pct = g.target_pieces > 0 ? Math.min(100, (g.achieved_pieces / g.target_pieces) * 100) : 0
            const color = pct >= 100 ? '#10B981' : pct >= 70 ? '#F59E0B' : pct >= 40 ? '#3B82F6' : '#EF4444'
            const mPct = g.monthly_target > 0 ? Math.min(100, (g.monthly_achieved / g.monthly_target) * 100) : 0
            const mColor = mPct >= 100 ? '#10B981' : mPct >= 70 ? '#F59E0B' : mPct >= 40 ? '#60A5FA' : '#FCA5A5'
            return (
              <div className="space-y-1">
                <div className="flex items-end justify-between gap-2">
                  <span className={`font-bold leading-none ${large ? 'text-[32px]' : 'text-[20px]'}`} style={{ color }}>
                    {g.achieved_pieces.toLocaleString('pt-BR')}
                  </span>
                  <span className="text-[11px] text-outline pb-1">/ {g.target_pieces.toLocaleString('pt-BR')} pç</span>
                </div>
                <div className={`w-full bg-black/10 rounded-full overflow-hidden ${large ? 'h-3' : 'h-2'}`}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-white/70">
                    {pct >= 100 ? '✅ Meta atingida!' : `Faltam ${(g.target_pieces - g.achieved_pieces).toLocaleString('pt-BR')} pç`}
                  </span>
                  <span className="text-[13px] font-bold text-white">{pct.toFixed(1)}%</span>
                </div>
                {large && (
                  <div className="mt-2 pt-2 border-t border-white/10">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-white/50 font-semibold uppercase tracking-wide">Este mês</span>
                      <span className="text-[11px] font-bold" style={{ color: mColor }}>
                        {g.monthly_achieved.toLocaleString('pt-BR')} / {g.monthly_target.toLocaleString('pt-BR')} pç ({mPct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="w-full bg-black/10 rounded-full h-1.5 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${mPct}%`, backgroundColor: mColor }} />
                    </div>
                  </div>
                )}
              </div>
            )
          }

          return (
            <section>
              <div className="flex items-center justify-between mb-3">
                <SectionTitle className="mb-0">🎯 Metas por Marca</SectionTitle>
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
                <div className="space-y-5">
                  {brandList.map(brand => {
                    const { factory, reps } = groups[brand]
                    const brandColors: Record<string, { from: string; to: string }> = {
                      OUZZARE: { from: '#312e81', to: '#1e1b4b' },
                      TEEZZ:   { from: '#1e3a5f', to: '#0f2744' },
                    }
                    const bc = brandColors[brand] || { from: '#1f2937', to: '#111827' }

                    return (
                      <div key={brand} className="rounded-3xl overflow-hidden shadow-xl" style={{ background: `linear-gradient(135deg, ${bc.from}, ${bc.to})` }}>

                        {/* Header da marca */}
                        <div className="px-4 lg:px-5 pt-4 pb-3 flex items-center justify-between">
                          <div>
                            <p className="text-white/60 text-[11px] font-semibold uppercase tracking-widest">{factory?.period_label || reps[0]?.period_label || ''}</p>
                            <h3 className="text-white text-[22px] font-black tracking-tight">{brand}</h3>
                          </div>
                          {factory && (
                            <div className="flex gap-1">
                              <button onClick={() => openEditGoal(factory)} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                              <button onClick={() => window.confirm('Excluir meta geral?') && deleteGoalMut.mutate(factory.id)} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          )}
                        </div>

                        {/* Meta geral da fábrica */}
                        {factory && (
                          <div className="px-4 lg:px-5 pb-4">
                            <p className="text-white/50 text-[11px] font-semibold uppercase tracking-wide mb-2">🏭 Meta Geral</p>
                            <GoalBar g={factory} large />
                          </div>
                        )}

                        {/* Grid de reps */}
                        {reps.length > 0 && (
                          <div className="bg-black/20 px-4 lg:px-5 py-3">
                            <p className="text-white/50 text-[11px] font-semibold uppercase tracking-wide mb-3">👥 Por Representante</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                              {reps.sort((a, b) => b.achieved_pieces - a.achieved_pieces).map(g => {
                                const pct = g.target_pieces > 0 ? Math.min(100, (g.achieved_pieces / g.target_pieces) * 100) : 0
                                const color = pct >= 100 ? '#10B981' : pct >= 70 ? '#F59E0B' : pct >= 40 ? '#60A5FA' : '#FCA5A5'
                                const mPct = g.monthly_target > 0 ? Math.min(100, (g.monthly_achieved / g.monthly_target) * 100) : 0
                                const mColor = mPct >= 100 ? '#10B981' : mPct >= 70 ? '#F59E0B' : mPct >= 40 ? '#60A5FA' : '#FCA5A5'
                                return (
                                  <div key={g.id} className="bg-white/10 hover:bg-white/15 rounded-2xl p-3 transition-colors group">
                                    <div className="flex items-start justify-between mb-2">
                                      <p className="text-white text-[12px] font-bold truncate flex-1">{g.rep_name}</p>
                                      <div className="hidden group-hover:flex gap-0.5 flex-shrink-0 ml-1">
                                        <button onClick={() => openEditGoal(g)} className="p-1 rounded text-white/50 hover:text-white"><Pencil className="h-3 w-3" /></button>
                                        <button onClick={() => window.confirm('Excluir?') && deleteGoalMut.mutate(g.id)} className="p-1 rounded text-white/50 hover:text-white"><Trash2 className="h-3 w-3" /></button>
                                      </div>
                                    </div>
                                    {/* Período */}
                                    <div className="flex items-baseline gap-1 mb-1">
                                      <span className="text-[18px] font-black" style={{ color }}>{g.achieved_pieces.toLocaleString('pt-BR')}</span>
                                      <span className="text-[10px] text-white/40">/ {(g.target_pieces/1000).toFixed(0)}k</span>
                                    </div>
                                    <div className="w-full bg-black/20 rounded-full h-1.5 overflow-hidden mb-2">
                                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                                    </div>
                                    {/* Mês atual */}
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-[9px] text-white/40 font-semibold uppercase tracking-wide">Mês</span>
                                      <span className="text-[10px] font-bold" style={{ color: mColor }}>{g.monthly_achieved.toLocaleString('pt-BR')} / {g.monthly_target.toLocaleString('pt-BR')}</span>
                                    </div>
                                    <div className="w-full bg-black/20 rounded-full h-1 overflow-hidden">
                                      <div className="h-full rounded-full" style={{ width: `${mPct}%`, backgroundColor: mColor }} />
                                    </div>
                                    <p className="text-[10px] mt-1 font-bold text-right" style={{ color }}>{pct.toFixed(0)}%</p>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })()}


        {/* ─── Admin: Status e Ranking por Fábrica ──────── */}
        {isAdmin && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

            {/* Pedidos por Status */}
            {statusSummary.length > 0 && (
              <section>
                <SectionTitle>Pedidos por Status</SectionTitle>
                <div className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm p-4 space-y-2">
                  {statusSummary.map(([name, { count, color }]) => (
                    <div key={name} className="flex items-center gap-3 cursor-pointer hover:bg-surface-container-low rounded-lg px-1 py-0.5 transition-colors" onClick={() => setCardModal('status_' + name)}>
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

            {/* Ranking geral */}
            {repRanking.length > 0 && (
              <section>
                <SectionTitle>🏆 Ranking Geral</SectionTitle>
                <div className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm p-4 space-y-2">
                  {repRanking.map(([name, value], i) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className="text-[12px] font-bold w-5 text-center">
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

        {/* ─── Ranking por Fábrica ──────────────────────── */}
        {isAdmin && filteredOrders.length > 0 && (() => {
          // Agrupa pedidos por fábrica → depois por rep
          const factories = [...new Set(filteredOrders.map(o => o.factory_name))].sort()
          return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {factories.map(factory => {
                const factoryOrders = filteredOrders.filter(o => o.factory_name === factory)
                const rankingByFactory = Object.entries(
                  factoryOrders.reduce((acc, o) => {
                    const k = o.rep_name || 'N/A'
                    if (!acc[k]) acc[k] = { value: 0, pieces: 0, orders: 0 }
                    acc[k].value += Number(o.total_value)
                    acc[k].pieces += Number(o.total_pieces || 0)
                    acc[k].orders += 1
                    return acc
                  }, {} as Record<string, { value: number; pieces: number; orders: number }>)
                ).sort((a, b) => b[1].value - a[1].value)

                const totalFactory = factoryOrders.reduce((s, o) => s + Number(o.total_value), 0)
                const totalPiecesFactory = factoryOrders.reduce((s, o) => s + Number(o.total_pieces || 0), 0)

                const factoryColors: Record<string, string> = {
                  OUZZARE: '#4f46e5', TEEZZ: '#2563eb',
                }
                const color = factoryColors[factory] || '#374151'

                return (
                  <section key={factory}>
                    <SectionTitle>🏭 {factory}</SectionTitle>
                    <div className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm overflow-hidden">
                      {/* Header fábrica */}
                      <div className="px-4 py-2 flex items-center justify-between" style={{ backgroundColor: color }}>
                        <span className="text-white text-[11px] font-bold uppercase tracking-wider">{factoryOrders.length} pedidos · {totalPiecesFactory.toLocaleString('pt-BR')} pç</span>
                        <span className="text-white text-[13px] font-black">{formatCurrency(totalFactory)}</span>
                      </div>
                      <div className="p-4 space-y-2">
                        {rankingByFactory.map(([name, data], i) => (
                          <div key={name} className="flex items-center gap-3 cursor-pointer hover:bg-surface-container-low rounded-lg px-1 py-1 transition-colors" onClick={() => setCardModal(`rep_${factory}_${name}`)}>
                            <span className="text-[12px] font-bold w-5 text-center flex-shrink-0">
                              {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}º`}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-semibold text-on-surface truncate">{name}</p>
                              <p className="text-[10px] text-outline">{data.orders} pedido{data.orders !== 1 ? 's' : ''} · {data.pieces.toLocaleString('pt-BR')} pç</p>
                            </div>
                            <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                              <span className="text-[12px] font-bold" style={{ color }}>{formatCurrency(data.value)}</span>
                              <div className="w-20 bg-surface-container-low rounded-full h-1 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${(data.value / rankingByFactory[0][1].value) * 100}%`, backgroundColor: color }} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                )
              })}
            </div>
          )
        })()}

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
              {(() => {
                // Somente a meta pessoal do representante (type='rep')
                const repGoals = goals.filter(g => g.type === 'rep')
                const totalTarget = repGoals.reduce((s, g) => s + g.target_pieces, 0)
                const totalDone   = repGoals.reduce((s, g) => s + g.achieved_pieces, 0)
                const pct = totalTarget > 0 ? Math.min(100, Math.round((totalDone / totalTarget) * 100)) : 0
                const metaColor = pct >= 100 ? '#10B981' : pct >= 70 ? '#F59E0B' : '#7C3AED'
                return (
                  <StatCard
                    icon={<Target className="h-4.5 w-4.5" style={{ color: metaColor }} />}
                    iconBg={pct >= 100 ? 'bg-emerald-100' : pct >= 70 ? 'bg-amber-100' : 'bg-violet-100'}
                    label="Minha meta"
                    value={repGoals.length === 0 ? '—' : `${pct}%`}
                    accentColor={metaColor}
                  />
                )
              })()}
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
                          factoryComm ? 'Com. Loja (R$)' : 'Com. Rep (R$)',
                          factoryComm ? 'Com. Repres. (R$)' : 'Com. Escr (R$)',
                          ...(factoryComm ? ['Com. Guia (R$)'] : []),
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
                          {factoryComm && (
                            <td className="px-3 py-1.5 text-right whitespace-nowrap font-bold text-amber-700">
                              {fmtR(r.guide_commission_value || 0)}
                            </td>
                          )}
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
                        {factoryComm && (
                          <td className="px-3 py-1.5 text-right text-amber-700">
                            {fmtR(salesTotalGuiaCom)}
                          </td>
                        )}
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

    {/* ── Modal Detalhes do Card ── */}
    {cardModal && (() => {
      let title = ''
      let rows: Order[] = []

      if (cardModal === 'pedidos') { title = `Pedidos do Período (${filteredOrders.length})`; rows = filteredOrders }
      else if (cardModal === 'hoje') { title = `Pedidos de Hoje (${todayOrders.length})`; rows = todayOrders }
      else if (cardModal === 'vendas') { title = `Vendas do Período`; rows = filteredOrders }
      else if (cardModal === 'comissao') { title = factoryComm ? `Comissão Representante` : `Comissão Total Escritório`; rows = filteredOrders }
      else if (cardModal === 'comissao_direto') { title = `Com. Escritório s/ Vendas de Representantes`; rows = filteredOrders.filter(o => effRepComm(o) > 0) }
      else if (cardModal === 'comissao_rep') { title = factoryComm ? `Comissão Loja` : `Comissão dos Representantes`; rows = factoryComm ? filteredOrders : filteredOrders.filter(o => effRepComm(o) > 0) }
      else if (cardModal === 'comissao_guia') { title = `Comissão Guia`; rows = filteredOrders }
      else if (cardModal === 'pecas') { title = `Total de Peças por Fábrica`; rows = filteredOrders }
      else if (cardModal === 'ticket') { title = `Ticket Médio por Representante`; rows = filteredOrders }
      else if (cardModal === 'clientes') { title = `Clientes Atendidos`; rows = filteredOrders }
      else if (cardModal.startsWith('status_')) { const s = cardModal.replace('status_',''); title = `Pedidos — ${s}`; rows = filteredOrders.filter(o => o.status_name === s) }
      else if (cardModal.startsWith('rep_')) { const parts = cardModal.split('_'); const factory = parts[1]; const rep = parts.slice(2).join('_'); title = `${rep} — ${factory}`; rows = filteredOrders.filter(o => o.factory_name === factory && o.rep_name === rep) }

      // Para peças/ticket/comissão/clientes mostra agrupamento
      const isGrouped = ['pecas','ticket','comissao','comissao_direto','comissao_rep','comissao_guia','clientes'].includes(cardModal)
      const isCommModal = cardModal === 'comissao' || cardModal === 'comissao_direto' || cardModal === 'comissao_rep' || cardModal === 'comissao_guia'

      return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setCardModal(null)} />
          <div className="relative bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/30">
              <h3 className="font-bold text-on-surface text-base">{title}</h3>
              <button onClick={() => setCardModal(null)} className="p-1.5 rounded-lg text-outline hover:bg-surface-container">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {/* Agrupado */}
              {isGrouped && cardModal === 'pecas' && (
                Object.entries(
                  rows.reduce((acc, o) => { acc[o.factory_name] = (acc[o.factory_name] || 0) + Number(o.total_pieces || 0); return acc }, {} as Record<string,number>)
                ).sort((a,b) => b[1]-a[1]).map(([factory, pcs]) => (
                  <div key={factory} className="flex items-center justify-between py-2 px-3 bg-surface-container-low rounded-xl">
                    <span className="font-semibold text-[13px]">{factory}</span>
                    <span className="font-bold text-primary text-[14px]">{pcs.toLocaleString('pt-BR')} peças</span>
                  </div>
                ))
              )}
              {isGrouped && isCommModal && (() => {
                // Card 1 (comissao_direto): fatia do escritório s/ vendas de representantes → effOffComm
                // Card 2 (comissao_rep): o que os representantes ganham para si → effRepComm
                // Card 3 (comissao): total escritório → effOffComm
                const commFn = cardModal === 'comissao_rep' ? effRepComm : cardModal === 'comissao_guia' ? effGuideComm : effOffComm
                const totalModal = rows.reduce((s,o)=>s+commFn(o),0)
                const grouped = Object.entries(
                  rows.reduce((acc, o) => {
                    const k = o.rep_name||'N/A'
                    if(!acc[k]) acc[k]={comm:0,orders:0}
                    acc[k].comm += commFn(o)
                    acc[k].orders++
                    return acc
                  }, {} as Record<string,{comm:number;orders:number}>)
                ).sort((a,b)=>b[1].comm-a[1].comm)
                return (<>
                  <div className="flex justify-between items-center py-2 px-3 bg-indigo-50 border border-indigo-200 rounded-xl mb-1">
                    <span className="font-bold text-[12px] text-indigo-700">TOTAL</span>
                    <span className="font-black text-[15px] text-indigo-700">{formatCurrency(totalModal)}</span>
                  </div>
                  {cardModal === 'comissao' && !factoryComm && (
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div className="py-1.5 px-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                        <p className="text-[10px] font-medium text-emerald-700">Escr. s/ Representantes</p>
                        <p className="text-[13px] font-bold text-emerald-700">{formatCurrency(commEscritorioSobreRep)}</p>
                      </div>
                      <div className="py-1.5 px-3 bg-teal-50 border border-teal-200 rounded-xl">
                        <p className="text-[10px] font-medium text-teal-700">Vendas Diretas</p>
                        <p className="text-[13px] font-bold text-teal-700">{formatCurrency(commEscritorioDireto)}</p>
                      </div>
                    </div>
                  )}
                  {grouped.map(([rep,d]) => (
                    <div key={rep} className="flex items-center justify-between py-2 px-3 bg-surface-container-low rounded-xl">
                      <div><p className="font-semibold text-[13px]">{rep}</p><p className="text-[11px] text-outline">{d.orders} pedido{d.orders!==1?'s':''}</p></div>
                      <span className="font-bold text-emerald-600 text-[14px]">{formatCurrency(d.comm)}</span>
                    </div>
                  ))}
                </>)
              })()}
              {isGrouped && cardModal === 'ticket' && (
                Object.entries(
                  rows.reduce((acc, o) => { const k=o.rep_name||'N/A'; if(!acc[k]) acc[k]={total:0,count:0}; acc[k].total+=Number(o.total_value); acc[k].count++; return acc }, {} as Record<string,{total:number;count:number}>)
                ).sort((a,b)=>(b[1].total/b[1].count)-(a[1].total/a[1].count)).map(([rep,d]) => (
                  <div key={rep} className="flex items-center justify-between py-2 px-3 bg-surface-container-low rounded-xl">
                    <div><p className="font-semibold text-[13px]">{rep}</p><p className="text-[11px] text-outline">{d.count} pedidos</p></div>
                    <span className="font-bold text-primary text-[14px]">{formatCurrency(d.total/d.count)}</span>
                  </div>
                ))
              )}
              {isGrouped && cardModal === 'clientes' && (
                [...new Set(rows.map(o => o.client_name))].sort().map(client => {
                  const clientOrders = rows.filter(o => o.client_name === client)
                  return (
                    <div key={client} className="flex items-center justify-between py-2 px-3 bg-surface-container-low rounded-xl cursor-pointer hover:bg-primary/5" onClick={() => { setCardModal(null); navigate('/clients') }}>
                      <div><p className="font-semibold text-[13px]">{client}</p><p className="text-[11px] text-outline">{clientOrders.length} pedido{clientOrders.length!==1?'s':''}</p></div>
                      <span className="font-bold text-primary text-[13px]">{formatCurrency(clientOrders.reduce((s,o)=>s+Number(o.total_value),0))}</span>
                    </div>
                  )
                })
              )}

              {/* Lista de pedidos */}
              {!isGrouped && rows.length === 0 && (
                <p className="text-center text-outline py-8 text-[13px]">Nenhum pedido encontrado</p>
              )}
              {!isGrouped && rows.map(o => (
                <button key={o.id} onClick={() => { setCardModal(null); navigate(`/orders/${o.id}`) }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 bg-surface-container-low hover:bg-primary/5 rounded-xl text-left transition-colors">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: o.status_color || '#9CA3AF' }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-bold text-primary">#{String(o.order_number).padStart(4,'0')}</span>
                      <span className="text-[12px] font-medium text-on-surface truncate">{o.client_name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-outline">
                      <span>{o.rep_name}</span>
                      <span>·</span>
                      <span>{o.factory_name}</span>
                      {o.client_city && <><span>·</span><span>{o.client_city}</span></>}
                      <span>·</span>
                      <span>{o.total_pieces} pç</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[12px] font-bold text-on-surface">{formatCurrency(o.total_value)}</p>
                    <p className="text-[10px] text-outline">{(() => { const d = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date(o.created_at)); const [,m,day]=d.split('-'); return `${day}/${m}` })()}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )
    })()}

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
  icon, iconBg, label, value, badge, badgeColor, large, accentColor, onClick,
}: {
  icon: React.ReactNode
  iconBg: string
  label: string
  value: string
  badge?: string
  badgeColor?: 'emerald' | 'amber'
  large?: boolean
  accentColor?: string
  onClick?: () => void
}) {
  const badgeCls = badgeColor === 'emerald'
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-amber-100 text-amber-700'

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl p-3 border-0 relative overflow-hidden ${onClick ? 'cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-transform' : ''}`}
      style={{
        boxShadow: accentColor
          ? `0 10px 28px -6px ${accentColor}35, 0 4px 10px -4px ${accentColor}20`
          : '0 8px 24px -4px rgba(0,0,0,0.10)',
      }}
    >
      {accentColor && (
        <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl" style={{ background: accentColor }} />
      )}
      {onClick && (
        <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-black/5 flex items-center justify-center">
          <svg className="w-2.5 h-2.5 text-outline/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
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
      <p className={`font-display font-bold text-on-surface leading-none truncate ${large ? 'text-[22px] lg:text-[38px]' : 'text-[17px] lg:text-[28px]'}`}>
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
