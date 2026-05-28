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
    if (!email || !password) { setError('Preencha e-mail e senha.'); return }
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
      setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-on-surface flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-48 -right-48 w-[500px] h-[500px] bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-48 -left-48 w-[500px] h-[500px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl shadow-black/40 overflow-hidden relative z-10">
        {/* Header */}
        <div className="bg-on-surface px-8 py-9 text-center relative overflow-hidden border-b border-white/5">
          <div className="absolute inset-0 opacity-[0.03]"
            style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }}
          />
          <div className="relative">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-primary rounded-xl mb-4 shadow-xl shadow-primary/30">
              <ShoppingCart className="h-7 w-7 text-white" />
            </div>
            <h1 className="font-display text-[22px] font-bold text-white tracking-wide">Somma</h1>
            <p className="text-surface-variant/50 text-[12px] mt-1 font-medium tracking-widest uppercase">Gestão Comercial</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-8 py-7 space-y-5">
          <div>
            <h2 className="font-display text-[18px] font-semibold text-on-surface">Bem-vindo de volta</h2>
            <p className="text-[13px] text-on-surface-variant mt-0.5">Acesse sua conta para continuar</p>
          </div>

          {error && (
            <div className="bg-error-container border border-error/20 rounded-xl px-4 py-3">
              <p className="text-[13px] text-error">{error}</p>
            </div>
          )}

          <Input
            label="E-mail"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="seu@email.com"
            autoComplete="email"
            autoFocus
            leftIcon={<Mail className="h-4 w-4" />}
          />

          <Input
            label="Senha"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            leftIcon={<Lock className="h-4 w-4" />}
            rightElement={
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-outline hover:text-on-surface transition-colors">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />

          <Button type="submit" fullWidth loading={loading} size="lg">
            Entrar
          </Button>
        </form>

        <div className="px-8 pb-5 text-center">
          <p className="text-[11px] text-outline">Somma Gestão Comercial &copy; {new Date().getFullYear()}</p>
        </div>
      </div>
    </div>
  )
}
