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
  BookOpen,
  UserCog,
  Wifi,
  WifiOff,
  Menu,
  X,
  ChevronRight,
  Shirt,
  BarChart2,
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

const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  { to: '/orders', label: 'Pedidos', icon: <ShoppingCart className="h-5 w-5" /> },
  { to: '/clients', label: 'Clientes', icon: <Users className="h-5 w-5" /> },
  { to: '/products', label: 'Produtos', icon: <Shirt className="h-5 w-5" /> },
  { to: '/reports', label: 'Relatórios', icon: <BarChart2 className="h-5 w-5" /> },
  { to: '/catalog', label: 'Catálogo', icon: <BookOpen className="h-5 w-5" />, adminOnly: true },
  { to: '/price-tables', label: 'Tabelas', icon: <Tags className="h-5 w-5" />, adminOnly: true },
  { to: '/factories', label: 'Fábricas', icon: <Building2 className="h-5 w-5" />, adminOnly: true },
  { to: '/statuses', label: 'Status', icon: <Package className="h-5 w-5" />, adminOnly: true },
  { to: '/users', label: 'Usuários', icon: <UserCog className="h-5 w-5" />, adminOnly: true },
  { to: '/settings', label: 'Ajustes', icon: <Settings className="h-5 w-5" /> },
]

const mobileNav: NavItem[] = [
  { to: '/dashboard', label: 'Início', icon: <LayoutDashboard className="h-5 w-5" /> },
  { to: '/orders', label: 'Pedidos', icon: <ShoppingCart className="h-5 w-5" /> },
  { to: '/clients', label: 'Clientes', icon: <Users className="h-5 w-5" /> },
  { to: '/products', label: 'Produtos', icon: <Shirt className="h-5 w-5" /> },
]

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
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
      if (r.synced) {
        await db.pendingOrders.delete(r.offline_id)
      } else {
        await db.pendingOrders.update(r.offline_id, { status: 'error', errorMessage: 'Erro ao sincronizar' })
      }
    }
  } catch {
    // Will retry next time online
  }
}

export function AppLayout() {
  const { user, logout, refreshToken } = useAuthStore()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const isAdmin = user?.role === 'admin'
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { accessToken } = useAuthStore()

  const visibleNavItems = navItems.filter((item) => !item.adminOnly || isAdmin)

  useEffect(() => {
    if (online) syncPendingOrders()
  }, [online])

  async function handleLogout() {
    try {
      if (refreshToken) await authApi.logout(refreshToken)
    } catch { /* ignore */ }
    logout()
    navigate('/login')
  }

  if (!accessToken) {
    navigate('/login')
    return null
  }

  return (
    <div className="min-h-screen bg-slate-100 flex">
      {/* Offline Banner */}
      {!online && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-center text-xs py-1.5 flex items-center justify-center gap-1.5 safe-top">
          <WifiOff className="h-3.5 w-3.5" />
          Sem conexão — pedidos serão sincronizados quando voltar online
        </div>
      )}

      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`
          fixed top-0 bottom-0 left-0 z-40 w-64 bg-slate-900 flex flex-col
          transform transition-transform duration-200 ease-in-out
          lg:translate-x-0 lg:static lg:flex
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo / Brand */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-900/50">
              <ShoppingCart className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-none tracking-wide">Somma</p>
              <p className="text-xs text-slate-400 mt-0.5">Gestão Comercial</p>
            </div>
          </div>
          <button
            className="lg:hidden p-1 text-slate-400 hover:text-white transition-colors"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`
              }
            >
              {item.icon}
              {item.label}
              {item.to === '/orders' && (
                <ChevronRight className="h-4 w-4 ml-auto opacity-50" />
              )}
            </NavLink>
          ))}
        </nav>

        {/* New Order CTA */}
        <div className="px-3 py-3 border-t border-slate-800">
          <button
            onClick={() => { navigate('/orders/new'); setSidebarOpen(false) }}
            className="flex items-center gap-2 w-full px-3 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl text-sm font-bold transition-colors shadow-md shadow-amber-900/20"
          >
            <PlusCircle className="h-4 w-4" />
            Novo Pedido
          </button>
        </div>

        {/* User info */}
        <div className="px-3 py-3 border-t border-slate-800">
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="w-8 h-8 bg-indigo-600/30 rounded-full flex items-center justify-center flex-shrink-0 border border-indigo-500/40">
              <span className="text-xs font-bold text-indigo-300">
                {user?.name?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-200 truncate">{user?.name}</p>
              <p className="text-xs text-slate-500">
                {user?.role === 'admin' ? 'Administrador' : 'Representante'}
              </p>
            </div>
            <div className="flex-shrink-0">
              {online ? (
                <Wifi className="h-4 w-4 text-emerald-400" />
              ) : (
                <WifiOff className="h-4 w-4 text-amber-400" />
              )}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full mt-2 px-3 py-2 text-sm text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile) */}
        <header className="lg:hidden sticky top-0 z-30 bg-slate-900 border-b border-slate-800 flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-indigo-600 rounded-md flex items-center justify-center">
              <ShoppingCart className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-white">Somma</span>
            <span className="text-sm text-slate-400">Pedidos</span>
          </div>
          <div className="ml-auto">
            {online ? (
              <Wifi className="h-4 w-4 text-emerald-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-amber-400" />
            )}
          </div>
        </header>

        {/* Page content */}
        <main className={`flex-1 overflow-auto ${!online ? 'mt-7' : ''}`}>
          <Outlet />
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 flex safe-bottom z-30">
          {mobileNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
                  isActive ? 'text-indigo-400' : 'text-slate-500'
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
          <button
            onClick={() => navigate('/orders/new')}
            className="flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-bold text-amber-400"
          >
            <PlusCircle className="h-5 w-5" />
            Novo
          </button>
        </nav>
      </div>
    </div>
  )
}
