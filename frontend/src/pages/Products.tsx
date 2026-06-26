import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Image as ImageIcon, ChevronDown, Archive, ToggleLeft, ToggleRight, Lock, Unlock, Pencil, Plus, Trash2, X, Check, Package } from 'lucide-react'
import { productsApi, priceTablesApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import { Modal } from '../components/ui/Modal'
import { ColumnDef, ColumnConfigButton, useColumnConfig } from '../components/ui/ColumnConfig'
import { useColumnResize } from '../components/ui/useColumnResize.tsx'
import { PhotosZipImportModal } from '../components/ui/PhotosZipImportModal'

const SIZE_ORDER = [
  'RN','PP','XP','P','M','G','GG','XG','EXG','XGG','2XG','3XG','4XG',
  '34','36','38','40','42','44','46','48','50','52','54','56','58','60',
  '1','2','4','6','8','10','12','14','16','18','U',
]

function sortSizes(sizes: string[]) {
  return [...sizes].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a.toUpperCase())
    const bi = SIZE_ORDER.indexOf(b.toUpperCase())
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

function expandSizeKey(key: string): string[] {
  const m = key.match(/^([A-Za-z0-9]+)-([A-Za-z0-9]+)$/)
  if (m) {
    const s = SIZE_ORDER.indexOf(m[1].toUpperCase())
    const e = SIZE_ORDER.indexOf(m[2].toUpperCase())
    if (s >= 0 && e >= s) return SIZE_ORDER.slice(s, e + 1)
  }
  return [key]
}

function expandGradeSizes(sizes: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [key, val] of Object.entries(sizes)) {
    for (const expanded of expandSizeKey(key)) result[expanded] = val
  }
  return result
}

function parseSizeRange(sr: string | null | undefined): string[] {
  if (!sr) return []
  // "36 ao 48" format
  const m1 = sr.match(/^(\d+)\s+ao\s+(\d+)$/i)
  if (m1) {
    const lo = parseInt(m1[1]), hi = parseInt(m1[2])
    return SIZE_ORDER.filter(s => { const n = parseInt(s); return !isNaN(n) && n >= lo && n <= hi })
  }
  // "36-48", "P-GG", "P-EXG" etc — qualquer X-Y via SIZE_ORDER
  const m2 = sr.match(/^([A-Za-z0-9]+)-([A-Za-z0-9]+)$/)
  if (m2) {
    const s = SIZE_ORDER.indexOf(m2[1].toUpperCase())
    const e = SIZE_ORDER.indexOf(m2[2].toUpperCase())
    if (s >= 0 && e >= s) return SIZE_ORDER.slice(s, e + 1)
  }
  return sr.split(/[\s,]+/).filter(Boolean)
}

interface GradeConfig {
  id: string
  color: string | null
  sizes: Record<string, number>
  total_pieces: number
  sort_order: number
}

interface Product {
  id: string
  reference: string
  type: 'regular' | 'pack'
  product_name: string | null
  model: string | null
  size_range: string | null
  base_price: number
  category: string | null
  observation: string | null
  image_url: string | null
  active: boolean
  blocked_sizes: string[]
  price_table_id: string
  price_table_name: string | null
  factory_name: string | null
  grade_configs: GradeConfig[] | null
}

// ─── Product Detail Modal ────────────────────────────────────────────────────

type EditGradeRow = { color: string; sizes: Record<string, number> }

function ProductDetailModal({
  p, isAdmin, onClose, onUpdated,
}: {
  p: Product
  isAdmin: boolean
  onClose: () => void
  onUpdated: (updated: Partial<Product>) => void
}) {
  const qc = useQueryClient()
  const totalPieces = p.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 0
  const pricePerBox = p.base_price * totalPieces

  // Busca tabelas disponíveis para troca
  const { data: allPriceTables = [] } = useQuery<{id:string;name:string;factory_name:string}[]>({
    queryKey: ['price-tables-all'],
    queryFn: () => priceTablesApi.list().then(r => r.data),
    enabled: isAdmin,
  })

  // ── Image upload state ───────────────────────────────────────────────────
  const [uploadingImage, setUploadingImage] = useState(false)
  const [currentImageUrl, setCurrentImageUrl] = useState(p.image_url)
  const [isDragging, setIsDragging] = useState(false)
  const [imageUploadError, setImageUploadError] = useState('')
  const [imageSyncMsg, setImageSyncMsg] = useState('')
  const [editSyncMsg, setEditSyncMsg] = useState('')
  const pasteZoneRef = useRef<HTMLDivElement>(null)

  // ── Galeria (várias fotos) ───────────────────────────────────────────────
  const { data: galleryImages = [], refetch: refetchGallery } = useQuery<{ id: string; url: string }[]>({
    queryKey: ['product-images', p.id],
    queryFn: () => productsApi.listImages(p.id).then(r => r.data),
    enabled: isAdmin,
  })
  const [addingGallery, setAddingGallery] = useState(false)
  async function handleAddGallery(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length || !isAdmin) return
    setAddingGallery(true)
    try {
      for (const f of files) { if (f.type.startsWith('image/')) await productsApi.addImage(p.id, f) }
      const { data } = await productsApi.listImages(p.id)
      await refetchGallery()
      // se o produto ainda não tinha capa, a 1ª virou capa no backend
      if (!currentImageUrl && data[0]?.url) { setCurrentImageUrl(data[0].url); onUpdated({ image_url: data[0].url }) }
      qc.invalidateQueries({ queryKey: ['all-products'] })
    } catch {
      setImageUploadError('Erro ao adicionar fotos à galeria.')
    } finally { setAddingGallery(false); e.target.value = '' }
  }
  async function handleDeleteGalleryImg(imageId: string) {
    await productsApi.deleteImage(p.id, imageId)
    const { data } = await productsApi.listImages(p.id)
    await refetchGallery()
    setCurrentImageUrl(data[0]?.url || '')
    qc.invalidateQueries({ queryKey: ['all-products'] })
  }
  async function handleSetCover(imageId: string, url: string) {
    await productsApi.setCoverImage(p.id, imageId)
    setCurrentImageUrl(url); onUpdated({ image_url: url })
    qc.invalidateQueries({ queryKey: ['all-products'] })
  }

  async function uploadImageFile(file: File) {
    if (!isAdmin) return
    setUploadingImage(true)
    setImageUploadError('')
    setImageSyncMsg('')
    try {
      const r = await productsApi.uploadImage(p.id, file)
      const newUrl = r.data.image_url || r.data.url || ''
      setCurrentImageUrl(newUrl)
      onUpdated({ image_url: newUrl })
      qc.invalidateQueries({ queryKey: ['all-products'] })
      const syncedCount = (r.data as { synced_count?: number }).synced_count || 0
      if (syncedCount > 0) {
        setImageSyncMsg(`Foto também aplicada automaticamente em mais ${syncedCount} tabela${syncedCount > 1 ? 's' : ''} com a referência ${p.reference}.`)
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setImageUploadError(msg || 'Erro ao enviar a imagem. Tente novamente.')
    }
    finally { setUploadingImage(false) }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !isAdmin) return
    await uploadImageFile(file)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f && f.type.startsWith('image/')) uploadImageFile(f)
  }

  function handlePasteEvent(e: React.ClipboardEvent | ClipboardEvent) {
    if (!isAdmin) return
    const cd = (e as React.ClipboardEvent).clipboardData ?? (e as ClipboardEvent).clipboardData
    if (!cd) return
    // Via items
    for (const item of Array.from(cd.items ?? [])) {
      if (item.type.startsWith('image/')) {
        const raw = item.getAsFile()
        if (raw) { uploadImageFile(new File([raw], `paste-${Date.now()}.jpg`, { type: raw.type })); return }
      }
    }
    // Via files
    const f = cd.files?.[0]
    if (f?.type.startsWith('image/')) uploadImageFile(new File([f], `paste-${Date.now()}.jpg`, { type: f.type }))
  }

  // Auto-foca a zona de paste quando o modal abre
  useEffect(() => { pasteZoneRef.current?.focus() }, [])

  // Também escuta no document como fallback
  useEffect(() => {
    const h = (e: ClipboardEvent) => handlePasteEvent(e)
    document.addEventListener('paste', h)
    return () => document.removeEventListener('paste', h)
  }, [isAdmin, p.id])

  // ── Edit mode state ──────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [editForm, setEditForm] = useState({
    reference: p.reference,
    product_name: p.product_name || '',
    model: p.model || '',
    size_range: p.size_range || '',
    base_price: p.base_price,
    category: p.category || '',
    observation: p.observation || '',
    type: p.type as 'regular' | 'pack',
    price_table_id: p.price_table_id || '',
  })
  const [editGrade, setEditGrade] = useState<EditGradeRow[]>(() => {
    if (!p.grade_configs || p.grade_configs.length === 0) {
      const sizes = parseSizeRange(p.size_range)
      const defaultSizes: Record<string, number> = {}
      sizes.forEach(s => { defaultSizes[s] = 1 })
      return [{ color: '', sizes: defaultSizes }]
    }
    return p.grade_configs.map(gc => ({
      color: gc.color || '',
      sizes: expandGradeSizes(gc.sizes),
    }))
  })

  // Tipo de variante: UN. | UN por cores | Grade | Grade por cores
  const isUnToken = (s: string) => /^un\.?$/i.test((s || '').trim())
  const [variantMode, setVariantMode] = useState<'un' | 'un_cor' | 'grade' | 'grade_cor'>(() => {
    const hasColor = (p.grade_configs || []).some(g => (g.color || '').trim() !== '')
    const realSizes = parseSizeRange(p.size_range).filter(s => !isUnToken(s))
    const hasSizes = realSizes.length > 0 || (p.grade_configs || []).some(g => Object.keys(g.sizes || {}).some(s => !isUnToken(s)))
    if (hasColor && hasSizes) return 'grade_cor'
    if (hasColor) return 'un_cor'
    if (hasSizes) return 'grade'
    return 'un'
  })
  const allowColors = variantMode === 'un_cor' || variantMode === 'grade_cor'
  const unSize = variantMode === 'un' || variantMode === 'un_cor'
  function applyMode(mode: 'un' | 'un_cor' | 'grade' | 'grade_cor') {
    setVariantMode(mode)
    const isUn = mode === 'un' || mode === 'un_cor'
    setEditForm(f => ({ ...f, size_range: isUn ? 'UN' : (isUnToken(f.size_range) ? '' : f.size_range) }))
    const colors = mode === 'un_cor' || mode === 'grade_cor'
    if (!colors) setEditGrade(prev => [{ color: '', sizes: prev[0]?.sizes || {} }])
    else setEditGrade(prev => (prev.length ? prev : [{ color: '', sizes: {} }]))
  }

  // Sizes used as grade columns — derived from o modo + size_range live
  const gradeSizes = useMemo(() => {
    if (variantMode === 'un' || variantMode === 'un_cor') return ['UN']
    const fromRange = parseSizeRange(editForm.size_range).filter(s => !isUnToken(s))
    if (fromRange.length > 0) return fromRange
    const allFromGrade = sortSizes(Array.from(new Set(editGrade.flatMap(r => Object.keys(r.sizes)))).filter(s => !isUnToken(s)))
    return allFromGrade
  }, [variantMode, editForm.size_range, editGrade])

  function setGradeCell(rowIdx: number, size: string, val: number) {
    setEditGrade(prev => prev.map((row, i) =>
      i === rowIdx ? { ...row, sizes: { ...row.sizes, [size]: val } } : row
    ))
  }
  function setGradeColor(rowIdx: number, color: string) {
    setEditGrade(prev => prev.map((row, i) => i === rowIdx ? { ...row, color } : row))
  }
  function addGradeRow() {
    const newSizes: Record<string, number> = {}
    gradeSizes.forEach(s => { newSizes[s] = 0 })
    setEditGrade(prev => [...prev, { color: '', sizes: newSizes }])
  }
  function removeGradeRow(idx: number) {
    setEditGrade(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    setEditSyncMsg('')
    try {
      const res = await productsApi.update(p.id, {
        reference: editForm.reference,
        product_name: editForm.product_name || null,
        model: editForm.model || null,
        size_range: editForm.size_range || null,
        base_price: Number(editForm.base_price),
        category: editForm.category || null,
        observation: editForm.observation || null,
        type: editForm.type,
        ...(editForm.price_table_id ? { price_table_id: editForm.price_table_id } : {}),
      })
      // 'un' = produto unidade simples, sem grade. Demais modos guardam a ESTRUTURA
      // (cores/tamanhos) mesmo com quantidade 0 — é o template de variantes do produto.
      const gradePayload = variantMode === 'un'
        ? []
        : editGrade
            .map((row, i) => ({
              color: allowColors ? (row.color || null) : null,
              // Garante as colunas do modo atual (qtd 0 quando não preenchida)
              sizes: Object.fromEntries(gradeSizes.map(s => [s, row.sizes[s] ?? 0])),
              sort_order: i,
            }))
            .filter(row => Object.keys(row.sizes).length > 0)
      const gradeRes = await productsApi.updateGrade(p.id, gradePayload)
      const gradeConfigs = (gradeRes.data?.rows ?? gradeRes.data) || []
      onUpdated({
        reference: res.data.reference,
        product_name: res.data.product_name,
        model: res.data.model,
        size_range: res.data.size_range,
        base_price: res.data.base_price,
        category: res.data.category,
        observation: res.data.observation,
        type: res.data.type,
        grade_configs: gradeConfigs,
      })
      qc.invalidateQueries({ queryKey: ['all-products'] })
      const productSynced = (res.data as { synced_count?: number }).synced_count || 0
      const gradeSynced = (gradeRes.data as { synced_count?: number })?.synced_count || 0
      const syncedCount = Math.max(productSynced, gradeSynced)
      if (syncedCount > 0) {
        setEditSyncMsg(`Alterações também aplicadas automaticamente em mais ${syncedCount} tabela${syncedCount > 1 ? 's' : ''} com a referência ${res.data.reference} (preço de cada tabela permanece independente).`)
      }
      setEditing(false)
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setSaveError(msg || 'Erro ao salvar. Verifique os dados e tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  // ── View-mode helpers ────────────────────────────────────────────────────

  // Tamanhos disponíveis para bloqueio
  const allSizes = (() => {
    if (p.type === 'pack') return []
    const fromRange = sortSizes(parseSizeRange(p.size_range))
    if (fromRange.length > 0) return fromRange
    if (p.grade_configs && p.grade_configs.length > 0) {
      return sortSizes(Array.from(new Set(
        p.grade_configs
          .flatMap(gc => gc.sizes ? Object.keys(gc.sizes) : [])
          .flatMap(expandSizeKey)
      )))
    }
    return []
  })()

  const [localBlocked, setLocalBlocked] = useState<string[]>(p.blocked_sizes || [])
  const [savingBlocked, setSavingBlocked] = useState(false)

  const availMut = useMutation({
    mutationFn: (active: boolean) => productsApi.setAvailability(p.id, active),
    onSuccess: (res) => {
      onUpdated({ active: res.data.active })
      qc.invalidateQueries({ queryKey: ['all-products'] })
    },
  })

  const [deleting, setDeleting] = useState(false)
  async function handleDelete() {
    if (!window.confirm(`Excluir a referência ${p.reference}? Esta ação não pode ser desfeita.`)) return
    setDeleting(true)
    try {
      const res = await productsApi.deleteProduct(p.id)
      qc.invalidateQueries({ queryKey: ['all-products'] })
      if (res.data.inactivated) {
        onUpdated({ active: false })
        alert(`${p.reference} tem pedidos vinculados — foi inativada em vez de excluída.`)
      } else {
        onClose()
      }
    } catch { alert('Erro ao excluir referência.') }
    finally { setDeleting(false) }
  }

  async function saveBlockedSizes() {
    setSavingBlocked(true)
    try {
      const res = await productsApi.setBlockedSizes(p.id, localBlocked)
      onUpdated({ blocked_sizes: res.data.blocked_sizes })
      qc.invalidateQueries({ queryKey: ['all-products'] })
    } finally {
      setSavingBlocked(false)
    }
  }

  function toggleSize(size: string) {
    setLocalBlocked(prev =>
      prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]
    )
  }

  const blockedChanged = JSON.stringify(sortSizes(localBlocked)) !== JSON.stringify(sortSizes(p.blocked_sizes || []))

  // ── Edit form ────────────────────────────────────────────────────────────
  if (editing) {
    const inputCls = "w-full border border-outline-variant rounded-lg px-3 py-1 text-[12px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary bg-white"
    return (
      <Modal open onClose={() => setEditing(false)} title={`Editar: ${p.reference}`} size="lg"
        footer={
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !editForm.reference}
              className="flex-1 bg-primary text-white rounded-xl py-2 text-[12px] font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors">
              {saving ? 'Salvando…' : 'Salvar alterações'}
            </button>
            <button onClick={() => setEditing(false)}
              className="px-4 py-2 border border-outline-variant rounded-xl text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container transition-colors flex items-center gap-1.5">
              <X className="h-4 w-4" /> Cancelar
            </button>
          </div>
        }
      >
        <div className="space-y-1">
          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-1 text-[12px] text-red-700">{saveError}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-outline mb-1">Referência *</label>
              <input className={inputCls} value={editForm.reference} onChange={e => setEditForm(f => ({ ...f, reference: e.target.value }))} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-outline mb-1">Tipo</label>
              <select className={inputCls} value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value as 'regular' | 'pack' }))}>
                <option value="regular">Regular</option>
                <option value="pack">Pack</option>
              </select>
            </div>
          </div>

          {/* Tabela de Preços — permite trocar */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <label className="block text-[12px] font-bold text-amber-800 mb-1.5 uppercase tracking-wide">
              📋 Tabela de Preços
              {editForm.price_table_id && editForm.price_table_id !== p.price_table_id && (
                <span className="ml-2 normal-case text-amber-700">⚠️ alterada — salve para confirmar</span>
              )}
            </label>
            <select
              className="w-full border border-amber-300 bg-white rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-400"
              value={editForm.price_table_id}
              onChange={e => setEditForm(f => ({ ...f, price_table_id: e.target.value }))}
            >
              {allPriceTables.length === 0 && (
                <option value="">Carregando tabelas...</option>
              )}
              {allPriceTables.map(pt => (
                <option key={pt.id} value={pt.id}>{pt.factory_name} — {pt.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-amber-600 mt-1">Atual: {p.price_table_name || '—'}</p>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-outline mb-1">Nome do produto</label>
            <input className={inputCls} value={editForm.product_name} onChange={e => setEditForm(f => ({ ...f, product_name: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-outline mb-1">Modelo</label>
              <input className={inputCls} value={editForm.model} onChange={e => setEditForm(f => ({ ...f, model: e.target.value }))} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-outline mb-1">Categoria</label>
              <input className={inputCls} value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-outline mb-1">Preço por peça (R$) *</label>
              <input type="number" step="0.01" min="0" className={inputCls} value={editForm.base_price}
                onChange={e => setEditForm(f => ({ ...f, base_price: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-outline mb-1">Tipo de variante</label>
              <select className={inputCls} value={variantMode} onChange={e => applyMode(e.target.value as 'un' | 'un_cor' | 'grade' | 'grade_cor')}>
                <option value="un">UN. (unidade)</option>
                <option value="un_cor">UN. por cores/modelos</option>
                <option value="grade">Grade (tamanhos)</option>
                <option value="grade_cor">Grade por cores</option>
              </select>
            </div>
            {!unSize && (
            <div>
              <label className="block text-[12px] font-semibold text-outline mb-1">Faixa de tamanhos</label>
              <input className={inputCls} placeholder="ex: P-GG ou 36-48" value={editForm.size_range}
                onChange={e => setEditForm(f => ({ ...f, size_range: e.target.value }))} />
            </div>
            )}
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-outline mb-1">Observação</label>
            <textarea className={`${inputCls} resize-none h-16`} value={editForm.observation}
              onChange={e => setEditForm(f => ({ ...f, observation: e.target.value }))} />
          </div>

          {/* Grade editor — oculto no modo UN. (unidade simples) */}
          {variantMode !== 'un' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[12px] font-semibold text-outline uppercase tracking-wide">{allowColors ? (unSize ? 'Cores / modelos' : 'Grade por cor') : 'Grade'}</p>
              {allowColors && (
                <button type="button" onClick={addGradeRow}
                  className="flex items-center gap-1 text-[12px] text-primary border border-primary/30 rounded-lg px-2 py-1 hover:bg-primary/5">
                  <Plus className="h-3 w-3" /> Adicionar cor
                </button>
              )}
            </div>
            {gradeSizes.length === 0 ? (
              <p className="text-[12px] text-outline/70 italic">Preencha a faixa de tamanhos para editar a grade.</p>
            ) : (
              <div className="space-y-1">
                {editGrade.map((row, rowIdx) => (
                  <div key={rowIdx} className="bg-surface-container-low rounded-xl p-2.5">
                    {allowColors && (
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        placeholder="Cor / modelo"
                        className="border border-outline-variant rounded-lg px-2 py-1 text-[12px] text-on-surface focus:outline-none focus:ring-1 focus:ring-primary bg-white flex-1"
                        value={row.color}
                        onChange={e => setGradeColor(rowIdx, e.target.value)}
                      />
                      {editGrade.length > 1 && (
                        <button type="button" onClick={() => removeGradeRow(rowIdx)}
                          className="text-red-500 hover:text-red-700 p-1 rounded">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    )}
                    <div className="overflow-x-auto scrollbar-hide">
                      <table className="min-w-max text-[12px] border border-outline-variant rounded-lg overflow-hidden">
                        <thead className="bg-white sticky top-0 z-10">
                          <tr>
                            {gradeSizes.map(s => (
                              <th key={s} className="px-2 py-1 text-on-surface-variant font-medium text-center min-w-[40px]">{s}</th>
                            ))}
                            <th className="px-2 py-1 text-outline text-center border-l border-outline-variant">Tot</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="bg-white">
                            {gradeSizes.map(s => (
                              <td key={s} className="px-1 py-1 text-center">
                                <input
                                  type="number" min="0"
                                  className="w-10 text-center text-[12px] border border-outline-variant/60 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
                                  value={row.sizes[s] ?? 0}
                                  onChange={e => setGradeCell(rowIdx, s, parseInt(e.target.value) || 0)}
                                />
                              </td>
                            ))}
                            <td className="px-2 py-1 text-center font-bold border-l border-outline-variant text-on-surface">
                              {Object.values(row.sizes).reduce((a, b) => a + b, 0)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}
        </div>
      </Modal>
    )
  }

  // ── View mode ────────────────────────────────────────────────────────────
  return (
    <Modal open onClose={onClose} title={p.reference} size="md">
      <div className="space-y-1">
        {isAdmin && (
          <div className="flex justify-end">
            <button onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-primary border border-primary/30 bg-primary/5 hover:bg-primary/10 rounded-lg px-3 py-1.5 transition-colors">
              <Pencil className="h-3.5 w-3.5" /> Editar referência
            </button>
          </div>
        )}

        {/* Zona de foto: clique, cole (Ctrl+V) ou arraste o arquivo */}
        <div
          ref={pasteZoneRef}
          tabIndex={0}
          onPaste={handlePasteEvent}
          onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`relative group outline-none rounded-xl transition-all ${isDragging ? 'ring-2 ring-primary ring-offset-1' : 'focus:ring-2 focus:ring-primary/30'}`}
        >
          {currentImageUrl ? (
            <div className="w-full aspect-square max-h-64 overflow-hidden rounded-xl bg-surface-container">
              <img src={currentImageUrl} alt={p.reference} className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className={`w-full h-40 rounded-xl flex items-center justify-center text-outline/50 transition-colors ${isDragging ? 'bg-primary/10 text-primary' : 'bg-surface-container'}`}>
              <ImageIcon className="h-12 w-12" />
            </div>
          )}
          {isAdmin && (
            <label className={`absolute inset-0 flex flex-col items-center justify-center rounded-xl cursor-pointer transition-all
              ${isDragging
                ? 'bg-primary/20 text-primary'
                : currentImageUrl
                  ? 'bg-black/0 group-hover:bg-black/40 text-transparent group-hover:text-white'
                  : 'bg-primary/10 hover:bg-primary/20 text-primary'}`}>
              {uploadingImage ? (
                <svg className="h-6 w-6 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              ) : isDragging ? (
                <>
                  <ImageIcon className="h-7 w-7 mb-1" />
                  <span className="text-[12px] font-bold">Solte para enviar</span>
                </>
              ) : (
                <>
                  <ImageIcon className="h-6 w-6 mb-1" />
                  <span className="text-[12px] font-semibold text-center leading-tight">
                    {currentImageUrl ? 'Substituir foto' : 'Adicionar foto'}
                  </span>
                  <span className="text-[10px] opacity-80 mt-0.5">
                    clique · cole (Ctrl+V) · arraste
                  </span>
                </>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploadingImage} />
            </label>
          )}
        </div>
        {imageUploadError && (
          <p className="text-[11px] text-red-600 font-medium mt-1">{imageUploadError}</p>
        )}
        {imageSyncMsg && (
          <p className="text-[11px] text-emerald-600 font-medium mt-1 flex items-center gap-1">
            <Check className="h-3 w-3" /> {imageSyncMsg}
          </p>
        )}
        {editSyncMsg && (
          <p className="text-[11px] text-emerald-600 font-medium mt-1 flex items-center gap-1">
            <Check className="h-3 w-3" /> {editSyncMsg}
          </p>
        )}

        {/* Galeria — fotos adicionais (a foto-capa acima também entra) */}
        {isAdmin && (
          <div className="mt-1">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[12px] font-semibold text-on-surface-variant">Galeria de fotos ({galleryImages.length})</p>
              <label className="text-[12px] text-primary font-semibold cursor-pointer hover:underline">
                {addingGallery ? 'Enviando…' : '+ Adicionar fotos'}
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleAddGallery} disabled={addingGallery} />
              </label>
            </div>
            {galleryImages.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {galleryImages.map(img => (
                  <div key={img.id} className="relative group aspect-square rounded-lg overflow-hidden bg-surface-container border border-outline-variant/40">
                    <img src={img.url} alt="" className="w-full h-full object-cover" />
                    {currentImageUrl === img.url && <span className="absolute top-0.5 left-0.5 bg-primary text-white text-[9px] font-bold px-1 rounded">CAPA</span>}
                    <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/0 group-hover:bg-black/45 opacity-0 group-hover:opacity-100 transition">
                      {currentImageUrl !== img.url && (
                        <button type="button" onClick={() => handleSetCover(img.id, img.url)} title="Tornar capa" className="px-1.5 py-0.5 bg-white/90 rounded text-[10px] font-bold text-on-surface">capa</button>
                      )}
                      <button type="button" onClick={() => handleDeleteGalleryImg(img.id)} title="Remover" className="px-1.5 py-0.5 bg-white/90 rounded text-[10px] font-bold text-red-600">remover</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-outline">Sem fotos extras. Use "+ Adicionar fotos" pra montar a galeria (várias de uma vez).</p>
            )}
          </div>
        )}

        <div className="flex items-start gap-2 flex-wrap">
          <Badge variant={p.type === 'pack' ? 'purple' : 'info'}>
            {p.type === 'pack' ? 'PACK' : 'Regular'}
          </Badge>
          {!p.active && <Badge variant="danger">Indisponível</Badge>}
          {p.product_name && <span className="text-[12px] font-semibold text-on-surface">{p.product_name}</span>}
          {p.model && <span className="text-[12px] text-outline">{p.model}</span>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-primary/10 rounded-xl p-3 text-center">
            <p className="text-[12px] text-primary/80 mb-0.5">Preço por peça</p>
            <p className="text-[12px] font-bold text-primary">R$ {Number(p.base_price).toFixed(2)}</p>
          </div>
          {p.type === 'pack' && totalPieces > 0 && (
            <div className="bg-surface-container-low rounded-xl p-3 text-center">
              <p className="text-[12px] text-outline mb-0.5">Preço por caixa ({totalPieces} pç)</p>
              <p className="text-[12px] font-bold text-on-surface">R$ {pricePerBox.toFixed(2)}</p>
            </div>
          )}
        </div>

        <div className="space-y-1.5 text-[12px]">
          {(editing ? editForm.size_range : p.size_range) && (
            <div className="flex justify-between">
              <span className="text-outline">Tamanhos</span>
              <span className={`font-medium ${editing ? 'text-primary' : 'text-on-surface'}`}>
                {editing ? editForm.size_range : p.size_range}
              </span>
            </div>
          )}
          {p.category && (
            <div className="flex justify-between">
              <span className="text-outline">Categoria</span>
              <span className="font-medium text-on-surface">{p.category}</span>
            </div>
          )}
          {p.factory_name && (
            <div className="flex justify-between">
              <span className="text-outline">Fábrica</span>
              <span className="font-medium text-on-surface">{p.factory_name}</span>
            </div>
          )}
          {p.price_table_name && (
            <div className="flex justify-between">
              <span className="text-outline">Tabela</span>
              <span className="font-medium text-on-surface text-right max-w-[60%] truncate">{p.price_table_name}</span>
            </div>
          )}
          {p.observation && isNaN(Number(p.observation)) && (
            <div className="flex justify-between">
              <span className="text-outline">Observação</span>
              <span className="font-medium text-orange-600 text-right max-w-[60%]">{p.observation}</span>
            </div>
          )}
        </div>

        {p.grade_configs && p.grade_configs.length > 0 && (
          <div className="bg-surface-container-low rounded-xl px-4 py-1.5">
            <p className="text-[12px] text-outline mb-2 font-medium uppercase tracking-wide">
              {p.type === 'regular' ? 'Tamanhos disponíveis' : 'Grade por caixa'}
            </p>
            {p.type === 'regular' ? (
              <div className="flex flex-wrap gap-1.5">
                {sortSizes(Array.from(new Set(p.grade_configs.flatMap(gc => Object.keys(gc.sizes)).flatMap(expandSizeKey)))).map(s => (
                  <span key={s} className="px-2.5 py-1 text-[12px] font-semibold bg-white text-primary rounded-lg border border-primary/30 shadow-sm">
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {p.grade_configs.map((gc, i) => {
                  const expandedSizes = expandGradeSizes(gc.sizes)
                  const sizes = sortSizes(Object.keys(expandedSizes))
                  return (
                    <div key={i}>
                      {gc.color && <p className="text-[12px] font-medium text-on-surface-variant mb-1">{gc.color}</p>}
                      <div className="overflow-x-auto scrollbar-hide">
                        <table className="min-w-max text-[12px] border border-outline-variant rounded-lg overflow-hidden">
                          <thead className="bg-white sticky top-0 z-10">
                            <tr>
                              {sizes.map(s => (
                                <th key={s} className="px-2 py-1 text-on-surface-variant font-medium text-center min-w-[28px]">{s}</th>
                              ))}
                              <th className="px-2 py-1 text-outline text-center border-l border-outline-variant">Tot</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="bg-surface-container-low">
                              {sizes.map(s => (
                                <td key={s} className="px-2 py-1.5 text-center font-mono">{expandedSizes[s]}</td>
                              ))}
                              <td className="px-2 py-1.5 text-center font-bold border-l border-outline-variant">{gc.total_pieces}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Controles admin ── */}
        {isAdmin && (
          <div className="border-t border-outline-variant pt-4 space-y-1">

            {/* Disponibilidade */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] font-semibold text-on-surface">Disponibilidade</p>
                <p className="text-[12px] text-outline">
                  {p.active ? 'Referência disponível para venda' : 'Referência bloqueada — não aparece para representantes'}
                </p>
              </div>
              <button
                onClick={() => availMut.mutate(!p.active)}
                disabled={availMut.isPending}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all ${
                  p.active
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                }`}
              >
                {p.active
                  ? <><ToggleRight className="h-4 w-4" /> Disponível</>
                  : <><ToggleLeft className="h-4 w-4" /> Indisponível</>}
              </button>
            </div>

            {/* Excluir referência */}
            <div className="flex items-center justify-between pt-2 border-t border-red-100 mt-2">
              <div>
                <p className="text-[12px] font-semibold text-red-700">Excluir referência</p>
                <p className="text-[12px] text-outline">Remove permanentemente do sistema</p>
              </div>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 text-[12px] font-medium transition-all disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? 'Excluindo…' : 'Excluir'}
              </button>
            </div>

            {/* Bloqueio de tamanhos (apenas regular com tamanhos conhecidos) */}
            {p.type === 'regular' && allSizes.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-[12px] font-semibold text-on-surface">Tamanhos bloqueados</p>
                    <p className="text-[12px] text-outline">Clique para bloquear/desbloquear cada tamanho</p>
                  </div>
                  {blockedChanged && (
                    <button
                      onClick={saveBlockedSizes}
                      disabled={savingBlocked}
                      className="text-[12px] px-3 py-1 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-60"
                    >
                      {savingBlocked ? 'Salvando…' : 'Salvar'}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {allSizes.map(size => {
                    const blocked = localBlocked.includes(size)
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => toggleSize(size)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[12px] font-semibold transition-all ${
                          blocked
                            ? 'border-red-400 bg-red-50 text-red-600 line-through'
                            : 'border-primary/30 bg-white text-primary hover:border-primary'
                        }`}
                      >
                        {blocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                        {size}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Column definitions ───────────────────────────────────────────────────────

const PRODUCT_COL_DEFS: ColumnDef[] = [
  { id: 'image',       label: 'Foto' },
  { id: 'reference',   label: 'Referência', alwaysVisible: true },
  { id: 'name',        label: 'Nome / Modelo' },
  { id: 'size_range',  label: 'Tamanhos' },
  { id: 'price',       label: 'Preço' },
  { id: 'pieces',      label: 'Pç/cx' },
  { id: 'category',    label: 'Categoria',  defaultVisible: false },
  { id: 'factory',     label: 'Fábrica' },
  { id: 'table',       label: 'Tabela' },
  { id: 'observation', label: 'Observação' },
]

const PRODUCT_COL_WIDTHS: Record<string, number> = {
  image: 56, reference: 110, name: 280, size_range: 200, price: 110,
  pieces: 70, category: 130, factory: 120, table: 200, observation: 160,
}

function ProductRow({
  p,
  visibleCols,
  onOpenDetail,
  onDuplicate,
}: {
  p: Product
  visibleCols: Array<ColumnDef & { visible: boolean }>
  onOpenDetail: (p: Product) => void
  onDuplicate?: (p: Product) => void
}) {
  const totalPieces = p.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 0
  const blockedCount = (p.blocked_sizes || []).length

  const renderCell = (id: string) => {
    switch (id) {
      case 'image':
        return (
          <td key={id} className="pl-3 pr-2 py-1 w-14">
            <div className="w-10 h-10 rounded-lg bg-surface-container overflow-hidden flex-shrink-0 flex items-center justify-center">
              {p.image_url
                ? <img src={p.image_url} alt={p.reference} className="w-full h-full object-cover" />
                : <ImageIcon className="h-4 w-4 text-outline/50" />}
            </div>
          </td>
        )
      case 'reference':
        return (
          <td key={id} className="px-2 py-1">
            <div className="flex items-center gap-1.5">
              <span className={`font-bold text-[12px] whitespace-nowrap ${p.active ? 'text-primary' : 'text-outline line-through'}`}>
                {p.reference}
              </span>
              <Badge variant={p.type === 'pack' ? 'purple' : 'info'} className="text-[12px] px-1.5 py-0">
                {p.type === 'pack' ? 'PK' : 'REG'}
              </Badge>
              {!p.active && (
                <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-red-600 text-white tracking-wide">INATIVA</span>
              )}
              {blockedCount > 0 && p.active && (
                <span className="text-[12px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-medium">
                  {blockedCount} tam. bloq.
                </span>
              )}
            </div>
          </td>
        )
      case 'name':
        return (
          <td key={id} className="px-2 py-1 overflow-hidden">
            <p className="text-[12px] font-medium text-on-surface truncate" title={p.product_name || ''}>{p.product_name || '—'}</p>
            {p.model && <p className="text-[12px] text-outline/70 truncate" title={p.model}>{p.model}</p>}
          </td>
        )
      case 'size_range':
        return (
          <td key={id} className="px-2 py-1 overflow-hidden">
            <p className="text-[12px] text-on-surface-variant truncate" title={p.size_range || ''}>{p.size_range || '—'}</p>
          </td>
        )
      case 'price':
        return (
          <td key={id} className="px-2 py-1 whitespace-nowrap text-right">
            <span className="text-[12px] font-bold text-primary">R$ {Number(p.base_price).toFixed(2)}</span>
            <span className="text-[12px] text-outline/70 ml-0.5">/pç</span>
          </td>
        )
      case 'pieces':
        return (
          <td key={id} className="px-2 py-1 whitespace-nowrap text-center">
            <span className="text-[12px] text-outline">{totalPieces > 0 ? `${totalPieces} pç` : '—'}</span>
          </td>
        )
      case 'category':
        return (
          <td key={id} className="px-2 py-1 max-w-[120px]">
            <span className="text-[12px] text-outline truncate block">{p.category || '—'}</span>
          </td>
        )
      case 'factory':
        return (
          <td key={id} className="px-2 py-1 max-w-[120px]">
            <span className="text-[12px] text-on-surface-variant truncate block">{p.factory_name || '—'}</span>
          </td>
        )
      case 'table':
        return (
          <td key={id} className="px-2 py-1 max-w-[150px]">
            <span className="text-[12px] text-outline truncate block">{p.price_table_name || '—'}</span>
          </td>
        )
      case 'observation':
        return (
          <td key={id} className="px-2 pr-3 py-1 overflow-hidden">
            <span className="text-[12px] text-orange-500 truncate block" title={p.observation || ''}>{p.observation || '—'}</span>
          </td>
        )
      default:
        return <td key={id} className="px-2 py-1" />
    }
  }

  return (
    <tr
      className={`border-b border-outline-variant/50 cursor-pointer transition-colors ${
        p.active ? 'hover:bg-primary/5' : 'bg-surface-container/40 hover:bg-surface-container'
      }`}
      onClick={() => onOpenDetail(p)}
    >
      {visibleCols.map(col => renderCell(col.id))}
      {onDuplicate && (
        <td className="px-2 py-1 w-8" onClick={e => { e.stopPropagation(); onDuplicate(p) }}>
          <button className="p-1 rounded-lg text-outline hover:text-primary hover:bg-primary/10 transition-colors" title="Duplicar produto">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </td>
      )}
    </tr>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────
// ─── Modal Criar / Duplicar Produto ─────────────────────────────────────────

function CreateProductModal({ source, onClose, onSaved }: {
  source: Product | null
  onClose: () => void
  onSaved: () => void
}) {
  const isDuplicate = !!source

  // Busca tabelas de preço para seleção
  const { data: priceTables = [] } = useQuery<{id:string;name:string;factory_name:string}[]>({
    queryKey: ['price-tables-select'],
    queryFn: () => import('../api/client').then(m => m.priceTablesApi.list().then(r => r.data)),
  })

  const [form, setForm] = useState({
    price_table_id: source?.grade_configs ? '' : '',
    reference: isDuplicate ? `${source!.reference}-COPIA` : '',
    product_name: source?.product_name || '',
    model: source?.model || '',
    size_range: source?.size_range || '',
    base_price: source?.base_price ? String(source.base_price) : '',
    category: source?.category || '',
    observation: source?.observation || '',
    type: (source?.type || 'regular') as 'regular' | 'pack',
  })

  const [grade, setGrade] = useState<{color: string; sizes: Record<string,number>}[]>(() => {
    if (source?.grade_configs && source.grade_configs.length > 0) {
      return source.grade_configs.map(gc => ({
        color: gc.color || '',
        sizes: expandGradeSizes(gc.sizes),
      }))
    }
    return [{ color: '', sizes: {} }]
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const gradeSizes = useMemo(() => {
    const fromRange = parseSizeRange(form.size_range)
    if (fromRange.length > 0) return fromRange
    return sortSizes(Array.from(new Set(grade.flatMap(r => Object.keys(r.sizes)))))
  }, [form.size_range, grade])

  function setCell(rowIdx: number, size: string, val: number) {
    setGrade(prev => prev.map((r, i) => i === rowIdx ? { ...r, sizes: { ...r.sizes, [size]: val } } : r))
  }

  async function handleSave() {
    if (!form.reference || !form.base_price) { setError('Preencha referência e preço'); return }
    setSaving(true); setError('')
    try {
      const { productsApi } = await import('../api/client')
      const gradeConfigs = grade.filter(r => Object.values(r.sizes).some(v => v > 0))

      if (isDuplicate) {
        // Duplicar: cria novo produto com TODOS os valores editados (não só a referência)
        await productsApi.create({
          price_table_id: source!.price_table_id,
          reference: form.reference,
          product_name: form.product_name || null,
          model: form.model || null,
          size_range: form.size_range || null,
          base_price: parseFloat(form.base_price),
          category: form.category || null,
          observation: form.observation || null,
          type: form.type,
          grade_configs: gradeConfigs.length > 0 ? gradeConfigs : undefined,
        })
      } else {
        if (!form.price_table_id) { setError('Selecione uma tabela de preços'); setSaving(false); return }
        await productsApi.create({
          price_table_id: form.price_table_id,
          reference: form.reference,
          product_name: form.product_name || null,
          model: form.model || null,
          size_range: form.size_range || null,
          base_price: parseFloat(form.base_price),
          category: form.category || null,
          observation: form.observation || null,
          type: form.type,
          grade_configs: gradeConfigs.length > 0 ? gradeConfigs : undefined,
        })
      }
      onSaved()
    } catch (e: unknown) {
      const msg = (e as {response?:{data?:{error?:string}}})?.response?.data?.error || 'Erro ao salvar'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const inputCls = "w-full border border-outline-variant rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/30"
  const labelCls = "block text-[11px] font-semibold text-outline uppercase tracking-wide mb-1"

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/30">
          <div>
            <h3 className="font-bold text-on-surface text-base">
              {isDuplicate ? `Duplicar: ${source!.reference}` : 'Novo Produto'}
            </h3>
            {isDuplicate && <p className="text-[11px] text-outline mt-0.5">Todos os dados foram copiados — edite o que precisar</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-outline hover:bg-surface-container"><X className="h-5 w-5" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Tabela (só no cadastro novo) */}
          {!isDuplicate && (
            <div>
              <label className={labelCls}>Tabela de Preços *</label>
              <select value={form.price_table_id} onChange={F('price_table_id')} className={inputCls}>
                <option value="">Selecione...</option>
                {priceTables.map(pt => (
                  <option key={pt.id} value={pt.id}>{pt.factory_name} — {pt.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Referência + Tipo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Referência *</label>
              <input value={form.reference} onChange={F('reference')} placeholder="Ex: TE11458" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Tipo</label>
              <select value={form.type} onChange={F('type')} className={inputCls}>
                <option value="regular">Regular</option>
                <option value="pack">Pack</option>
              </select>
            </div>
          </div>

          {/* Nome + Modelo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Nome do Produto</label>
              <input value={form.product_name} onChange={F('product_name')} placeholder="Ex: Camiseta Básica" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Modelo / Coleção</label>
              <input value={form.model} onChange={F('model')} placeholder="Ex: VE27" className={inputCls} />
            </div>
          </div>

          {/* Preço + Grade */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Preço Unitário (R$) *</label>
              <input type="number" step="0.01" value={form.base_price} onChange={F('base_price')} placeholder="0.00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Grade (ex: P-GG ou 36-48)</label>
              <input value={form.size_range} onChange={F('size_range')} placeholder="P-GG" className={inputCls} />
            </div>
          </div>

          {/* Categoria + Observação */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Categoria</label>
              <input value={form.category} onChange={F('category')} placeholder="Ex: Camisetas" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Observação</label>
              <input value={form.observation} onChange={F('observation')} placeholder="Opcional" className={inputCls} />
            </div>
          </div>

          {/* Grade de tamanhos */}
          {gradeSizes.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={labelCls}>Grade de Tamanhos</label>
                {form.type === 'pack' && (
                  <button onClick={() => setGrade(g => [...g, { color: '', sizes: Object.fromEntries(gradeSizes.map(s => [s, 1])) }])}
                    className="text-[11px] text-primary font-semibold flex items-center gap-1">
                    <Plus className="h-3 w-3" /> Cor
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="text-[11px] w-full">
                  <thead className="bg-surface-container-lowest sticky top-0 z-10">
                    <tr>
                      {form.type === 'pack' && <th className="text-left px-1 pb-1 text-outline">Cor</th>}
                      {gradeSizes.map(s => <th key={s} className="px-1 pb-1 text-center text-outline">{s}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {grade.map((row, ri) => (
                      <tr key={ri}>
                        {form.type === 'pack' && (
                          <td className="pr-2">
                            <input value={row.color} onChange={e => setGrade(g => g.map((r,i) => i===ri ? {...r,color:e.target.value} : r))}
                              placeholder="PRETO" className="border border-outline-variant rounded-lg px-2 py-1 text-[11px] w-20" />
                          </td>
                        )}
                        {gradeSizes.map(s => (
                          <td key={s} className="px-0.5">
                            <input type="number" min="0" value={row.sizes[s] || 0}
                              onChange={e => setCell(ri, s, parseInt(e.target.value)||0)}
                              className="border border-outline-variant rounded-lg text-center w-10 py-1 text-[11px] focus:ring-1 focus:ring-primary" />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && <p className="text-[12px] text-red-500 font-medium">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-outline-variant/30">
          <button onClick={onClose} className="px-4 py-2 text-[12px] text-outline hover:text-on-surface">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="px-6 py-2 bg-primary text-white rounded-xl text-[12px] font-semibold disabled:opacity-50 hover:bg-primary/90 active:scale-95 flex items-center gap-2">
            {saving && <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
            {saving ? 'Salvando...' : isDuplicate ? 'Salvar Duplicata' : 'Cadastrar Produto'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Products() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [search, setSearch] = useState('')
  const { widths, save: saveWidths } = useColumnResize('products', PRODUCT_COL_WIDTHS)
  const [typeFilter, setTypeFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState<'active' | 'all' | 'inactive'>('active')
  const [fotoFilter, setFotoFilter] = useState<'' | 'com' | 'sem'>('')
  const [tableFilter, setTableFilter] = useState('')
  const { data: filterTables = [] } = useQuery<{ id: string; name: string; factory_name: string }[]>({
    queryKey: ['price-tables-filter'],
    queryFn: () => priceTablesApi.list().then(r => r.data),
  })
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [showZipImport, setShowZipImport] = useState(false)
  const stockFileRef = useRef<HTMLInputElement>(null)
  const [stockBusy, setStockBusy] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [duplicateSource, setDuplicateSource] = useState<Product | null>(null)

  const handleSearch = (val: string) => {
    setSearch(val)
    clearTimeout((window as unknown as { _searchTimer?: number })._searchTimer)
    ;(window as unknown as { _searchTimer?: number })._searchTimer = window.setTimeout(() => {
      setDebouncedSearch(val)
    }, 350)
  }

  const { data: rawProducts, isLoading } = useQuery<Product[]>({
    queryKey: ['all-products', debouncedSearch, typeFilter, activeFilter, fotoFilter, tableFilter],
    queryFn: () =>
      productsApi.list({
        search: debouncedSearch || undefined,
        type: typeFilter || undefined,
        price_table_id: tableFilter || undefined,
        include_inactive: isAdmin && activeFilter !== 'active' ? true : undefined,
        sem_foto: fotoFilter === 'sem' ? true : undefined,
        com_foto: fotoFilter === 'com' ? true : undefined,
      }).then(r => r.data),
  })

  // Filtra somente inativas se selecionado
  const products = activeFilter === 'inactive'
    ? (rawProducts || []).filter(p => !p.active)
    : rawProducts

  const [sortCol, setSortCol] = useState<string>('reference')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const sortedProducts = useMemo(() => {
    if (!products) return []
    const colMap: Record<string, (p: Product) => string | number> = {
      reference:   p => p.reference?.toLowerCase() ?? '',
      name:        p => (p.product_name || p.model || '').toLowerCase(),
      size_range:  p => (p.size_range || '').toLowerCase(),
      price:       p => p.base_price ?? 0,
      pieces:      p => p.grade_configs?.reduce((s, g) => s + (g.total_pieces || 0), 0) ?? 0,
      category:    p => (p.category || '').toLowerCase(),
      factory:     p => (p.factory_name || '').toLowerCase(),
      table:       p => (p.price_table_name || '').toLowerCase(),
      observation: p => (p.observation || '').toLowerCase(),
    }
    const fn = colMap[sortCol]
    if (!fn) return products
    return [...products].sort((a, b) => {
      const av = fn(a), bv = fn(b)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [products, sortCol, sortDir])

  const { orderedDefs, config, save, reset } = useColumnConfig('products', PRODUCT_COL_DEFS)
  const visibleCols = orderedDefs.filter(c => c.visible)

  const COL_ALIGN: Record<string, string> = { price: 'text-right', pieces: 'text-center' }
  const total = products?.length || 0

  // Atualiza produto no detalhe modal quando muda availability/blocked_sizes
  function handleProductUpdated(updated: Partial<Product>) {
    setDetailProduct(prev => prev ? { ...prev, ...updated } : null)
  }

  function handleDuplicate(p: Product, e: React.MouseEvent) {
    e.stopPropagation()
    setDuplicateSource(p)
    setShowCreateModal(true)
  }

  return (
    <div className="flex flex-col h-full">

      {/* ══ MOBILE VIEW ══════════════════════════════════════════════════════ */}
      <div className="lg:hidden flex flex-col h-full bg-[#f8f9ff]">

        {/* Mobile header */}
        <div className="px-4 pt-3 pb-2 bg-white border-b border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display text-lg font-bold text-on-surface">Produtos</h2>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-outline">
                {isLoading ? '' : `${total} produto${total !== 1 ? 's' : ''}`}
              </span>
              {isAdmin && (
                <button onClick={() => { setDuplicateSource(null); setShowCreateModal(true) }}
                  className="flex items-center gap-1 bg-primary text-white text-[12px] font-semibold px-3 py-1.5 rounded-xl">
                  <Plus className="h-3.5 w-3.5" /> Novo
                </button>
              )}
            </div>
          </div>
          <div className="relative mb-1.5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-outline" />
            <input
              value={search}
              onChange={e => handleSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { handleSearch(''); e.currentTarget.blur() } }}
              placeholder="Referência, nome, fábrica..."
              className="w-full h-11 pl-10 pr-4 bg-surface-container-low border border-outline-variant/60 rounded-xl text-[12px] focus:ring-2 focus:ring-primary focus:border-primary outline-none"
            />
          </div>
          {/* Filtros mobile */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {/* Tipo */}
            {['', 'regular', 'pack'].map(t => (
              <button key={t}
                onClick={() => setTypeFilter(t)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold uppercase tracking-wide transition-colors ${
                  typeFilter === t
                    ? t === 'pack' ? 'bg-violet-600 text-white' : 'bg-primary text-white'
                    : 'bg-surface-container text-on-surface-variant border border-outline-variant/60'
                }`}>
                {t === '' ? 'Todos' : t === 'regular' ? 'Regular' : 'Pack'}
              </button>
            ))}
            {/* Status Ativas/Todas/Inativas */}
            {isAdmin && ([['active','Ativas'],['all','Todas'],['inactive','Inativas']] as const).map(([val, label]) => (
              <button key={val} onClick={() => setActiveFilter(val)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold uppercase tracking-wide transition-colors ${
                  activeFilter === val
                    ? val === 'inactive' ? 'bg-red-500 text-white' : 'bg-emerald-600 text-white'
                    : 'bg-surface-container text-on-surface-variant border border-outline-variant/60'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><PageSpinner /></div>
          ) : total === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-8">
              <p className="text-outline font-medium">Nenhum produto encontrado</p>
            </div>
          ) : (
            <div className="p-4 grid grid-cols-2 gap-3 pb-28">
              {(products || []).map(p => {
                const pieces = p.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 0
                return (
                  <button
                    key={p.id}
                    onClick={() => setDetailProduct(p)}
                    className={`bg-white rounded-2xl border text-left overflow-hidden active:scale-[0.97] transition-transform shadow-sm ${
                      p.active ? 'border-outline-variant/40' : 'border-outline-variant/20 opacity-60'
                    }`}
                  >
                    {/* Image */}
                    {p.image_url ? (
                      <div className="w-full aspect-square bg-surface-container">
                        <img src={p.image_url} alt={p.reference} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-full aspect-square bg-gradient-to-br from-surface-container to-surface-container-high flex items-center justify-center">
                        <span className="text-3xl font-black text-outline/20 font-mono">{p.reference.slice(0, 3)}</span>
                      </div>
                    )}
                    {/* Info */}
                    <div className="p-2">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className={`text-[12px] font-bold px-1.5 py-0.5 rounded-full uppercase ${
                          p.type === 'pack' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {p.type === 'pack' ? 'PACK' : 'REG'}
                        </span>
                        {!p.active && <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-red-600 text-white tracking-wide">INATIVA</span>}
                      </div>
                      <p className="text-[12px] font-bold text-primary font-mono leading-tight truncate">{p.reference}</p>
                      {p.product_name && (
                        <p className="text-[12px] text-on-surface-variant truncate mt-0.5">{p.product_name}</p>
                      )}
                      <div className="mt-2 flex items-end justify-between">
                        <div>
                          <p className="text-[12px] font-bold text-on-surface leading-none">
                            R$ {Number(p.base_price).toFixed(2)}
                          </p>
                          <p className="text-[12px] text-outline">/peça{pieces > 0 ? ` · ${pieces}pç/cx` : ''}</p>
                        </div>
                      </div>
                      {p.factory_name && (
                        <p className="text-[12px] text-outline mt-1 truncate">{p.factory_name}</p>
                      )}
                      {p.observation && (
                        <p className="text-[11px] text-orange-500 mt-1 truncate" title={p.observation}>
                          {p.observation}
                        </p>
                      )}
                      {isAdmin && (
                        <button
                          onClick={(e) => handleDuplicate(p, e)}
                          className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] text-primary font-semibold border border-primary/30 rounded-lg py-1 hover:bg-primary/5"
                        >
                          <Plus className="h-3 w-3" /> Duplicar
                        </button>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ══ DESKTOP VIEW ═════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 lg:px-8 border-b border-outline-variant bg-white">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="font-display text-lg font-bold text-on-surface">Produtos</h1>
            <p className="text-[12px] text-outline">
              {isLoading ? 'Carregando…' : `${total} produto${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={() => { setDuplicateSource(null); setShowCreateModal(true) }}
                className="flex items-center gap-1.5 text-[12px] font-semibold bg-primary text-white rounded-lg px-3 py-1.5 hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-4 w-4" /> Novo Produto
              </button>
            )}
            {isAdmin && (
              <div className="flex rounded-lg border border-outline-variant overflow-hidden text-[12px] font-semibold">
                {([['active','Ativas'],['all','Todas'],['inactive','Inativas']] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setActiveFilter(val)}
                    className={`px-3 py-1 transition-colors ${activeFilter === val
                      ? val === 'inactive' ? 'bg-red-500 text-white' : 'bg-primary text-white'
                      : 'bg-white text-on-surface-variant hover:bg-surface-container'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setFotoFilter(v => v === 'com' ? '' : 'com')}
              className={`flex items-center gap-1.5 text-[12px] font-semibold rounded-lg px-3 py-1 border transition-colors ${
                fotoFilter === 'com'
                  ? 'bg-emerald-500 text-white border-emerald-500'
                  : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
              }`}
              title="Mostrar só produtos com foto"
            >
              <ImageIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Com Foto</span>
            </button>
            <button
              onClick={() => setFotoFilter(v => v === 'sem' ? '' : 'sem')}
              className={`flex items-center gap-1.5 text-[12px] font-semibold rounded-lg px-3 py-1 border transition-colors ${
                fotoFilter === 'sem'
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200'
              }`}
              title="Mostrar só produtos sem foto"
            >
              <ImageIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Sem Foto</span>
            </button>
            <button
              onClick={() => setShowZipImport(true)}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-on-surface-variant bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-lg px-3 py-1 transition-colors"
              title="Importar fotos via ZIP"
            >
              <Archive className="h-4 w-4" />
              <span className="hidden sm:inline">Fotos ZIP</span>
            </button>
            <input ref={stockFileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={async e => {
                const file = e.target.files?.[0]; if (!file) return
                setStockBusy(true)
                try {
                  const r = await priceTablesApi.importStock(file)
                  const d = r.data
                  qc.invalidateQueries({ queryKey: ['all-products'] })
                  alert(`✅ Estoque importado!\n${d.matched} de ${d.totalRefs} referências atualizadas (${d.totalRows} linhas).` + (d.notFoundCount ? `\n⚠️ ${d.notFoundCount} referência(s) da planilha não existem no catálogo.` : ''))
                } catch {
                  alert('Erro ao importar estoque. Verifique se é a planilha certa (Referência / Cor / Tamanho / Estoque).')
                } finally { setStockBusy(false); if (stockFileRef.current) stockFileRef.current.value = '' }
              }} />
            <button
              onClick={() => stockFileRef.current?.click()}
              disabled={stockBusy}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg px-3 py-1 transition-colors disabled:opacity-60"
              title="Importar planilha de estoque (diária)"
            >
              <Package className="h-4 w-4" />
              <span className="hidden sm:inline">{stockBusy ? 'Importando…' : 'Importar Estoque'}</span>
            </button>
            <ColumnConfigButton
              defs={PRODUCT_COL_DEFS}
              config={config}
              onSave={save}
              onReset={reset}
            />
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              placeholder="Buscar por referência, nome, modelo, categoria, fábrica..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Escape') { handleSearch(''); e.currentTarget.blur() } }}
              leftIcon={<Search className="h-4 w-4" />}
            />
          </div>
          <select
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            title="Filtrar por tabela de preços"
            className="border border-outline-variant rounded-lg px-3 py-1 text-[12px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white max-w-[220px]"
          >
            <option value="">Todas as tabelas</option>
            {filterTables.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-outline-variant rounded-lg px-3 py-1 text-[12px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
          >
            <option value="">Todos</option>
            <option value="regular">Regular</option>
            <option value="pack">Pack</option>
          </select>
        </div>
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center"><PageSpinner /></div>
      ) : total === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 bg-surface-container rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ChevronDown className="h-8 w-8 text-outline/50" />
          </div>
          <p className="text-outline font-medium">Nenhum produto encontrado</p>
          <p className="text-[12px] text-outline/70 mt-1">
            {debouncedSearch
              ? `Nenhum resultado para "${debouncedSearch}"`
              : 'Importe uma tabela de preços para começar'}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left" style={{ minWidth: 800, tableLayout: 'fixed' }}>
            <thead className="bg-surface-container-low border-b border-outline-variant sticky top-0 z-10">
              <tr>
                {visibleCols.map(col => {
                  const sortable = col.id !== 'image'
                  const active = sortCol === col.id
                  const colWidth = widths[col.id] ?? PRODUCT_COL_WIDTHS[col.id] ?? 120
                  return (
                    <th
                      key={col.id}
                      onClick={sortable ? () => handleSort(col.id) : undefined}
                      style={{ width: colWidth, minWidth: 44, position: 'relative' }}
                      className={`px-2 py-1.5 text-[12px] font-semibold text-outline first:pl-3 last:pr-3 ${COL_ALIGN[col.id] ?? ''} ${sortable ? 'cursor-pointer select-none hover:text-on-surface' : ''}`}
                    >
                      <span className="inline-flex items-center gap-0.5 truncate max-w-full align-middle">
                        {col.label}
                        {sortable && <span className={`text-[12px] ${active ? 'text-primary' : 'text-outline/30'}`}>{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span>}
                      </span>
                      {/* Alça de redimensionar (linha divisória sempre visível) */}
                      <div
                        onClick={e => e.stopPropagation()}
                        onMouseDown={e => {
                          e.preventDefault(); e.stopPropagation()
                          const startX = e.clientX
                          const startW = colWidth
                          const onMove = (ev: MouseEvent) => saveWidths({ ...widths, [col.id]: Math.max(44, startW + ev.clientX - startX) })
                          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                          window.addEventListener('mousemove', onMove)
                          window.addEventListener('mouseup', onUp)
                        }}
                        title="Arraste para redimensionar"
                        style={{ position: 'absolute', top: 0, right: 0, width: 9, height: '100%', cursor: 'col-resize', zIndex: 20 }}
                        className="group flex justify-end"
                      >
                        <div className="w-px h-full bg-outline-variant group-hover:w-[3px] group-hover:bg-primary transition-all" />
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-50">
              {sortedProducts.map(p => (
                <ProductRow key={p.id} p={p} visibleCols={visibleCols} onOpenDetail={setDetailProduct} onDuplicate={isAdmin ? (prod) => { setDuplicateSource(prod); setShowCreateModal(true) } : undefined} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      </div> {/* end desktop view */}

      {/* Modal Criar / Duplicar Produto */}
      {showCreateModal && (
        <CreateProductModal
          source={duplicateSource}
          onClose={() => { setShowCreateModal(false); setDuplicateSource(null) }}
          onSaved={() => {
            setShowCreateModal(false)
            setDuplicateSource(null)
            qc.invalidateQueries({ queryKey: ['all-products'] })
          }}
        />
      )}

      {/* Modal detalhe produto — compartilhado mobile+desktop */}
      {detailProduct && (
        <ProductDetailModal
          p={detailProduct}
          isAdmin={isAdmin}
          onClose={() => setDetailProduct(null)}
          onUpdated={handleProductUpdated}
        />
      )}

      {/* Modal importar fotos ZIP */}
      <PhotosZipImportModal
        open={showZipImport}
        onClose={() => setShowZipImport(false)}
        onDone={() => qc.invalidateQueries({ queryKey: ['all-products'] })}
      />
    </div>
  )
}
