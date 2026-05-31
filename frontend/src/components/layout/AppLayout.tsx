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
  PlusCircle,
  UserCog,
  Wifi,
  WifiOff,
  Menu,
  X,
  BarChart2,
  Trash2,
  ChevronDown,
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
{ to: '/price-tables', label: 'Tabelas',    icon: <Tags className="h-5 w-5" />, adminOnly: true },
  { to: '/factories',    label: 'Fábricas',   icon: <Building2 className="h-5 w-5" />, adminOnly: true },
  { to: '/statuses',     label: 'Status',     icon: <Package className="h-5 w-5" />, adminOnly: true },
  { to: '/users',        label: 'Usuários',   icon: <UserCog className="h-5 w-5" />, adminOnly: true },
  { to: '/orders/trash', label: 'Lixeira',    icon: <Trash2 className="h-5 w-5" />, adminOnly: true },
]

const mobileNav: NavItem[] = [
  { to: '/dashboard', label: 'Início',   icon: <LayoutDashboard className="h-5 w-5" /> },
  { to: '/orders',    label: 'Pedidos',  icon: <ShoppingCart className="h-5 w-5" /> },
  { to: '/products',  label: 'Produtos', icon: <Package className="h-5 w-5" /> },
  { to: '/clients',   label: 'Clientes', icon: <Users className="h-5 w-5" /> },
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
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/40">
              <ShoppingCart className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="font-display text-[15px] font-bold text-white leading-none tracking-wide">Somma</p>
              <p className="text-[9px] text-surface-variant/50 font-medium tracking-widest uppercase mt-0.5">Gestão Comercial</p>
            </div>
          </div>
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
                `flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-[16px] font-semibold transition-all duration-150 ${
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
              `flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-[16px] font-semibold transition-all duration-150 ${
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
              <p className="text-[13px] font-semibold text-white truncate">{user?.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="text-[10px] text-surface-variant/40">
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

        {/* ── Desktop TopBar ── */}
        <header className="hidden lg:flex h-topbar sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-outline-variant/60 items-center justify-between px-8 shadow-sm">
          <div className="flex-1 max-w-md">
            {/* placeholder — search is per-page */}
          </div>
          <div className="flex items-center gap-3">
            <div className="h-5 w-px bg-outline-variant" />
            <button
              onClick={handleLogout}
              className="flex items-center gap-2.5 hover:bg-surface-container px-3 py-1.5 rounded-xl transition-colors"
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm" style={{ background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)' }}>
                <span className="text-[11px] font-bold text-white">{initials}</span>
              </div>
              <div className="text-left">
                <p className="text-[13px] font-semibold text-on-surface leading-none">{user?.name}</p>
                <p className="text-[10px] text-outline mt-0.5">{user?.role === 'admin' ? 'Administrador' : 'Representante'}</p>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-outline" />
            </button>
          </div>
        </header>

        {/* ── Mobile TopBar ── */}
        <header className="lg:hidden sticky top-0 z-30 bg-on-surface border-b border-white/5 flex items-center gap-3 px-4 py-3">
          <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-lg text-surface-variant/60 hover:text-white hover:bg-white/5 transition-colors">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center">
              <ShoppingCart className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-white font-display">Somma</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
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

        {/* ── Mobile Bottom Nav ── */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-outline-variant flex items-center justify-around px-2 h-16 safe-bottom z-30 shadow-sm">
          {mobileNav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 px-4 py-1 rounded-full transition-all duration-200 ${
                  isActive
                    ? 'bg-primary-container text-primary'
                    : 'text-on-surface-variant'
                }`
              }
            >
              {item.icon}
              <span className="text-[9px] font-semibold uppercase tracking-wider">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* ── FAB (mobile) ── */}
        <button
          onClick={() => navigate('/orders/new')}
          className="lg:hidden fixed bottom-20 right-4 w-14 h-14 bg-primary text-white rounded-2xl shadow-lg shadow-primary/30 flex items-center justify-center active:scale-90 transition-transform duration-100 z-40"
        >
          <PlusCircle className="h-6 w-6" />
        </button>
      </div>
    </div>
  )
}
