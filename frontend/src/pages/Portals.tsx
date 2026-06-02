import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, Plus, Copy, Trash2, CheckCircle, Share2, ToggleLeft, ToggleRight, ExternalLink, Building2 } from 'lucide-react'
import { portalsApi, factoriesApi } from '../api/client'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { PageSpinner } from '../components/ui/Spinner'
import { useAuthStore } from '../stores/authStore'

interface Factory { id: string; name: string; logo_url: string | null }
interface Portal {
  id: string; rep_id: string; token: string; name: string
  factory_ids: string[]; factory_names?: string[]
  active: boolean; created_at: string; expires_at: string | null
}

const BASE = 'https://somma-pedidos-production.up.railway.app'

export function Portals() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  // const isAdmin = user?.role === 'admin'

  const [createOpen, setCreateOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', factory_ids: [] as string[] })

  const { data: portals = [], isLoading } = useQuery<Portal[]>({
    queryKey: ['portals'],
    queryFn: () => portalsApi.list().then(r => r.data),
  })

  const { data: factories = [] } = useQuery<Factory[]>({
    queryKey: ['factories'],
    queryFn: () => factoriesApi.list().then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: () => portalsApi.create({ name: form.name, factory_ids: form.factory_ids }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['portals'] }); setCreateOpen(false); setForm({ name: '', factory_ids: [] }) },
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => portalsApi.update(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portals'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => portalsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portals'] }),
  })

  function copyLink(token: string, id: string) {
    navigator.clipboard.writeText(`${BASE}/portal/${token}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function shareWhatsApp(portal: Portal) {
    const url = `${BASE}/portal/${portal.token}`
    const msg = `Olá! Acesse nosso catálogo online e faça seu pedido diretamente:\n\n${url}\n\nDigite seu CNPJ para entrar e visualizar os produtos disponíveis.`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  function shareEmail(portal: Portal) {
    const url = `${BASE}/portal/${portal.token}`
    const subject = `Catálogo Online - Somma Gestão Comercial`
    const body = `Olá,\n\nAcesse nosso catálogo online e faça seu pedido diretamente pelo link abaixo:\n\n${url}\n\nBasta digitar o CNPJ da sua empresa para entrar e visualizar todos os produtos disponíveis.\n\nAtenciosamente,\n${user?.name}`
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)
  }

  if (isLoading) return <PageSpinner />

  return (
    <div className="pb-24 lg:pb-8">
      {/* Header */}
      <div className="bg-white border-b border-outline-variant px-5 py-3 lg:px-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-bold text-on-surface">Portal de Pedidos</h1>
            <p className="text-[12px] text-outline mt-0.5">
              Gere links para clientes fazerem pedidos online
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} icon={<Plus className="h-4 w-4" />} size="sm">
            Novo Link
          </Button>
        </div>
      </div>

      <div className="px-4 py-4 lg:px-8 space-y-3 max-w-4xl">

        {/* Como funciona */}
        <div className="bg-gradient-to-r from-primary/10 to-violet-50 rounded-2xl p-4 border border-primary/20">
          <h3 className="font-bold text-primary text-[13px] mb-2">Como funciona?</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px] text-on-surface-variant">
            <div className="flex gap-2">
              <span className="w-6 h-6 bg-primary text-white rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0">1</span>
              <p>Crie um link e selecione quais marcas o cliente pode ver</p>
            </div>
            <div className="flex gap-2">
              <span className="w-6 h-6 bg-primary text-white rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0">2</span>
              <p>Compartilhe por WhatsApp ou E-mail com o cliente</p>
            </div>
            <div className="flex gap-2">
              <span className="w-6 h-6 bg-primary text-white rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0">3</span>
              <p>O cliente acessa, digita o CNPJ e faz o pedido. Cai direto no sistema!</p>
            </div>
          </div>
        </div>

        {/* Lista de portais */}
        {portals.length === 0 ? (
          <div className="bg-white rounded-2xl border border-outline-variant/40 shadow-sm p-12 flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
              <Link2 className="h-8 w-8 text-primary" />
            </div>
            <p className="font-semibold text-on-surface mb-1">Nenhum link criado ainda</p>
            <p className="text-[12px] text-outline mb-4">Crie um link para enviar aos seus clientes</p>
            <Button onClick={() => setCreateOpen(true)} icon={<Plus className="h-4 w-4" />}>
              Criar Primeiro Link
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {portals.map(portal => (
              <div key={portal.id} className={`bg-white rounded-2xl border shadow-sm p-4 transition-all ${portal.active ? 'border-outline-variant/40' : 'border-outline-variant/20 opacity-60'}`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-on-surface text-[14px]">{portal.name}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${portal.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {portal.active ? '● Ativo' : '○ Inativo'}
                      </span>
                    </div>
                    {/* Fábricas */}
                    {portal.factory_ids?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(portal.factory_names || portal.factory_ids).map((f, i) => (
                          <span key={i} className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                            <Building2 className="h-2.5 w-2.5 inline mr-0.5" />{f}
                          </span>
                        ))}
                      </div>
                    )}
                    {(!portal.factory_ids || portal.factory_ids.length === 0) && (
                      <p className="text-[11px] text-outline mt-0.5">Todas as fábricas disponíveis</p>
                    )}
                  </div>
                  {/* Toggle ativo/inativo */}
                  <button
                    onClick={() => toggleMut.mutate({ id: portal.id, active: !portal.active })}
                    className={`flex-shrink-0 transition-colors ${portal.active ? 'text-emerald-500 hover:text-emerald-700' : 'text-outline/50 hover:text-on-surface'}`}
                    title={portal.active ? 'Desativar link' : 'Ativar link'}
                  >
                    {portal.active
                      ? <ToggleRight className="h-6 w-6" />
                      : <ToggleLeft className="h-6 w-6" />
                    }
                  </button>
                </div>

                {/* URL do link */}
                <div className="flex items-center gap-2 bg-surface-container-low rounded-xl px-3 py-2 mb-3">
                  <Link2 className="h-3.5 w-3.5 text-outline flex-shrink-0" />
                  <p className="text-[11px] text-outline font-mono truncate flex-1">
                    {BASE}/portal/{portal.token.substring(0, 20)}...
                  </p>
                </div>

                {/* Ações — scroll horizontal no mobile */}
                <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                  <button
                    onClick={() => copyLink(portal.token, portal.id)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container transition-colors"
                  >
                    {copiedId === portal.id ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedId === portal.id ? 'Copiado!' : 'Copiar Link'}
                  </button>

                  <button
                    onClick={() => shareWhatsApp(portal)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-[12px] font-semibold transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp
                  </button>

                  <button
                    onClick={() => shareEmail(portal)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold transition-colors"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    E-mail
                  </button>

                  <a
                    href={`/portal/${portal.token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Visualizar
                  </a>

                  <button
                    onClick={() => window.confirm('Excluir este link? O cliente não conseguirá mais acessar.') && deleteMut.mutate(portal.id)}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 text-[12px] transition-colors ml-auto"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Criar Link */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Criar Link de Catálogo"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              loading={createMut.isPending}
              disabled={!form.name.trim()}
              onClick={() => createMut.mutate()}
              icon={<Link2 className="h-4 w-4" />}
            >
              Criar Link
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Nome do catálogo"
            placeholder="Ex: Catálogo Inverno 2026 - Coleção Principal"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            autoFocus
          />

          <div>
            <label className="block text-[13px] font-medium text-on-surface mb-2">
              Marcas disponíveis
            </label>
            <p className="text-[12px] text-outline mb-2">
              Selecione as marcas que o cliente poderá ver. Se não selecionar nenhuma, todas ficam disponíveis.
            </p>
            <div className="space-y-2">
              {factories.map(f => (
                <label key={f.id} className="flex items-center gap-3 cursor-pointer p-2.5 rounded-xl border border-outline-variant/40 hover:bg-surface-container-low transition-colors">
                  <input
                    type="checkbox"
                    checked={form.factory_ids.includes(f.id)}
                    onChange={e => {
                      if (e.target.checked) {
                        setForm(prev => ({ ...prev, factory_ids: [...prev.factory_ids, f.id] }))
                      } else {
                        setForm(prev => ({ ...prev, factory_ids: prev.factory_ids.filter(id => id !== f.id) }))
                      }
                    }}
                    className="w-4 h-4 accent-primary rounded"
                  />
                  <div className="flex items-center gap-2 flex-1">
                    {f.logo_url
                      ? <img src={f.logo_url} alt={f.name} className="h-6 w-12 object-contain" />
                      : <div className="h-6 w-12 bg-surface-container rounded flex items-center justify-center"><Building2 className="h-3.5 w-3.5 text-outline" /></div>
                    }
                    <span className="text-[13px] font-semibold text-on-surface">{f.name}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {form.factory_ids.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[12px] text-amber-700">
              ⚠️ Nenhuma marca selecionada — o cliente verá TODAS as marcas disponíveis.
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
