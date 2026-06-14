import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, ShoppingCart, Users, BarChart3, Package, TrendingUp, Shield } from 'lucide-react'
import { authApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'

const isDev = window.location.hostname.startsWith('dev.') || import.meta.env.DEV

const FEATURES = [
  {
    icon: <ShoppingCart className="h-5 w-5" />,
    tag: 'PEDIDOS',
    title: 'Gestão de pedidos',
    desc: 'Emita, acompanhe e gerencie todos os pedidos da equipe em tempo real.',
  },
  {
    icon: <Users className="h-5 w-5" />,
    tag: 'CLIENTES',
    title: 'CRM de clientes',
    desc: 'Histórico completo de compras, contatos e status por representante.',
  },
  {
    icon: <BarChart3 className="h-5 w-5" />,
    tag: 'RELATÓRIOS',
    title: 'Comissões e metas',
    desc: 'Relatórios de comissão por pedido, por rep e metas do período.',
  },
  {
    icon: <Package className="h-5 w-5" />,
    tag: 'PRONTA ENTREGA',
    title: 'Catálogo online PE',
    desc: 'Portal de pedidos de pronta entrega direto para o cliente comprar.',
  },
]

export function Login() {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) { setError('Preencha e-mail e senha.'); return }
    setLoading(true); setError('')
    try {
      const res = await authApi.login(email, password)
      const { accessToken, refreshToken, user } = res.data
      login(user, accessToken, refreshToken)
      navigate('/dashboard')
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Erro ao fazer login. Verifique suas credenciais.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">

      {/* ══ PAINEL ESQUERDO — marketing ══ */}
      <div
        className="hidden lg:flex lg:w-[58%] flex-col justify-between p-10 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)' }}
      >
        {/* Padrão de pontos decorativos */}
        <div className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '28px 28px' }} />

        {/* Círculo decorativo laranja */}
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #E07B27, transparent 70%)' }} />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #E07B27, transparent 70%)' }} />

        {/* Header */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <img src="/logo-forca-vendas-branco.png" alt="Força de Vendas" className="h-12 w-auto" />
            {isDev && (
              <span className="px-2 py-0.5 bg-amber-400 text-amber-900 text-[10px] font-black rounded-full tracking-widest">
                DEV
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-4">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
            <span className="text-[11px] font-bold tracking-[2px] text-orange-300/80 uppercase">
              Gestão Comercial Inteligente
            </span>
          </div>

          <h1 className="mt-5 text-4xl font-black text-white leading-tight">
            Sua equipe de vendas<br />
            <span style={{ color: '#E07B27' }}>em um só lugar.</span>
          </h1>
          <p className="mt-3 text-white/50 text-base max-w-md">
            Pedidos, clientes, comissões e catálogo de pronta entrega — tudo integrado para o representante vender mais.
          </p>
        </div>

        {/* Cards de funcionalidades */}
        <div className="relative z-10 grid grid-cols-2 gap-3 my-8">
          {FEATURES.map(f => (
            <div key={f.tag}
              className="rounded-2xl p-4 border border-white/10 backdrop-blur-sm"
              style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-orange-400">{f.icon}</span>
                <span className="text-[10px] font-bold tracking-widest text-white/40 uppercase">{f.tag}</span>
              </div>
              <p className="text-[13px] font-bold text-white mb-1">{f.title}</p>
              <p className="text-[11px] text-white/40 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Rodapé esquerdo */}
        <div className="relative z-10 flex items-center gap-6 text-white/30 text-[11px] font-medium">
          <span className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" /> Seguro</span>
          <span className="flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> 100% web</span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Tempo real
          </span>
        </div>
      </div>

      {/* ══ PAINEL DIREITO — login ══ */}
      <div className="flex-1 flex flex-col min-h-screen bg-white">

        {/* Mobile: logo topo */}
        <div className="lg:hidden flex flex-col items-center pt-10 pb-4"
          style={{ background: 'linear-gradient(135deg,#1a1a2e,#0f3460)' }}>
          <img src="/logo-forca-vendas-branco.png" alt="Força de Vendas" className="h-14 w-auto" />
          {isDev && (
            <span className="mt-2 px-2 py-0.5 bg-amber-400 text-amber-900 text-[10px] font-black rounded-full tracking-widest">
              AMBIENTE DEV
            </span>
          )}
        </div>

        <div className="flex-1 flex flex-col justify-center px-8 py-10 max-w-md w-full mx-auto">

          {/* Cabeçalho formulário */}
          <div className="mb-8">
            <h2 className="text-2xl font-black text-gray-900">Bem-vindo de volta</h2>
            <p className="text-sm text-gray-400 mt-1">Acesse sua conta para continuar</p>
          </div>

          {/* Banner DEV */}
          {isDev && (
            <div className="mb-4 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
              <span className="text-amber-500 text-[11px] font-black tracking-widest">DEV</span>
              <span className="text-amber-700 text-[12px]">Você está no ambiente de desenvolvimento</span>
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Formulário */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5" htmlFor="email">
                E-mail
              </label>
              <input
                id="email" type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                autoComplete="email" autoFocus
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 placeholder:text-gray-300 focus:border-orange-400 focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5" htmlFor="password">
                Senha
              </label>
              <div className="relative">
                <input
                  id="password" type={showPwd ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 pr-12 text-base text-gray-900 placeholder:text-gray-300 focus:border-orange-400 focus:outline-none transition-colors"
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors">
                  {showPwd ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit" disabled={loading}
              className="w-full py-3.5 rounded-xl font-black text-base text-white transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2 mt-2"
              style={{ background: loading ? '#9ca3af' : 'linear-gradient(135deg,#E07B27,#c96a1a)', boxShadow: loading ? 'none' : '0 4px 20px rgba(224,123,39,0.35)' }}
            >
              {loading ? (
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              ) : (
                <> Entrar <span className="ml-1">→</span> </>
              )}
            </button>
          </form>
        </div>

        {/* Rodapé direito */}
        <footer className="text-center py-5 border-t border-gray-100">
          <p className="text-[11px] text-gray-300 font-medium">SOMMA Technology</p>
          <p className="text-[10px] text-gray-200 mt-0.5">Erechim | RS · (54) 9.9162-5024</p>
        </footer>
      </div>
    </div>
  )
}
