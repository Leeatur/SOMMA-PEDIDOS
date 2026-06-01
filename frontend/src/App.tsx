import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { AppLayout } from './components/layout/AppLayout'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Factories } from './pages/Factories'
import { PriceTables } from './pages/PriceTables'
import { Clients } from './pages/Clients'
import { Orders } from './pages/Orders'
import { NewOrder } from './pages/NewOrder'
import { OrderDetail } from './pages/OrderDetail'
import { Statuses } from './pages/Statuses'
import { Users } from './pages/Users'
import { Settings } from './pages/Settings'
import { OrderPrint } from './pages/OrderPrint'
import { Products } from './pages/Products'
import { Reports } from './pages/Reports'
import { OrdersTrash } from './pages/OrdersTrash'
import OrderEdit from './pages/OrderEdit'
import { Prospecting } from './pages/Prospecting'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuthStore()
  if (!accessToken) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  if (user?.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export function App() {
  const { accessToken } = useAuthStore()

  return (
    <Routes>
      <Route
        path="/login"
        element={accessToken ? <Navigate to="/dashboard" replace /> : <Login />}
      />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/new" element={<NewOrder />} />
        <Route path="/orders/trash" element={<RequireAdmin><OrdersTrash /></RequireAdmin>} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/orders/:id/edit" element={<OrderEdit />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/prospecting" element={<Prospecting />} />
<Route path="/products" element={<Products />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />

        {/* Admin-only routes */}
        <Route
          path="/factories"
          element={
            <RequireAdmin>
              <Factories />
            </RequireAdmin>
          }
        />
        <Route
          path="/price-tables"
          element={
            <RequireAdmin>
              <PriceTables />
            </RequireAdmin>
          }
        />
        <Route
          path="/statuses"
          element={
            <RequireAdmin>
              <Statuses />
            </RequireAdmin>
          }
        />
        <Route
          path="/users"
          element={
            <RequireAdmin>
              <Users />
            </RequireAdmin>
          }
        />
      </Route>

      {/* Página de impressão — sem layout, com autenticação */}
      <Route
        path="/orders/:id/print"
        element={
          <RequireAuth>
            <OrderPrint />
          </RequireAuth>
        }
      />

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
