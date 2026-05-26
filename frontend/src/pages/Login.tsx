import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { authApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export function Login() {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) {
      setError('Preencha e-mail e senha.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await authApi.login(email, password)
      const { accessToken, refreshToken, user } = res.data
      login(user, accessToken, refreshToken)
      navigate('/dashboard')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Erro ao fazer login. Verifique suas credenciais.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-700 flex flex-col items-center justify-center px-4 py-12">
      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 to-blue-800 px-8 py-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-2xl mb-4">
            <ShoppingCart className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Somma Pedidos</h1>
          <p className="text-blue-200 text-sm mt-1">Gestão Comercial</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-8 py-8 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Entrar</h2>
            <p className="text-sm text-gray-500">Acesse sua conta para continuar</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <Input
            label="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            autoComplete="email"
            autoFocus
            leftIcon={<Mail className="h-4 w-4" />}
          />

          <Input
            label="Senha"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            leftIcon={<Lock className="h-4 w-4" />}
            rightElement={
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />

          <Button type="submit" fullWidth loading={loading} size="lg">
            Entrar
          </Button>
        </form>

        <div className="px-8 pb-6 text-center">
          <p className="text-xs text-gray-400">Somma Gestão Comercial &copy; {new Date().getFullYear()}</p>
        </div>
      </div>
    </div>
  )
}
