import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { authApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'

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
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        backgroundColor: '#131b2e',
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="w-full max-w-[400px] flex flex-col items-center">

        {/* Brand */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-primary-container rounded-xl flex items-center justify-center mb-4 shadow-lg">
            <span
              className="text-white text-4xl select-none"
              style={{ fontFamily: 'Material Symbols Outlined', fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 40" }}
            >
              inventory_2
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Plus Jakarta Sans' }}>Somma</h1>
          <p className="text-[12px] text-outline-variant/80 mt-1 uppercase tracking-widest font-medium">Gestão Comercial</p>
        </div>

        {/* Card */}
        <div className="bg-white w-full rounded-xl p-8 border border-border-subtle shadow-2xl">
          <div className="mb-6 text-center">
            <h2 className="text-lg font-semibold text-on-surface" style={{ fontFamily: 'Plus Jakarta Sans' }}>Bem-vindo de volta</h2>
            <p className="text-[12px] text-on-surface-variant mt-1">Acesse sua conta para continuar</p>
          </div>

          {error && (
            <div className="mb-4 bg-error-container border border-error/20 rounded-xl px-4 py-2">
              <p className="text-[12px] text-error">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-1">
            {/* Email */}
            <div className="space-y-1">
              <label className="text-[12px] font-semibold text-on-surface tracking-wide" htmlFor="email">Email</label>
              <div className="relative flex items-center">
                <span
                  className="absolute left-3 text-outline text-xl select-none"
                  style={{ fontFamily: 'Material Symbols Outlined', fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" }}
                >
                  mail
                </span>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  autoComplete="email"
                  autoFocus
                  className="w-full h-12 pl-10 pr-4 bg-surface-container-low border border-border-subtle rounded-lg text-[12px] text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>
            </div>

            {/* Senha */}
            <div className="space-y-1">
              <label className="text-[12px] font-semibold text-on-surface tracking-wide" htmlFor="password">Senha</label>
              <div className="relative flex items-center">
                <span
                  className="absolute left-3 text-outline text-xl select-none"
                  style={{ fontFamily: 'Material Symbols Outlined', fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" }}
                >
                  lock
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full h-12 pl-10 pr-12 bg-surface-container-low border border-border-subtle rounded-lg text-[12px] text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 text-outline hover:text-on-surface transition-colors"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-primary-container text-on-primary font-semibold text-[12px] rounded-lg shadow-md hover:bg-primary transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-2 disabled:opacity-70"
            >
              {loading ? (
                <span
                  className="text-xl animate-spin select-none"
                  style={{ fontFamily: 'Material Symbols Outlined', fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" }}
                >
                  progress_activity
                </span>
              ) : (
                <>
                  <span>Entrar</span>
                  <span
                    className="text-xl select-none"
                    style={{ fontFamily: 'Material Symbols Outlined', fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" }}
                  >
                    arrow_forward
                  </span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <footer className="mt-6 text-center">
          <p className="text-[12px] text-outline-variant/60">
            © {new Date().getFullYear()} Somma Gestão Comercial
          </p>
        </footer>
      </div>
    </div>
  )
}
