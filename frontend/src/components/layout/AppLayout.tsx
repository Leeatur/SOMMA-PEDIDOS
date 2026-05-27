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

// Mobile bottom nav — show only top 4 items
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
    if (online) {
      syncPendingOrders()
    }
  }, [online])

  async function handleLogout() {
    try {
      if (refreshToken) await authApi.logout(refreshToken)
    } catch {
      // ignore
    }
    logout()
    navigate('/login')
  }

  if (!accessToken) {
    navigate('/login')
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Offline Banner */}
      {!online && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-orange-500 text-white text-center text-xs py-1.5 flex items-center justify-center gap-1.5 safe-top">
          <WifiOff className="h-3.5 w-3.5" />
          Sem conexão — pedidos serão sincronizados quando voltar online
        </div>
      )}

      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 bottom-0 left-0 z-40 w-64 bg-white border-r border-gray-200 flex flex-col
          transform transition-transform duration-200 ease-in-out
          lg:translate-x-0 lg:static lg:flex
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-700 rounded-lg flex items-center justify-center">
              <ShoppingCart className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-none">Somma</p>
              <p className="text-xs text-gray-500">Pedidos</p>
            </div>
          </div>
          <button
            className="lg:hidden p-1 text-gray-400 hover:text-gray-600"
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
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              {item.icon}
              {item.label}
              {item.to === '/orders' && (
                <ChevronRight className="h-4 w-4 ml-auto text-gray-300" />
              )}
            </NavLink>
          ))}
        </nav>

        {/* New Order CTA */}
        <div className="px-3 py-3 border-t border-gray-100">
          <button
            onClick={() => { navigate('/orders/new'); setSidebarOpen(false) }}
            className="flex items-center gap-2 w-full px-3 py-2.5 bg-blue-700 text-white rounded-lg text-sm font-medium hover:bg-blue-800 transition-colors"
          >
            <PlusCircle className="h-4 w-4" />
            Novo Pedido
          </button>
        </div>

        {/* User info */}
        <div className="px-3 py-3 border-t border-gray-100">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-blue-700">
                {user?.name?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{user?.name}</p>
              <p className="text-xs text-gray-500">
                {user?.role === 'admin' ? 'Administrador' : 'Representante'}
              </p>
            </div>
            {/* Online indicator */}
            <div className="flex-shrink-0">
              {online ? (
                <Wifi className="h-4 w-4 text-emerald-500" />
              ) : (
                <WifiOff className="h-4 w-4 text-orange-400" />
              )}
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full mt-2 px-3 py-2 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile) */}
        <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-gray-200 flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-700 rounded-md flex items-center justify-center">
              <ShoppingCart className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-gray-900">Somma Pedidos</span>
          </div>
          <div className="ml-auto">
            {online ? (
              <Wifi className="h-4 w-4 text-emerald-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-orange-400" />
            )}
          </div>
        </header>

        {/* Page content */}
        <main className={`flex-1 overflow-auto ${!online ? 'mt-7' : ''}`}>
          <Outlet />
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex safe-bottom z-30">
          {mobileNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
                  isActive ? 'text-blue-700' : 'text-gray-500'
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
          <button
            onClick={() => navigate('/orders/new')}
            className="flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium text-blue-700"
          >
            <PlusCircle className="h-5 w-5" />
            Novo
          </button>
        </nav>
      </div>
    </div>
  )
}
