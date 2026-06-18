import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, ShoppingCart, Users, Package, Building2, Tags,
  Settings, LogOut, Plus, UserCog, Wifi, WifiOff, Menu, X,
  BarChart2, Trash2, Link2, ChevronDown, PackageCheck, BellRing, CreditCard, MapPin,
} from 'lucide-react'

// SOMMA Maps — produto integrado (abre em nova aba)
const MAPS_URL = 'https://sommamaps.com.br'
import { useAuthStore } from '../../stores/authStore'
import { authApi } from '../../api/client'
import { db } from '../../db/db'
import { ordersApi } from '../../api/client'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  adminOnly?: boolean
  badge?: number
}

// Flag por instância — esconde a aba Pronta Entrega quando VITE_HIDE_PRONTA_ENTREGA=true
const HIDE_PRONTA_ENTREGA = import.meta.env.VITE_HIDE_PRONTA_ENTREGA === 'true'

// Itens principais no topo — todos visíveis
const navPrimary: NavItem[] = [
  { to: '/dashboard',     label: 'Dashboard',     icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: '/orders',        label: 'Pedidos',       icon: <ShoppingCart className="h-4 w-4" /> },
  { to: '/clients',       label: 'Clientes',      icon: <Users className="h-4 w-4" /> },
  { to: '/products',      label: 'Produtos',      icon: <Package className="h-4 w-4" /> },
  { to: '/reports',       label: 'Relatórios',    icon: <BarChart2 className="h-4 w-4" /> },
  { to: '/portals',       label: 'Catálogos',     icon: <Link2 className="h-4 w-4" /> },
  { to: '/pronta-entrega',label: 'Pronta Entrega',icon: <PackageCheck className="h-4 w-4" /> },
].filter(item => !(HIDE_PRONTA_ENTREGA && item.to === '/pronta-entrega'))

// Itens admin — ficam no dropdown do usuário
const navAdmin: NavItem[] = [
  { to: '/price-tables',        label: 'Tabelas',        icon: <Tags className="h-4 w-4" />,       adminOnly: true },
  { to: '/factories',           label: 'Fábricas',       icon: <Building2 className="h-4 w-4" />,  adminOnly: true },
  { to: '/statuses',            label: 'Status',         icon: <Package className="h-4 w-4" />,    adminOnly: true },
  { to: '/users',               label: 'Usuários',       icon: <UserCog className="h-4 w-4" />,    adminOnly: true },
  { to: '/orders/trash',        label: 'Lixeira',        icon: <Trash2 className="h-4 w-4" />,     adminOnly: true },
]

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

async function syncPendingOrders() {
  const pending = await db.pendingOrders.where('status').equals('pending').toArray()
  if (!pending.length) return
  try {
    const res = await ordersApi.sync(pending)
    const results: Array<{ offline_id: string; synced: boolean }> = res.data.results
    for (const r of results) {
      if (r.synced) await db.pendingOrders.delete(r.offline_id)
      else await db.pendingOrders.update(r.offline_id, { status: 'error', errorMessage: 'Erro ao sincronizar' })
    }
  } catch { /* retry */ }
}

export function AppLayout() {
  const { user, logout, refreshToken, accessToken } = useAuthStore()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const isAdmin = user?.role === 'admin'
  const [mobileOpen, setMobileOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)

  // Alertas de pedidos parados há 15+ dias — recarrega periodicamente para o badge
  const { data: alertsCount = 0 } = useQuery({
    queryKey: ['order-alerts-count'],
    queryFn: () => ordersApi.alerts().then(r => (r.data as unknown[]).length),
    enabled: !!accessToken,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  })

  const visiblePrimary = navPrimary
  const visibleAdmin = navAdmin.filter(item => !item.adminOnly || isAdmin)

  useEffect(() => { if (online) syncPendingOrders() }, [online])

  // Fecha dropdowns ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function handleLogout() {
    try { if (refreshToken) await authApi.logout(refreshToken) } catch { /* ignore */ }
    logout()
    navigate('/login')
  }

  if (!accessToken) { navigate('/login'); return null }

  const initials = user?.name?.slice(0, 2).toUpperCase() || 'US'

  const navLinkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-1 px-2 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all whitespace-nowrap ${
      isActive
        ? 'bg-white/20 text-white'
        : 'text-white/70 hover:bg-white/10 hover:text-white'
    }`

  return (
    <div className="min-h-screen flex flex-col bg-background">

      {/* ── Offline banner ── */}
      {!online && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-amber-500 text-white text-center text-xs py-1.5 flex items-center justify-center gap-1.5">
          <WifiOff className="h-3.5 w-3.5" />
          Sem conexão — pedidos serão sincronizados quando voltar online
        </div>
      )}

      {/* ── Staging banner ── */}
      {window.location.hostname.includes('staging') && (
        <div className="sticky top-0 z-50 bg-amber-400 text-amber-900 text-center py-1 px-4 text-[12px] font-black tracking-wide flex items-center justify-center gap-2">
          ⚠️ AMBIENTE DE TESTES — os dados aqui NÃO são a produção real ⚠️
        </div>
      )}

      {/* ════════════════════════════
          TOP NAV BAR (desktop)
      ════════════════════════════ */}
      <header
        className="hidden lg:flex sticky top-0 z-40 items-center gap-0.5 px-3 shadow-lg flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)', height: 52 }}
      >
        {/* Logo */}
        <NavLink to="/dashboard" className="flex-shrink-0 mr-2">
          <img src="/logo-forca-vendas-branco.png" alt="Somma" className="h-7 w-auto" />
        </NavLink>

        {/* Nav principal */}
        {visiblePrimary.map(item => (
          <NavLink key={item.to} to={item.to} className={navLinkCls}>
            {item.icon}
            {item.label}
            {!!item.badge && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </NavLink>
        ))}

        {/* Cond. Pagamento — link direto, admin only */}
        {isAdmin && (
          <NavLink to="/payment-conditions" className={navLinkCls}>
            <CreditCard className="h-4 w-4" /> Cond. Pagam.
          </NavLink>
        )}

        {/* Dropdown "Mais" — admin only */}
        {isAdmin && (
          <div ref={moreRef} className="relative">
            <button
              onClick={() => setMoreOpen(v => !v)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all whitespace-nowrap text-white/70 hover:bg-white/10 hover:text-white ${moreOpen ? 'bg-white/20 text-white' : ''}`}
            >
              Mais <ChevronDown className={`h-3.5 w-3.5 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
            </button>
            {moreOpen && (
              <div className="absolute left-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-outline-variant/20 overflow-hidden z-50 py-1">
                {visibleAdmin.map(item => (
                  <NavLink key={item.to} to={item.to} onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-4 py-2 text-[13px] font-medium transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-on-surface hover:bg-surface-container-low'}`
                    }>
                    <span className="text-outline">{item.icon}</span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Mapas — produto integrado SOMMA Maps (todos os usuários) */}
        <a href={MAPS_URL} target="_blank" rel="noreferrer"
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all whitespace-nowrap text-white/70 hover:bg-white/10 hover:text-white">
          <MapPin className="h-4 w-4" /> Mapas
        </a>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Sino de alertas */}
        <button
          onClick={() => navigate('/orders/alerts')}
          title="Alertas de pedidos em atraso"
          className="relative p-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors mr-1"
        >
          <BellRing className="h-5 w-5" />
          {alertsCount > 0 && (
            <span className="absolute top-0.5 right-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
              {alertsCount > 99 ? '99+' : alertsCount}
            </span>
          )}
        </button>

        {/* Novo pedido */}
        <button
          onClick={() => navigate('/orders/new')}
          className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-[12px] font-bold px-3 py-1.5 rounded-lg border border-white/20 transition-all mr-2"
        >
          <Plus className="h-4 w-4" /> Novo Pedido
        </button>

        {/* User menu */}
        <div ref={userRef} className="relative flex-shrink-0">
          <button
            onClick={() => setUserOpen(v => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-white hover:bg-white/10 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-white/20 border border-white/30 flex items-center justify-center">
              <span className="text-[11px] font-black text-white">{initials}</span>
            </div>
            <div className="text-left hidden xl:block">
              <p className="text-[12px] font-semibold text-white leading-none">{user?.name}</p>
              <p className="text-[10px] text-white/50">{isAdmin ? 'Administrador' : 'Representante'}</p>
            </div>
            <ChevronDown className={`h-3.5 w-3.5 text-white/60 transition-transform ${userOpen ? 'rotate-180' : ''}`} />
          </button>
          {userOpen && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-xl border border-outline-variant/20 overflow-hidden z-50 py-1">
              <div className="px-4 py-2.5 border-b border-outline-variant/20">
                <p className="text-[13px] font-bold text-on-surface">{user?.name}</p>
                <p className="text-[11px] text-outline">{isAdmin ? 'Administrador' : 'Representante'}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="text-[11px] text-outline">{online ? 'Online' : 'Offline'}</span>
                </div>
              </div>
              <NavLink to="/settings" onClick={() => setUserOpen(false)}
                className="flex items-center gap-2 px-4 py-2 text-[13px] text-on-surface hover:bg-surface-container-low transition-colors">
                <Settings className="h-4 w-4 text-outline" /> Ajustes
              </NavLink>
              <div className="mx-4 my-1 border-t border-outline-variant/20" />
              <button onClick={handleLogout}
                className="w-full flex items-center gap-2 px-4 py-2 text-[13px] text-red-600 hover:bg-red-50 transition-colors">
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ════════════════════════════
          MOBILE TOP BAR
      ════════════════════════════ */}
      <header
        className="lg:hidden sticky top-0 z-40 flex items-center px-4 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #1a1a2e, #0f3460)', height: 52 }}
      >
        <button onClick={() => setMobileOpen(true)} className="p-1.5 text-white/70 hover:text-white mr-2">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex-1 flex justify-center">
          <img src="/logo-forca-vendas-branco.png" alt="Somma" className="h-10 w-auto" />
        </div>
        <div className="flex items-center gap-2">
          {online ? <Wifi className="h-4 w-4 text-emerald-400" /> : <WifiOff className="h-4 w-4 text-amber-400" />}
        </div>
      </header>

      {/* ════════════════════════════
          MOBILE DRAWER
      ════════════════════════════ */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="relative w-72 flex flex-col"
            style={{ background: 'linear-gradient(180deg, #1a1a2e, #0f3460)' }}>
            <div className="flex items-center justify-between px-5 py-4">
              <img src="/logo-forca-vendas-branco.png" alt="Somma" className="h-10 w-auto" />
              <button onClick={() => setMobileOpen(false)} className="text-white/50 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
              {[...visiblePrimary, ...(isAdmin ? visibleAdmin : [])].map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-2.5 rounded-xl text-[14px] font-semibold transition-all ${
                      isActive ? 'bg-white/20 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  {item.icon} {item.label}
                  {!!item.badge && (
                    <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </NavLink>
              ))}
              {/* Mapas — produto integrado */}
              <a href={MAPS_URL} target="_blank" rel="noreferrer" onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-[14px] font-semibold text-white/60 hover:bg-white/10 hover:text-white transition-all">
                <MapPin className="h-4 w-4" /> Mapas
              </a>
            </nav>
            <div className="px-4 py-4 border-t border-white/10">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                  <span className="text-[12px] font-black text-white">{initials}</span>
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-white">{user?.name}</p>
                  <p className="text-[11px] text-white/40">{isAdmin ? 'Administrador' : 'Representante'}</p>
                </div>
              </div>
              <button onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-red-400 hover:bg-white/10 rounded-lg transition-colors">
                <LogOut className="h-4 w-4" /> Sair
              </button>
              <p className="text-center text-[9px] text-white/25 mt-3">SOMMA Technology · Erechim | RS</p>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════
          CONTENT
      ════════════════════════════ */}
      <main className={`flex-1 overflow-auto main-content ${!online ? 'mt-7' : ''}`}>
        <Outlet />
      </main>

      {/* ── Mobile Bottom Nav ── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 safe-bottom"
        style={{ background: 'white', boxShadow: '0 -1px 0 #E5E7EB, 0 -4px 16px rgba(0,0,0,0.06)' }}>
        <div className="flex items-end justify-around px-1 pt-1 pb-1" style={{ height: 64 }}>
          {[
            { to: '/dashboard', icon: <LayoutDashboard className="h-[18px] w-[18px]" />, label: 'Início' },
            { to: '/orders',    icon: <ShoppingCart className="h-[18px] w-[18px]" />,    label: 'Pedidos' },
            { to: '/orders/new', icon: <Plus className="h-5 w-5" />,                     label: 'Novo', fab: true },
            { to: '/clients',   icon: <Users className="h-[18px] w-[18px]" />,           label: 'Clientes' },
            { to: '/products',  icon: <Package className="h-[18px] w-[18px]" />,         label: 'Produtos' },
          ].map(item => item.fab ? (
            <button key={item.to} onClick={() => navigate(item.to)}
              className="flex flex-col items-center justify-center mb-4 w-14 h-14 rounded-full shadow-lg"
              style={{ background: 'linear-gradient(135deg,#6D28D9,#4C1D95)' }}>
              <span className="text-white">{item.icon}</span>
            </button>
          ) : (
            <NavLink key={item.to} to={item.to} className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 w-14 h-12 rounded-2xl transition-all ${isActive ? 'text-primary' : 'text-on-surface-variant/60'}`
            }>
              {({ isActive }) => (<>
                <div className={`w-9 h-6 rounded-xl flex items-center justify-center ${isActive ? 'bg-primary/10' : ''}`}>
                  {item.icon}
                </div>
                <span className="text-[12px] font-semibold">{item.label}</span>
              </>)}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
