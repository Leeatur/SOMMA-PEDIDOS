import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Image as ImageIcon, ChevronDown, Archive, ToggleLeft, ToggleRight, Lock, Unlock, Pencil, Plus, Trash2, X } from 'lucide-react'
import { productsApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import { Modal } from '../components/ui/Modal'
import { ColumnDef, ColumnConfigButton, useColumnConfig } from '../components/ui/ColumnConfig'
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

  // Sizes used as grade columns — derived from editForm.size_range live
  const gradeSizes = useMemo(() => {
    const fromRange = parseSizeRange(editForm.size_range)
    if (fromRange.length > 0) return fromRange
    // Fallback to sizes already in grade rows
    const allFromGrade = sortSizes(Array.from(new Set(editGrade.flatMap(r => Object.keys(r.sizes)))))
    return allFromGrade
  }, [editForm.size_range, editGrade])

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
      })
      const gradePayload = editGrade
        .filter(row => Object.values(row.sizes).some(v => v > 0))
        .map((row, i) => ({ color: row.color || null, sizes: row.sizes, sort_order: i }))
      const gradeRes = await productsApi.updateGrade(p.id, gradePayload)
      onUpdated({
        reference: res.data.reference,
        product_name: res.data.product_name,
        model: res.data.model,
        size_range: res.data.size_range,
        base_price: res.data.base_price,
        category: res.data.category,
        observation: res.data.observation,
        type: res.data.type,
        grade_configs: gradeRes.data,
      })
      qc.invalidateQueries({ queryKey: ['all-products'] })
      setEditing(false)
    } catch {
      setSaveError('Erro ao salvar. Verifique os dados e tente novamente.')
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
    const inputCls = "w-full border border-outline-variant rounded-lg px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary bg-white"
    return (
      <Modal open onClose={() => setEditing(false)} title={`Editar: ${p.reference}`} size="lg">
        <div className="space-y-4">
          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">{saveError}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-outline mb-1">Referência *</label>
              <input className={inputCls} value={editForm.reference} onChange={e => setEditForm(f => ({ ...f, reference: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-outline mb-1">Tipo</label>
              <select className={inputCls} value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value as 'regular' | 'pack' }))}>
                <option value="regular">Regular</option>
                <option value="pack">Pack</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-outline mb-1">Nome do produto</label>
            <input className={inputCls} value={editForm.product_name} onChange={e => setEditForm(f => ({ ...f, product_name: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-outline mb-1">Modelo</label>
              <input className={inputCls} value={editForm.model} onChange={e => setEditForm(f => ({ ...f, model: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-outline mb-1">Categoria</label>
              <input className={inputCls} value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-outline mb-1">Preço por peça (R$) *</label>
              <input type="number" step="0.01" min="0" className={inputCls} value={editForm.base_price}
                onChange={e => setEditForm(f => ({ ...f, base_price: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-outline mb-1">Faixa de tamanhos</label>
              <input className={inputCls} placeholder="ex: P-GG ou 36-48" value={editForm.size_range}
                onChange={e => setEditForm(f => ({ ...f, size_range: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-outline mb-1">Observação</label>
            <textarea className={`${inputCls} resize-none h-16`} value={editForm.observation}
              onChange={e => setEditForm(f => ({ ...f, observation: e.target.value }))} />
          </div>

          {/* Grade editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-outline uppercase tracking-wide">Grade</p>
              <button type="button" onClick={addGradeRow}
                className="flex items-center gap-1 text-xs text-primary border border-primary/30 rounded-lg px-2 py-1 hover:bg-primary/5">
                <Plus className="h-3 w-3" /> Adicionar linha
              </button>
            </div>
            {gradeSizes.length === 0 ? (
              <p className="text-xs text-outline/70 italic">Preencha a faixa de tamanhos para editar a grade.</p>
            ) : (
              <div className="space-y-2">
                {editGrade.map((row, rowIdx) => (
                  <div key={rowIdx} className="bg-surface-container-low rounded-xl p-2.5">
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        placeholder="Cor (opcional)"
                        className="border border-outline-variant rounded-lg px-2 py-1 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary bg-white flex-1"
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
                    <div className="overflow-x-auto scrollbar-hide">
                      <table className="min-w-max text-xs border border-outline-variant rounded-lg overflow-hidden">
                        <thead className="bg-white">
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
                                  className="w-10 text-center text-xs border border-outline-variant/60 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
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

          <div className="flex gap-2 pt-2 border-t border-outline-variant">
            <button onClick={handleSave} disabled={saving || !editForm.reference}
              className="flex-1 bg-primary text-white rounded-xl py-2.5 text-xs font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors">
              {saving ? 'Salvando…' : 'Salvar alterações'}
            </button>
            <button onClick={() => setEditing(false)}
              className="px-4 py-2.5 border border-outline-variant rounded-xl text-xs font-semibold text-on-surface-variant hover:bg-surface-container transition-colors flex items-center gap-1.5">
              <X className="h-4 w-4" /> Cancelar
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  // ── View mode ────────────────────────────────────────────────────────────
  return (
    <Modal open onClose={onClose} title={p.reference} size="md">
      <div className="space-y-4">
        {isAdmin && (
          <div className="flex justify-end">
            <button onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary border border-primary/30 bg-primary/5 hover:bg-primary/10 rounded-lg px-3 py-1.5 transition-colors">
              <Pencil className="h-3.5 w-3.5" /> Editar referência
            </button>
          </div>
        )}

        {p.image_url ? (
          <div className="w-full aspect-square max-h-64 overflow-hidden rounded-xl bg-surface-container">
            <img src={p.image_url} alt={p.reference} className="w-full h-full object-contain" />
          </div>
        ) : (
          <div className="w-full h-40 bg-surface-container rounded-xl flex items-center justify-center text-outline/50">
            <ImageIcon className="h-12 w-12" />
          </div>
        )}

        <div className="flex items-start gap-2 flex-wrap">
          <Badge variant={p.type === 'pack' ? 'purple' : 'info'}>
            {p.type === 'pack' ? 'PACK' : 'Regular'}
          </Badge>
          {!p.active && <Badge variant="danger">Indisponível</Badge>}
          {p.product_name && <span className="text-xs font-semibold text-on-surface">{p.product_name}</span>}
          {p.model && <span className="text-xs text-outline">{p.model}</span>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-primary/10 rounded-xl p-3 text-center">
            <p className="text-xs text-primary/80 mb-0.5">Preço por peça</p>
            <p className="text-xs font-bold text-primary">R$ {Number(p.base_price).toFixed(2)}</p>
          </div>
          {p.type === 'pack' && totalPieces > 0 && (
            <div className="bg-surface-container-low rounded-xl p-3 text-center">
              <p className="text-xs text-outline mb-0.5">Preço por caixa ({totalPieces} pç)</p>
              <p className="text-xs font-bold text-on-surface">R$ {pricePerBox.toFixed(2)}</p>
            </div>
          )}
        </div>

        <div className="space-y-1.5 text-xs">
          {p.size_range && (
            <div className="flex justify-between">
              <span className="text-outline">Tamanhos</span>
              <span className="font-medium text-on-surface">{p.size_range}</span>
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
          <div className="bg-surface-container-low rounded-xl px-4 py-2.5">
            <p className="text-xs text-outline mb-2 font-medium uppercase tracking-wide">
              {p.type === 'regular' ? 'Tamanhos disponíveis' : 'Grade por caixa'}
            </p>
            {p.type === 'regular' ? (
              <div className="flex flex-wrap gap-1.5">
                {sortSizes(Array.from(new Set(p.grade_configs.flatMap(gc => Object.keys(gc.sizes)).flatMap(expandSizeKey)))).map(s => (
                  <span key={s} className="px-2.5 py-1 text-xs font-semibold bg-white text-primary rounded-lg border border-primary/30 shadow-sm">
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {p.grade_configs.map((gc, i) => {
                  const expandedSizes = expandGradeSizes(gc.sizes)
                  const sizes = sortSizes(Object.keys(expandedSizes))
                  return (
                    <div key={i}>
                      {gc.color && <p className="text-xs font-medium text-on-surface-variant mb-1">{gc.color}</p>}
                      <div className="overflow-x-auto scrollbar-hide">
                        <table className="min-w-max text-xs border border-outline-variant rounded-lg overflow-hidden">
                          <thead className="bg-white">
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
          <div className="border-t border-outline-variant pt-4 space-y-4">

            {/* Disponibilidade */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-on-surface">Disponibilidade</p>
                <p className="text-xs text-outline">
                  {p.active ? 'Referência disponível para venda' : 'Referência bloqueada — não aparece para representantes'}
                </p>
              </div>
              <button
                onClick={() => availMut.mutate(!p.active)}
                disabled={availMut.isPending}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
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

            {/* Bloqueio de tamanhos (apenas regular com tamanhos conhecidos) */}
            {p.type === 'regular' && allSizes.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-xs font-semibold text-on-surface">Tamanhos bloqueados</p>
                    <p className="text-xs text-outline">Clique para bloquear/desbloquear cada tamanho</p>
                  </div>
                  {blockedChanged && (
                    <button
                      onClick={saveBlockedSizes}
                      disabled={savingBlocked}
                      className="text-xs px-3 py-1 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-60"
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
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all ${
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
  { id: 'observation', label: 'Observação', defaultVisible: false },
]

function ProductRow({
  p,
  visibleCols,
  onOpenDetail,
}: {
  p: Product
  visibleCols: Array<ColumnDef & { visible: boolean }>
  onOpenDetail: (p: Product) => void
}) {
  const totalPieces = p.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 0
  const blockedCount = (p.blocked_sizes || []).length

  const renderCell = (id: string) => {
    switch (id) {
      case 'image':
        return (
          <td key={id} className="pl-3 pr-2 py-2 w-14">
            <div className="w-10 h-10 rounded-lg bg-surface-container overflow-hidden flex-shrink-0 flex items-center justify-center">
              {p.image_url
                ? <img src={p.image_url} alt={p.reference} className="w-full h-full object-cover" />
                : <ImageIcon className="h-4 w-4 text-outline/50" />}
            </div>
          </td>
        )
      case 'reference':
        return (
          <td key={id} className="px-2 py-2">
            <div className="flex items-center gap-1.5">
              <span className={`font-bold text-xs whitespace-nowrap ${p.active ? 'text-primary' : 'text-outline line-through'}`}>
                {p.reference}
              </span>
              <Badge variant={p.type === 'pack' ? 'purple' : 'info'} className="text-[10px] px-1.5 py-0">
                {p.type === 'pack' ? 'PK' : 'REG'}
              </Badge>
              {!p.active && (
                <Badge variant="danger" className="text-[10px] px-1.5 py-0">Indisp.</Badge>
              )}
              {blockedCount > 0 && p.active && (
                <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-medium">
                  {blockedCount} tam. bloq.
                </span>
              )}
            </div>
          </td>
        )
      case 'name':
        return (
          <td key={id} className="px-2 py-2 max-w-[180px]">
            <p className="text-xs font-medium text-on-surface truncate">{p.product_name || '—'}</p>
            {p.model && <p className="text-xs text-outline/70 truncate">{p.model}</p>}
          </td>
        )
      case 'size_range':
        return (
          <td key={id} className="px-2 py-2 whitespace-nowrap">
            <span className="text-xs text-on-surface-variant">{p.size_range || '—'}</span>
          </td>
        )
      case 'price':
        return (
          <td key={id} className="px-2 py-2 whitespace-nowrap text-right">
            <span className="text-xs font-bold text-primary">R$ {Number(p.base_price).toFixed(2)}</span>
            <span className="text-xs text-outline/70 ml-0.5">/pç</span>
          </td>
        )
      case 'pieces':
        return (
          <td key={id} className="px-2 py-2 whitespace-nowrap text-center">
            <span className="text-xs text-outline">{totalPieces > 0 ? `${totalPieces} pç` : '—'}</span>
          </td>
        )
      case 'category':
        return (
          <td key={id} className="px-2 py-2 max-w-[120px]">
            <span className="text-xs text-outline truncate block">{p.category || '—'}</span>
          </td>
        )
      case 'factory':
        return (
          <td key={id} className="px-2 py-2 max-w-[120px]">
            <span className="text-xs text-on-surface-variant truncate block">{p.factory_name || '—'}</span>
          </td>
        )
      case 'table':
        return (
          <td key={id} className="px-2 py-2 max-w-[150px]">
            <span className="text-xs text-outline truncate block">{p.price_table_name || '—'}</span>
          </td>
        )
      case 'observation':
        return (
          <td key={id} className="px-2 pr-3 py-2 max-w-[140px]">
            <span className="text-[10px] text-orange-500 truncate block">{p.observation || '—'}</span>
          </td>
        )
      default:
        return <td key={id} className="px-2 py-2" />
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
    </tr>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export function Products() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [showZipImport, setShowZipImport] = useState(false)

  const handleSearch = (val: string) => {
    setSearch(val)
    clearTimeout((window as unknown as { _searchTimer?: number })._searchTimer)
    ;(window as unknown as { _searchTimer?: number })._searchTimer = window.setTimeout(() => {
      setDebouncedSearch(val)
    }, 350)
  }

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ['all-products', debouncedSearch, typeFilter, showInactive],
    queryFn: () =>
      productsApi.list({
        search: debouncedSearch || undefined,
        type: typeFilter || undefined,
        include_inactive: isAdmin && showInactive ? true : undefined,
      }).then(r => r.data),
  })

  const { orderedDefs, config, save, reset } = useColumnConfig('products', PRODUCT_COL_DEFS)
  const visibleCols = orderedDefs.filter(c => c.visible)

  const COL_ALIGN: Record<string, string> = { price: 'text-right', pieces: 'text-center' }
  const total = products?.length || 0

  // Atualiza produto no detalhe modal quando muda availability/blocked_sizes
  function handleProductUpdated(updated: Partial<Product>) {
    setDetailProduct(prev => prev ? { ...prev, ...updated } : null)
  }

  return (
    <div className="flex flex-col h-full">

      {/* ══ MOBILE VIEW ══════════════════════════════════════════════════════ */}
      <div className="lg:hidden flex flex-col h-full bg-[#f8f9ff]">

        {/* Mobile header */}
        <div className="px-4 pt-4 pb-3 bg-white border-b border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg font-bold text-on-surface">Produtos</h2>
            <span className="text-xs text-outline">
              {isLoading ? '' : `${total} produto${total !== 1 ? 's' : ''}`}
            </span>
          </div>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-outline" />
            <input
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Referência, nome, fábrica..."
              className="w-full h-11 pl-10 pr-4 bg-surface-container-low border border-outline-variant/60 rounded-xl text-xs focus:ring-2 focus:ring-primary focus:border-primary outline-none"
            />
          </div>
          {/* Type filter chips */}
          <div className="flex gap-2">
            {['', 'regular', 'pack'].map(t => (
              <button key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide transition-colors ${
                  typeFilter === t
                    ? t === 'pack' ? 'bg-violet-600 text-white' : 'bg-primary text-white'
                    : 'bg-surface-container text-on-surface-variant border border-outline-variant/60'
                }`}>
                {t === '' ? 'Todos' : t === 'regular' ? 'Regular' : 'Pack'}
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
                    <div className="p-2.5">
                      <div className="flex items-center gap-1 mb-1">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${
                          p.type === 'pack' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {p.type === 'pack' ? 'PACK' : 'REG'}
                        </span>
                        {!p.active && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">INDISP</span>}
                      </div>
                      <p className="text-xs font-bold text-primary font-mono leading-tight truncate">{p.reference}</p>
                      {p.product_name && (
                        <p className="text-[11px] text-on-surface-variant truncate mt-0.5">{p.product_name}</p>
                      )}
                      <div className="mt-2 flex items-end justify-between">
                        <div>
                          <p className="text-xs font-bold text-on-surface leading-none">
                            R$ {Number(p.base_price).toFixed(2)}
                          </p>
                          <p className="text-[9px] text-outline">/peça{pieces > 0 ? ` · ${pieces}pç/cx` : ''}</p>
                        </div>
                      </div>
                      {p.factory_name && (
                        <p className="text-[10px] text-outline mt-1 truncate">{p.factory_name}</p>
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
      <div className="px-4 pt-5 pb-3 lg:px-8 border-b border-outline-variant bg-white">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="font-display text-lg font-bold text-on-surface">Produtos</h1>
            <p className="text-xs text-outline">
              {isLoading ? 'Carregando…' : `${total} produto${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={() => setShowInactive(v => !v)}
                className={`flex items-center gap-1.5 text-xs font-semibold border rounded-lg px-3 py-2 transition-colors ${
                  showInactive
                    ? 'bg-red-50 border-red-300 text-red-700'
                    : 'bg-surface-container hover:bg-surface-container-high border-outline-variant text-on-surface-variant'
                }`}
                title="Mostrar referências indisponíveis"
              >
                {showInactive ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                <span className="hidden sm:inline">Inativas</span>
              </button>
            )}
            <button
              onClick={() => setShowZipImport(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-lg px-3 py-2 transition-colors"
              title="Importar fotos via ZIP"
            >
              <Archive className="h-4 w-4" />
              <span className="hidden sm:inline">Fotos ZIP</span>
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
              leftIcon={<Search className="h-4 w-4" />}
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-outline-variant rounded-lg px-3 py-2 text-xs text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
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
          <p className="text-xs text-outline/70 mt-1">
            {debouncedSearch
              ? `Nenhum resultado para "${debouncedSearch}"`
              : 'Importe uma tabela de preços para começar'}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low border-b border-outline-variant sticky top-0 z-10">
              <tr>
                {visibleCols.map(col => (
                  <th
                    key={col.id}
                    className={`px-2 py-2.5 text-xs font-semibold text-outline first:pl-3 last:pr-3 ${COL_ALIGN[col.id] ?? ''}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-50">
              {(products || []).map(p => (
                <ProductRow key={p.id} p={p} visibleCols={visibleCols} onOpenDetail={setDetailProduct} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      </div> {/* end desktop view */}

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
