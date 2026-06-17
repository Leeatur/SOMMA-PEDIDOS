import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  PackageCheck, Plus, Upload, Link2, Copy, Trash2, CheckCircle,
  ToggleLeft, ToggleRight, ExternalLink, RefreshCw, AlertCircle, X,
} from 'lucide-react'
import { peApi, factoriesApi } from '../api/client'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { PageSpinner } from '../components/ui/Spinner'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Factory { id: string; name: string }
interface PeCatalog {
  id: string; name: string; active: boolean
  factory_id: string; factory_name: string
  portal_token: string | null
  item_count: number; last_import_at: string | null
  created_at: string
}
interface ImportResult {
  imported: number; refs_in_file: number; not_found: string[]; no_photo: string[]
}

// usa o domínio em que o sistema está sendo acessado (ex.: www.sommafv.com.br)
const BASE = window.location.origin
const fmtDate = (s: string | null): string => {
  if (!s) return '—'
  const str = String(s).trim()
  if (str.includes('T') || str.includes('Z')) {
    try { return new Date(str).toLocaleDateString('pt-BR') } catch { return str }
  }
  const [y, m, d] = str.substring(0, 10).split('-')
  if (!y || !m || !d) return str
  return `${d}/${m}/${y}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProntaEntrega() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', factory_id: '' })
  const [importingId, setImportingId] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState('')

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: catalogs = [], isLoading } = useQuery<PeCatalog[]>({
    queryKey: ['pe-catalogs'],
    queryFn: () => peApi.list().then(r => r.data),
  })
  const { data: factories = [] } = useQuery<Factory[]>({
    queryKey: ['factories'],
    queryFn: () => factoriesApi.list().then(r => r.data),
    enabled: createOpen,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: () => peApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pe-catalogs'] })
      setCreateOpen(false)
      setForm({ name: '', factory_id: '' })
    },
  })
  const toggleMut = useMutation({
    mutationFn: (id: string) => peApi.toggle(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pe-catalogs'] }),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => peApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pe-catalogs'] }),
  })

  // ── Helpers ───────────────────────────────────────────────────────────────
  function copyLink(cat: PeCatalog) {
    if (!cat.portal_token) return
    navigator.clipboard.writeText(`${BASE}/portal/${cat.portal_token}`)
    setCopiedId(cat.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function shareWhatsApp(cat: PeCatalog) {
    if (!cat.portal_token) return
    const url  = `${BASE}/portal/${cat.portal_token}`
    const msg  = `Olá! Acesse nosso catálogo de *Pronta Entrega* e faça seu pedido diretamente:\n\n${url}\n\nDigite seu CNPJ para entrar.`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  async function handleImport(cat: PeCatalog, file: File) {
    setImportingId(cat.id)
    setImportResult(null)
    setImportError('')
    try {
      const r = await peApi.import(cat.id, file)
      setImportResult(r.data as ImportResult)
      qc.invalidateQueries({ queryKey: ['pe-catalogs'] })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setImportError(msg || 'Erro ao importar o arquivo.')
    } finally {
      setImportingId(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) return <PageSpinner />

  // Agrupa por fábrica
  const factories_list = [...new Set(catalogs.map(c => c.factory_name))].sort()

  return (
    <div className="pb-24 lg:pb-8">
      {/* Header */}
      <div className="bg-white border-b border-outline-variant px-5 py-3 lg:px-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-bold text-on-surface flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-primary" />
              Pronta Entrega
            </h1>
            <p className="text-[12px] text-outline mt-0.5">
              Catálogos de PE com link de pedido para clientes
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} icon={<Plus className="h-4 w-4" />} size="sm">
            Novo Catálogo PE
          </Button>
        </div>
      </div>

      {/* Input de arquivo oculto */}
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          const catId = fileRef.current?.dataset.catId
          if (!file || !catId) return
          const cat = catalogs.find(c => c.id === catId)
          if (cat) handleImport(cat, file)
        }}
      />

      <div className="px-5 py-5 lg:px-8 space-y-8">

        {/* Resultado da importação */}
        {(importResult || importError) && (
          <div className={`rounded-xl p-4 flex items-start gap-3 ${importError ? 'bg-red-50 border border-red-200' : 'bg-emerald-50 border border-emerald-200'}`}>
            {importError
              ? <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
              : <CheckCircle className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
            }
            <div className="flex-1">
              {importError
                ? <p className="text-[13px] font-semibold text-red-700">{importError}</p>
                : <>
                    <p className="text-[13px] font-bold text-emerald-700">
                      ✅ {importResult!.imported} produto{importResult!.imported !== 1 ? 's' : ''} importado{importResult!.imported !== 1 ? 's' : ''}
                      <span className="font-normal text-emerald-600 ml-1">({importResult!.refs_in_file} refs no arquivo)</span>
                    </p>
                    {importResult!.not_found.length > 0 && (
                      <p className="text-[12px] text-amber-700 mt-1">
                        ⚠ {importResult!.not_found.length} refs não encontradas no sistema: {importResult!.not_found.join(', ')}
                      </p>
                    )}
                    {importResult!.no_photo?.length > 0 && (
                      <p className="text-[12px] text-amber-700 mt-1">
                        🚫 {importResult!.no_photo.length} ref{importResult!.no_photo.length !== 1 ? 's' : ''} sem foto cadastrada — eliminada{importResult!.no_photo.length !== 1 ? 's' : ''} automaticamente do catálogo: {importResult!.no_photo.join(', ')}
                      </p>
                    )}
                  </>
              }
            </div>
            <button onClick={() => { setImportResult(null); setImportError('') }} className="text-outline/50 hover:text-on-surface">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Estado vazio */}
        {catalogs.length === 0 && (
          <div className="text-center py-16">
            <PackageCheck className="h-12 w-12 text-outline/30 mx-auto mb-3" />
            <p className="font-semibold text-on-surface">Nenhum catálogo PE criado</p>
            <p className="text-[12px] text-outline mt-1 mb-4">Crie um catálogo e importe as referências via planilha</p>
            <Button onClick={() => setCreateOpen(true)} size="sm">Criar primeiro catálogo</Button>
          </div>
        )}

        {/* Cards agrupados por fábrica */}
        {factories_list.map(factoryName => {
          const group = catalogs.filter(c => c.factory_name === factoryName)
          return (
            <div key={factoryName}>
              <h2 className="text-[11px] font-bold text-outline uppercase tracking-widest mb-3">
                {factoryName}
              </h2>
              <div className="space-y-3">
                {group.map(cat => (
                  <div key={cat.id}
                    className={`bg-white rounded-2xl border shadow-sm p-4 transition-all ${cat.active ? 'border-outline-variant/40' : 'border-outline-variant/20 opacity-60'}`}>

                    {/* Cabeçalho */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-on-surface text-[14px]">{cat.name}</p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cat.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            {cat.active ? '● Ativo' : '○ Inativo'}
                          </span>
                        </div>
                        <p className="text-[11px] text-outline mt-0.5">
                          {cat.item_count} produto{cat.item_count !== 1 ? 's' : ''} · Última importação: {fmtDate(cat.last_import_at)}
                        </p>
                      </div>
                      {/* Toggle ativo */}
                      <button
                        onClick={() => toggleMut.mutate(cat.id)}
                        className={`flex-shrink-0 transition-colors ${cat.active ? 'text-emerald-500 hover:text-emerald-700' : 'text-outline/50 hover:text-on-surface'}`}
                        title={cat.active ? 'Desativar' : 'Ativar'}
                      >
                        {cat.active ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
                      </button>
                    </div>

                    {/* Link */}
                    {cat.portal_token && (
                      <div className="flex items-center gap-2 bg-surface-container-low rounded-xl px-3 py-2 mb-3">
                        <Link2 className="h-3.5 w-3.5 text-outline flex-shrink-0" />
                        <p className="text-[11px] text-outline font-mono truncate flex-1">
                          {BASE}/portal/{cat.portal_token.substring(0, 22)}...
                        </p>
                      </div>
                    )}

                    {/* Ações */}
                    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">

                      {/* Importar planilha */}
                      <button
                        disabled={importingId === cat.id}
                        onClick={() => {
                          if (!fileRef.current) return
                          fileRef.current.dataset.catId = cat.id
                          fileRef.current.click()
                        }}
                        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-primary text-primary text-[12px] font-semibold hover:bg-primary/5 transition-colors disabled:opacity-50"
                      >
                        {importingId === cat.id
                          ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          : <Upload className="h-3.5 w-3.5" />
                        }
                        {importingId === cat.id ? 'Importando...' : 'Importar Planilha'}
                      </button>

                      {/* Copiar link */}
                      <button
                        onClick={() => copyLink(cat)}
                        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container transition-colors"
                      >
                        {copiedId === cat.id ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedId === cat.id ? 'Copiado!' : 'Copiar Link'}
                      </button>

                      {/* WhatsApp */}
                      <button
                        onClick={() => shareWhatsApp(cat)}
                        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-[12px] font-semibold transition-colors"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                        WhatsApp
                      </button>

                      {/* Visualizar */}
                      {cat.portal_token && (
                        <a
                          href={`/portal/${cat.portal_token}`} target="_blank" rel="noopener noreferrer"
                          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Visualizar
                        </a>
                      )}

                      {/* Excluir */}
                      <button
                        onClick={() => window.confirm('Excluir este catálogo PE? Esta ação não pode ser desfeita.') && deleteMut.mutate(cat.id)}
                        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 text-red-500 text-[12px] font-semibold hover:bg-red-50 transition-colors ml-auto"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Excluir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal criar catálogo */}
      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setForm({ name: '', factory_id: '' }) }}
        title="Novo Catálogo Pronta Entrega"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => createMut.mutate()}
              loading={createMut.isPending}
              disabled={!form.name.trim() || !form.factory_id}
            >
              Criar Catálogo
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-[12px] font-semibold text-outline mb-1">Nome do catálogo *</label>
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ex: PE OUZZARE INV26"
            />
            <p className="text-[11px] text-outline/70 mt-1">O link do cliente usará este nome.</p>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-outline mb-1">Fábrica *</label>
            <select
              value={form.factory_id}
              onChange={e => setForm(f => ({ ...f, factory_id: e.target.value }))}
              className="w-full border border-outline-variant rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            >
              <option value="">Selecione a fábrica...</option>
              {factories.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-outline/70 mt-1">
              A importação busca referências nos produtos desta fábrica.
              Referências sem foto cadastrada são eliminadas automaticamente do catálogo.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
