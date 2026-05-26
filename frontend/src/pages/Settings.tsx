import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Smartphone,
  Wifi,
  WifiOff,
  Database,
  Trash2,
  RefreshCw,
  ShieldCheck,
  Building2,
  Upload,
  Save,
  CheckCircle2,
  Image as ImageIcon,
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { db } from '../db/db'
import { companyApi } from '../api/client'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Input, Textarea } from '../components/ui/Input'

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

type CompanyForm = Record<string, string>

function CompanySection() {
  const qc = useQueryClient()
  const logoRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<CompanyForm>({})
  const [saved, setSaved] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const { data: settings, isLoading } = useQuery<CompanyForm>({
    queryKey: ['company'],
    queryFn: () => companyApi.get().then(r => r.data),
  })

  useEffect(() => {
    if (settings) {
      setForm(settings)
      if (settings.logo_url) setLogoPreview(settings.logo_url)
    }
  }, [settings])

  const saveMut = useMutation({
    mutationFn: () => companyApi.update(form),
    onSuccess: (res) => {
      qc.setQueryData(['company'], res.data)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const logoMut = useMutation({
    mutationFn: (file: File) => companyApi.uploadLogo(file),
    onSuccess: (res) => {
      const url = (res.data as { logo_url: string }).logo_url
      setLogoPreview(url)
      qc.invalidateQueries({ queryKey: ['company'] })
    },
  })

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // local preview
    const reader = new FileReader()
    reader.onload = ev => setLogoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
    logoMut.mutate(file)
  }

  const f = (key: string) => ({
    value: form[key] || '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value })),
  })

  if (isLoading) return (
    <div className="h-20 flex items-center justify-center text-gray-400 text-sm">
      Carregando dados da empresa…
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Logo */}
      <div className="flex items-center gap-4">
        <div
          onClick={() => logoRef.current?.click()}
          className="w-20 h-20 rounded-2xl border-2 border-dashed border-gray-300 hover:border-blue-400 bg-gray-50 hover:bg-blue-50 flex items-center justify-center cursor-pointer transition-colors overflow-hidden flex-shrink-0"
        >
          {logoPreview ? (
            <img
              src={logoPreview.startsWith('data:') ? logoPreview : `/api${logoPreview}`}
              alt="Logo"
              className="w-full h-full object-contain p-1"
            />
          ) : (
            <div className="flex flex-col items-center gap-1 text-gray-400">
              <ImageIcon className="h-6 w-6" />
              <span className="text-[10px] font-medium">Logo</span>
            </div>
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-700">Logo da empresa</p>
          <p className="text-xs text-gray-400 mb-2">PNG ou JPG · aparece no cabeçalho dos pedidos</p>
          <Button
            size="sm"
            variant="outline"
            loading={logoMut.isPending}
            onClick={() => logoRef.current?.click()}
            icon={<Upload className="h-3.5 w-3.5" />}
          >
            {logoPreview ? 'Trocar logo' : 'Enviar logo'}
          </Button>
        </div>
        <input
          ref={logoRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleLogoChange}
        />
      </div>

      {/* Fields */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Input label="Razão Social" {...f('name')} placeholder="Somma Gestão Comercial LTDA" />
        </div>
        <div className="col-span-2">
          <Input label="Nome Fantasia" {...f('trade_name')} placeholder="Somma" />
        </div>
        <Input label="CNPJ" {...f('cnpj')} placeholder="00.000.000/0000-00" />
        <Input label="CEP" {...f('zip')} placeholder="00000-000" />
        <div className="col-span-2">
          <Input label="Endereço" {...f('address')} placeholder="Rua Exemplo, 123" />
        </div>
        <Input label="Cidade" {...f('city')} placeholder="São Paulo" />
        <Input label="UF" {...f('state')} placeholder="SP" />
        <Input label="Telefone" {...f('phone')} placeholder="(11) 3000-0000" />
        <Input label="WhatsApp" {...f('whatsapp')} placeholder="(11) 99000-0000" />
        <div className="col-span-2">
          <Input label="E-mail" {...f('email')} placeholder="contato@somma.com.br" type="email" />
        </div>
        <div className="col-span-2">
          <Input label="Website" {...f('website')} placeholder="www.somma.com.br" />
        </div>
        <div className="col-span-2">
          <Textarea
            label="Rodapé do pedido"
            {...f('order_footer')}
            rows={2}
            placeholder="Texto que aparece no final de cada pedido emitido…"
          />
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3 pt-1">
        <Button
          onClick={() => saveMut.mutate()}
          loading={saveMut.isPending}
          icon={saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          className={saved ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
        >
          {saved ? 'Salvo!' : 'Salvar dados da empresa'}
        </Button>
        {saveMut.isError && (
          <p className="text-xs text-red-600">Erro ao salvar. Tente novamente.</p>
        )}
      </div>
    </div>
  )
}

export function Settings() {
  const { user } = useAuthStore()
  const online = useOnlineStatus()
  const [pendingCount, setPendingCount] = useState(0)
  const [cachedProductsCount, setCachedProductsCount] = useState(0)
  const [cachedClientsCount, setCachedClientsCount] = useState(0)
  const [clearingCache, setClearingCache] = useState(false)

  useEffect(() => {
    async function loadCounts() {
      const pending = await db.pendingOrders.where('status').equals('pending').count()
      const products = await db.products.count()
      const clients = await db.clients.count()
      setPendingCount(pending)
      setCachedProductsCount(products)
      setCachedClientsCount(clients)
    }
    loadCounts()
  }, [])

  async function clearCache() {
    setClearingCache(true)
    try {
      await db.products.clear()
      await db.clients.clear()
      setCachedProductsCount(0)
      setCachedClientsCount(0)
    } finally {
      setClearingCache(false)
    }
  }

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-5 py-4 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-lg font-bold text-gray-900">Configurações</h1>
          <p className="text-xs text-gray-500 mt-0.5">Ajustes do aplicativo</p>
        </div>
      </div>

      <div className="px-4 py-5 lg:px-8 max-w-2xl mx-auto space-y-5">

        {/* ── Empresa (admin only) ── */}
        {user?.role === 'admin' && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" />
              Dados da Empresa
            </h2>
            <Card padding="md">
              <CompanySection />
            </Card>
          </div>
        )}

        {/* Profile */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Conta</h2>
          <Card padding="md">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                <span className="text-xl font-bold text-blue-700">
                  {user?.name?.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <p className="font-semibold text-gray-900">{user?.name}</p>
                <p className="text-sm text-gray-500">{user?.email}</p>
                <Badge variant={user?.role === 'admin' ? 'danger' : 'info'} className="mt-1">
                  {user?.role === 'admin' ? 'Administrador' : 'Representante'}
                </Badge>
              </div>
            </div>
          </Card>
        </div>

        {/* Connectivity */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Conectividade</h2>
          <Card padding="md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {online ? (
                  <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                    <Wifi className="h-5 w-5 text-emerald-600" />
                  </div>
                ) : (
                  <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
                    <WifiOff className="h-5 w-5 text-orange-500" />
                  </div>
                )}
                <div>
                  <p className="font-medium text-gray-900">{online ? 'Online' : 'Offline'}</p>
                  <p className="text-xs text-gray-500">
                    {online ? 'Conectado ao servidor' : 'Trabalhando localmente'}
                  </p>
                </div>
              </div>
              <div
                className={`w-3 h-3 rounded-full ${online ? 'bg-emerald-500 animate-pulse' : 'bg-orange-400'}`}
              />
            </div>

            {pendingCount > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-orange-600">{pendingCount} pedido{pendingCount > 1 ? 's' : ''} pendente{pendingCount > 1 ? 's' : ''}</p>
                    <p className="text-xs text-gray-500">Aguardando sincronização</p>
                  </div>
                  {online && (
                    <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />}>
                      Sincronizar
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Offline cache */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Cache Offline</h2>
          <Card padding="md">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <Database className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="font-medium text-gray-900">Dados em cache</p>
                <p className="text-xs text-gray-500">Usados quando sem conexão</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-gray-900">{cachedProductsCount}</p>
                <p className="text-xs text-gray-500">Produtos</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-gray-900">{cachedClientsCount}</p>
                <p className="text-xs text-gray-500">Clientes</p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              fullWidth
              loading={clearingCache}
              onClick={clearCache}
              icon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Limpar Cache
            </Button>
          </Card>
        </div>

        {/* App info */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Sobre</h2>
          <Card padding="md">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-700 rounded-xl flex items-center justify-center">
                  <ShieldCheck className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Somma Pedidos</p>
                  <p className="text-xs text-gray-500">Versão 1.0.0</p>
                </div>
              </div>
              <div className="pt-3 border-t border-gray-100 text-sm text-gray-500">
                <p>Sistema de Gestão de Pedidos</p>
                <p className="text-xs mt-1">Somma Gestão Comercial &copy; {new Date().getFullYear()}</p>
              </div>
            </div>
          </Card>
        </div>

        {/* PWA install hint */}
        <Card padding="md" className="bg-blue-50 border-blue-200">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-blue-700 rounded-xl flex items-center justify-center flex-shrink-0">
              <Smartphone className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-blue-900">Instalar no celular</p>
              <p className="text-sm text-blue-700 mt-0.5">
                Adicione este app à tela inicial para acesso rápido e uso offline completo.
                No Safari/Chrome, toque em Compartilhar → "Adicionar à Tela Inicial".
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
