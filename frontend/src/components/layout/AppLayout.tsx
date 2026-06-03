import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  Building2,
  Tags,
  Settings,
  LogOut,
  Plus,
  UserCog,
  Wifi,
  WifiOff,
  Menu,
  X,
  BarChart2,
  Trash2,

  MapPin,
  Link2,
} from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { authApi } from '../../api/client'
import { db } from '../../db/db'
import { ordersApi } from '../../api/client'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  adminOnly?: boolean
}

const navMain: NavItem[] = [
  { to: '/dashboard',    label: 'Dashboard',  icon: <LayoutDashboard className="h-5 w-5" /> },
  { to: '/orders',       label: 'Pedidos',    icon: <ShoppingCart className="h-5 w-5" /> },
  { to: '/clients',      label: 'Clientes',   icon: <Users className="h-5 w-5" /> },
  { to: '/products',     label: 'Produtos',   icon: <Package className="h-5 w-5" /> },
  { to: '/reports',      label: 'Relatórios', icon: <BarChart2 className="h-5 w-5" /> },
  { to: '/prospecting',  label: 'Prospecção', icon: <MapPin className="h-5 w-5" /> },
  { to: '/portals',      label: 'Portal Cliente', icon: <Link2 className="h-5 w-5" /> },
  { to: '/price-tables', label: 'Tabelas',    icon: <Tags className="h-5 w-5" />, adminOnly: true },
  { to: '/factories',    label: 'Fábricas',   icon: <Building2 className="h-5 w-5" />, adminOnly: true },
  { to: '/statuses',     label: 'Status',     icon: <Package className="h-5 w-5" />, adminOnly: true },
  { to: '/users',        label: 'Usuários',   icon: <UserCog className="h-5 w-5" />, adminOnly: true },
  { to: '/orders/trash', label: 'Lixeira',    icon: <Trash2 className="h-5 w-5" />, adminOnly: true },
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
  } catch { /* retry next time */ }
}

export function AppLayout() {
  const { user, logout, refreshToken, accessToken } = useAuthStore()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const isAdmin = user?.role === 'admin'
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const visibleNav = navMain.filter(item => !item.adminOnly || isAdmin)

  useEffect(() => { if (online) syncPendingOrders() }, [online])

  async function handleLogout() {
    try { if (refreshToken) await authApi.logout(refreshToken) } catch { /* ignore */ }
    logout()
    navigate('/login')
  }

  if (!accessToken) { navigate('/login'); return null }

  const initials = user?.name?.slice(0, 2).toUpperCase() || 'US'

  return (
    <div className="min-h-screen bg-background flex">

      {/* ── Offline banner ── */}
      {!online && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-amber-500 text-white text-center text-xs py-1.5 flex items-center justify-center gap-1.5 safe-top">
          <WifiOff className="h-3.5 w-3.5" />
          Sem conexão — pedidos serão sincronizados quando voltar online
        </div>
      )}

      {/* ── Mobile overlay ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ════════════════════════════════════════
          SIDEBAR
      ════════════════════════════════════════ */}
      <aside
        className={`
          fixed top-0 bottom-0 left-0 z-50 w-sidebar flex flex-col
          transform transition-transform duration-200 ease-in-out
          lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        style={{ background: 'linear-gradient(180deg, #1C0A4A 0%, #160838 60%, #110530 100%)' }}
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-5 py-5 mb-2">
          <img src="/logo-somma-branco.svg" alt="Somma Gestão Comercial" className="h-14 w-auto" />
          <button className="lg:hidden p-1 text-surface-variant/50 hover:text-white transition-colors" onClick={() => setSidebarOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto custom-scrollbar">
          {visibleNav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 rounded-xl text-[16px] font-semibold transition-all duration-150 ${
                  isActive
                    ? 'sidebar-active'
                    : 'text-surface-variant/60 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom */}
        <div className="px-3 pb-4 pt-3 border-t border-white/5 space-y-1">
          <NavLink
            to="/settings"
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2 rounded-xl text-[16px] font-semibold transition-all duration-150 ${
                isActive ? 'sidebar-active' : 'text-surface-variant/60 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <Settings className="h-5 w-5" />
            Ajustes
          </NavLink>

          {/* User card */}
          <div className="mt-2 px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/30 border border-primary/50 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-primary-fixed-dim">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-white truncate">{user?.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="text-[12px] text-surface-variant/40">
                  {user?.role === 'admin' ? 'Administrador' : 'Representante'}
                </p>
                {online
                  ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                  : <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                }
              </div>
            </div>
            <button onClick={handleLogout} className="p-1.5 text-surface-variant/40 hover:text-red-400 transition-colors rounded-lg hover:bg-white/5" title="Sair">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ════════════════════════════════════════
          MAIN AREA
      ════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0 lg:ml-sidebar">

        {/* ── Banner de Ambiente de Testes (staging only) ── */}
        {window.location.hostname.includes('staging') && (
          <div className="sticky top-0 z-50 bg-amber-400 text-amber-900 text-center py-1.5 px-4 text-[13px] font-black tracking-wide shadow-md flex items-center justify-center gap-2">
            <span>⚠️</span>
            <span>AMBIENTE DE TESTES — os dados aqui NÃO são a produção real</span>
            <span>⚠️</span>
          </div>
        )}

        {/* ── Mobile TopBar ── */}
        <header className="lg:hidden sticky top-0 z-30 bg-on-surface border-b border-white/5 flex items-center px-4 py-2.5">
          <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-lg text-surface-variant/60 hover:text-white hover:bg-white/5 transition-colors flex-shrink-0">
            <Menu className="h-5 w-5" />
          </button>
          {/* Logo centralizada no mobile */}
          <div className="flex-1 flex justify-center">
            <img src="/logo-somma-branco.svg" alt="Somma" className="h-9 w-auto" />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {online
              ? <Wifi className="h-4 w-4 text-emerald-400" />
              : <WifiOff className="h-4 w-4 text-amber-400" />
            }
          </div>
        </header>

        {/* ── Page Content ── */}
        <main className={`flex-1 overflow-auto main-content ${!online ? 'mt-7' : ''}`}>
          <Outlet />
        </main>

        {/* ── Mobile Bottom Nav with center FAB ── */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 safe-bottom" style={{ background: 'white', boxShadow: '0 -1px 0 #E5E7EB, 0 -4px 16px rgba(0,0,0,0.06)' }}>
          <div className="flex items-end justify-around px-1 pt-1 pb-1" style={{ height: 64 }}>

            {/* Início */}
            <NavLink to="/dashboard" className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 w-14 h-12 rounded-2xl transition-all ${isActive ? 'text-primary' : 'text-on-surface-variant/60'}`
            }>
              {({ isActive }) => (<>
                <div className={`w-9 h-6 rounded-xl flex items-center justify-center transition-all ${isActive ? 'bg-primary/10' : ''}`}>
                  <LayoutDashboard className="h-[18px] w-[18px]" />
                </div>
                <span className="text-[12px] font-semibold">Início</span>
              </>)}
            </NavLink>

            {/* Pedidos */}
            <NavLink to="/orders" className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 w-14 h-12 rounded-2xl transition-all ${isActive ? 'text-primary' : 'text-on-surface-variant/60'}`
            }>
              {({ isActive }) => (<>
                <div className={`w-9 h-6 rounded-xl flex items-center justify-center transition-all ${isActive ? 'bg-primary/10' : ''}`}>
                  <ShoppingCart className="h-[18px] w-[18px]" />
                </div>
                <span className="text-[12px] font-semibold">Pedidos</span>
              </>)}
            </NavLink>

            {/* FAB central */}
            <div className="flex flex-col items-center" style={{ marginTop: -20 }}>
              <button
                onClick={() => navigate('/orders/new')}
                className="w-14 h-14 rounded-2xl bg-primary text-white flex items-center justify-center shadow-lg active:scale-90 transition-transform"
                style={{ boxShadow: '0 4px 20px rgba(109,40,217,0.45)' }}
              >
                <Plus className="h-6 w-6" />
              </button>
              <span className="text-[12px] font-semibold text-on-surface-variant/60 mt-0.5">Novo</span>
            </div>

            {/* Clientes */}
            <NavLink to="/clients" className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 w-14 h-12 rounded-2xl transition-all ${isActive ? 'text-primary' : 'text-on-surface-variant/60'}`
            }>
              {({ isActive }) => (<>
                <div className={`w-9 h-6 rounded-xl flex items-center justify-center transition-all ${isActive ? 'bg-primary/10' : ''}`}>
                  <Users className="h-[18px] w-[18px]" />
                </div>
                <span className="text-[12px] font-semibold">Clientes</span>
              </>)}
            </NavLink>

            {/* Prospecção */}
            <NavLink to="/prospecting" className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 w-14 h-12 rounded-2xl transition-all ${isActive ? 'text-primary' : 'text-on-surface-variant/60'}`
            }>
              {({ isActive }) => (<>
                <div className={`w-9 h-6 rounded-xl flex items-center justify-center transition-all ${isActive ? 'bg-primary/10' : ''}`}>
                  <MapPin className="h-[18px] w-[18px]" />
                </div>
                <span className="text-[10px] font-semibold">Prospecção</span>
              </>)}
            </NavLink>

          </div>
        </nav>
      </div>
    </div>
  )
}

