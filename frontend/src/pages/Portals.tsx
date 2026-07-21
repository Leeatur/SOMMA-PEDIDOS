import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, Plus, Copy, Trash2, CheckCircle, Share2, ToggleLeft, ToggleRight, ExternalLink, Tags } from 'lucide-react'
import { portalsApi, priceTablesApi } from '../api/client'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { PageSpinner } from '../components/ui/Spinner'
import { useAuthStore } from '../stores/authStore'

interface PriceTable { id: string; name: string; factory_name: string; collection: string | null; season: string | null; year: number | null }
interface PriceTableInfo { id: string; name: string; factory_name: string }
interface Portal {
  id: string; rep_id: string; token: string; name: string
  factory_ids: string[]; price_table_ids: string[]
  factory_names?: string[]
  price_table_info?: PriceTableInfo[]   // info das tabelas selecionadas (vem do backend)
  active: boolean; created_at: string; expires_at: string | null
}

// usa o domínio em que o sistema está sendo acessado (ex.: www.sommafv.com.br)
const BASE = window.location.origin

export function Portals() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  // const isAdmin = user?.role === 'admin'

  const [createOpen, setCreateOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', price_table_ids: [] as string[], min_order_value: '', only_in_stock: false })

  const { data: portals = [], isLoading } = useQuery<Portal[]>({
    queryKey: ['portals'],
    queryFn: () => portalsApi.list().then(r => r.data),
  })

  const { data: priceTables = [] } = useQuery<PriceTable[]>({
    queryKey: ['price-tables'],
    queryFn: () => priceTablesApi.list().then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: () => portalsApi.create({
      name: form.name, price_table_ids: form.price_table_ids, factory_ids: [],
      min_order_value: parseFloat(form.min_order_value.replace(',', '.')) || 0,
      only_in_stock: form.only_in_stock,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portals'] })
      setCreateOpen(false)
      setForm({ name: '', price_table_ids: [], min_order_value: '', only_in_stock: false })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Erro ao criar link. Tente novamente.'
      alert(msg)
    },
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
    const subject = `Catálogo Online - SOMMA Força de Vendas`
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
            <h1 className="font-display text-lg font-bold text-on-surface">Catálogos</h1>
            <p className="text-[12px] text-outline mt-0.5">
              Catálogos de pedido para clientes — compartilhe por WhatsApp
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
                    {/* Tabelas de preço selecionadas (novo fluxo) */}
                    {portal.price_table_info && portal.price_table_info.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {portal.price_table_info.map(pt => (
                          <span key={pt.id} className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                            <Tags className="h-2.5 w-2.5 inline mr-0.5" />
                            {pt.factory_name} — {pt.name}
                          </span>
                        ))}
                      </div>
                    ) : portal.factory_ids?.length > 0 ? (
                      /* Legado: mostra fábricas */
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(portal.factory_names || portal.factory_ids).map((f, i) => (
                          <span key={i} className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                            <Tags className="h-2.5 w-2.5 inline mr-0.5" />{f}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-outline mt-0.5">Sem restrição de tabela</p>
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
                    onClick={() => window.confirm('Excluir este catálogo? O cliente não conseguirá mais acessar o link.') && deleteMut.mutate(portal.id)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 text-red-500 text-[12px] font-semibold hover:bg-red-50 transition-colors ml-auto"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Excluir
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
              disabled={!form.name.trim() || form.price_table_ids.length === 0}
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
              📋 Tabelas de Preço / Coleções *
              {form.price_table_ids.length === 0 && (
                <span className="ml-2 text-[11px] text-amber-600 font-normal">— selecione ao menos uma</span>
              )}
            </label>
            <p className="text-[12px] text-outline mb-2">
              Selecione quais tabelas o cliente poderá ver e comprar.
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar pr-1">
              {priceTables.map(pt => (
                <label key={pt.id} className={`flex items-center gap-3 cursor-pointer p-2.5 rounded-xl border transition-colors ${
                  form.price_table_ids.includes(pt.id)
                    ? 'border-primary bg-primary/5'
                    : 'border-outline-variant/40 hover:bg-surface-container-low'
                }`}>
                  <input
                    type="checkbox"
                    checked={form.price_table_ids.includes(pt.id)}
                    onChange={e => {
                      if (e.target.checked) {
                        setForm(prev => ({ ...prev, price_table_ids: [...prev.price_table_ids, pt.id] }))
                      } else {
                        setForm(prev => ({ ...prev, price_table_ids: prev.price_table_ids.filter(id => id !== pt.id) }))
                      }
                    }}
                    className="w-4 h-4 accent-primary rounded flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-bold text-on-surface truncate">{pt.name}</span>
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full flex-shrink-0">{pt.factory_name}</span>
                    </div>
                    {(pt.collection || pt.season) && (
                      <p className="text-[11px] text-outline">{[pt.collection, pt.season, pt.year].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  <Tags className="h-4 w-4 text-outline/40 flex-shrink-0" />
                </label>
              ))}
            </div>
          </div>

          {form.price_table_ids.length === 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[12px] text-red-700">
              ⚠️ Selecione pelo menos uma tabela de preço para o cliente acessar.
            </div>
          )}

          {/* Condições do pedido */}
          <div className="border-t border-outline-variant/30 pt-4 space-y-3">
            <p className="text-[13px] font-semibold text-on-surface">⚙️ Condições do pedido</p>

            <div>
              <label className="block text-[12px] font-medium text-on-surface-variant mb-1">Valor mínimo do pedido</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-outline">R$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00 (sem mínimo)"
                  value={form.min_order_value}
                  onChange={e => setForm(f => ({ ...f, min_order_value: e.target.value }))}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-outline-variant rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <p className="text-[11px] text-outline mt-1">O cliente não consegue fechar abaixo desse valor. Deixe vazio para sem mínimo.</p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer p-2.5 rounded-xl border border-outline-variant/40 hover:bg-surface-container-low transition-colors">
              <input
                type="checkbox"
                checked={form.only_in_stock}
                onChange={e => setForm(f => ({ ...f, only_in_stock: e.target.checked }))}
                className="w-4 h-4 accent-primary rounded flex-shrink-0 mt-0.5"
              />
              <div>
                <p className="text-[13px] font-semibold text-on-surface">Só referências com estoque</p>
                <p className="text-[11px] text-outline mt-0.5">Produtos sem estoque aparecem marcados como <strong>esgotado</strong> e não podem ser adicionados ao pedido.</p>
              </div>
            </label>
          </div>
        </div>
      </Modal>
    </div>
  )
}
