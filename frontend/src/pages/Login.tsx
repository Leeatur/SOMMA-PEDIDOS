import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, ShoppingCart, Users, BarChart3, Package, TrendingUp, Shield, LogIn } from 'lucide-react'
import { authApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'

const isDev = window.location.hostname.startsWith('dev.') || window.location.hostname === 'localhost'

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
        className="hidden lg:flex lg:w-[58%] flex-col justify-between p-8 relative overflow-hidden"
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
            <img src="/logo-forca-vendas-branco.png" alt="Força de Vendas" className="h-16 w-auto" />
            {isDev && (
              <span className="px-2 py-0.5 bg-amber-400 text-amber-900 text-[10px] font-black rounded-full tracking-widest">
                DEV
              </span>
            )}
          </div>
          <div className="mt-4">
            <span className="inline-flex items-center px-3 py-0.5 rounded-full border border-white/20 text-[10px] font-bold tracking-[2px] text-orange-300/80 uppercase">
              Força de Vendas Inteligente
            </span>
          </div>

          <h1 className="mt-5 text-3xl lg:text-[2.75rem] font-black text-white leading-[1.08]">
            Sua equipe de vendas<br />
            <span style={{ color: '#E07B27' }}>em um só lugar.</span>
          </h1>
          <p className="mt-3 text-white/55 text-base max-w-lg leading-relaxed">
            Pedidos, clientes, comissões e catálogo de pronta entrega — tudo integrado para o representante vender mais.
          </p>
        </div>

        {/* Cards de funcionalidades */}
        <div className="relative z-10 grid grid-cols-2 gap-3.5 my-6">
          {FEATURES.map(f => (
            <div key={f.tag}
              className="rounded-2xl p-4 border border-white/10 backdrop-blur-sm"
              style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-orange-400 [&_svg]:h-[18px] [&_svg]:w-[18px]">{f.icon}</span>
                <span className="text-[11px] font-bold tracking-widest text-white/45 uppercase">{f.tag}</span>
              </div>
              <p className="text-base font-bold text-white mb-1">{f.title}</p>
              <p className="text-[13px] text-white/45 leading-relaxed">{f.desc}</p>
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
            <h2 className="text-4xl font-black text-gray-900">Bem-vindo de volta</h2>
            <p className="text-base text-gray-400 mt-2">Acesse sua conta para continuar.</p>
          </div>

          {/* Erro */}
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Formulário */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1.5" htmlFor="email">
                E-mail
              </label>
              <input
                id="email" type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                autoComplete="email" autoFocus
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 placeholder:text-gray-300 focus:border-orange-400 focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-1.5" htmlFor="password">
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
                <><LogIn className="h-5 w-5" /> Entrar</>
              )}
            </button>

            {/* Links secundários */}
            <div className="flex items-center justify-between pt-1">
              <a
                href="https://sommatechnology.com.br"
                target="_blank" rel="noopener noreferrer"
                className="text-[12px] text-gray-400 hover:text-orange-500 transition-colors"
              >
                Criar conta
              </a>
              <button
                type="button"
                onClick={() => setError('Entre em contato com o administrador do sistema para redefinir sua senha.')}
                className="text-[12px] text-gray-400 hover:text-orange-500 transition-colors"
              >
                Esqueci minha senha
              </button>
            </div>
          </form>

          {/* Suporte */}
          <p className="mt-6 text-center text-[11px] text-gray-300">
            Precisa de ajuda?{' '}
            <a
              href="https://wa.me/5554991625024"
              target="_blank" rel="noopener noreferrer"
              className="text-orange-400 hover:underline font-medium"
            >
              Fale com o suporte
            </a>
          </p>
        </div>

        {/* Rodapé direito */}
        <footer className="text-center py-3 border-t border-gray-100">
          <p className="text-[11px] text-gray-400 font-medium flex items-center justify-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 text-orange-400" />
            <span className="font-semibold text-gray-500">Força de Vendas</span>
            <span className="text-gray-300">|</span>
            <span>SOMMA Technology — Erechim | RS — (54) 9.9162-5024</span>
          </p>
        </footer>
      </div>
    </div>
  )
}
