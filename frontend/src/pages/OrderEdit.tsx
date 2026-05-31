import { useState, useCallback, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft, Save, X, Search, Trash2, AlertTriangle,
  Loader2, Eye, Printer,
} from 'lucide-react'
import {
  ordersApi, clientsApi, usersApi, statusesApi, productsApi,
} from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { formatCurrency, formatOrderNumber } from '../utils/format'
import { PageSpinner } from '../components/ui/Spinner'

// ── tipos ──────────────────────────────────────────────────────────────────────

interface GradeConfig {
  id: string
  color: string | null
  sizes: Record<string, number>
  total_pieces: number
  sort_order: number
}

interface DraftGradeEntry {
  color: string | null
  sizes: Record<string, number>
  total_pieces: number
  sort_order: number
}

interface OrderItemRaw {
  id: string
  product_id: string
  reference: string
  product_name: string | null
  type: 'regular' | 'pack'
  image_url: string | null
  size_range: string | null
  boxes_count: number
  unit_price: number
  total_pieces: number
  subtotal: number
  sizes: Record<string, number> | null
  grade_configs: GradeConfig[] | null
  custom_grade: DraftGradeEntry[] | null
}

interface EditableItem extends OrderItemRaw {
  draftSizes: Record<string, number>
  draftBoxes: number
  draftGrade: DraftGradeEntry[]
  removed: boolean
}

interface NewItem {
  tempId: string
  product_id: string
  reference: string
  product_name: string | null
  type: 'regular' | 'pack'
  image_url: string | null
  size_range: string | null
  blocked_sizes: string[] | null
  unit_price: number
  grade_configs: GradeConfig[] | null
  draftSizes: Record<string, number>
  draftBoxes: number
  draftGrade: DraftGradeEntry[]
}

interface Product {
  id: string
  reference: string
  type: 'regular' | 'pack'
  product_name: string | null
  base_price: number
  image_url: string | null
  size_range: string | null
  blocked_sizes: string[] | null
  grade_configs: GradeConfig[] | null
}

interface ClientOption { id: string; name: string; trade_name: string | null; city: string | null }
interface UserOption { id: string; name: string; role: string }
interface StatusOption { id: string; name: string; color: string }

// ── constantes ─────────────────────────────────────────────────────────────────

const SIZE_ORDER = [
  'RN','PP','XP','P','M','G','GG','XG','EXG','XGG','2XG','3XG','4XG',
  '34','36','38','40','42','44','46','48','50','52','54','56','58','60',
  '1','2','4','6','8','10','12','14','16','18','U',
]

function sortSizes(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a.toUpperCase())
    const bi = SIZE_ORDER.indexOf(b.toUpperCase())
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

function parseSizeRange(sizeRange: string | null | undefined): string[] {
  if (!sizeRange) return []
  // Padrão "36 ao 46"
  const m1 = sizeRange.match(/^(\d+)\s+ao\s+(\d+)$/i)
  if (m1) {
    const lo = parseInt(m1[1]), hi = parseInt(m1[2])
    return SIZE_ORDER.filter(s => { const n = parseInt(s); return !isNaN(n) && n >= lo && n <= hi })
  }
  // Padrão "36-48", "P-GG", "P-EXG" etc — qualquer X-Y via SIZE_ORDER
  const m2 = sizeRange.match(/^([A-Za-z0-9]+)-([A-Za-z0-9]+)$/)
  if (m2) {
    const s = SIZE_ORDER.indexOf(m2[1].toUpperCase())
    const e = SIZE_ORDER.indexOf(m2[2].toUpperCase())
    if (s >= 0 && e >= s) return SIZE_ORDER.slice(s, e + 1)
  }
  // Padrão "P M G GG" ou lista separada
  return sizeRange.split(/[\s,]+/).filter(Boolean)
}

function initSizes(product: Product | OrderItemRaw): Record<string, number> {
  const blocked = new Set(('blocked_sizes' in product ? product.blocked_sizes : null) || [])

  // Descobre todos os tamanhos disponíveis para este produto
  let allSizes: string[] = []
  if (product.grade_configs && product.grade_configs.length > 0) {
    const all = new Set<string>()
    product.grade_configs.forEach(gc => {
      if (gc.sizes) Object.keys(gc.sizes).forEach(s => all.add(s))
    })
    allSizes = sortSizes([...all]).filter(s => !blocked.has(s))
  }
  if (allSizes.length === 0 && product.size_range) {
    allSizes = sortSizes(parseSizeRange(product.size_range)).filter(s => !blocked.has(s))
  }

  // Inicia todos os tamanhos com 0
  const result: Record<string, number> = Object.fromEntries(allSizes.map(s => [s, 0]))

  // Sobrepõe com valores já salvos (se item existente)
  if ('sizes' in product && product.sizes) {
    for (const [s, v] of Object.entries(product.sizes)) {
      if (!blocked.has(s) && s in result) result[s] = v
    }
  }

  return result
}

function initDraftGrade(item: OrderItemRaw): DraftGradeEntry[] {
  // Se já tem custom_grade salvo, usa ele diretamente
  if (item.custom_grade && item.custom_grade.length > 0) {
    return item.custom_grade.map(gc => ({ ...gc, sizes: { ...gc.sizes } }))
  }
  // Senão, inicializa a partir da grade do produto × caixas
  const boxes = item.boxes_count || 1
  return (item.grade_configs || []).map(gc => ({
    color: gc.color,
    sort_order: gc.sort_order,
    sizes: Object.fromEntries(
      Object.entries(gc.sizes).map(([s, q]) => [s, (q || 0) * boxes])
    ),
    total_pieces: gc.total_pieces * boxes,
  }))
}

function initDraftGradeFromProduct(prod: Product): DraftGradeEntry[] {
  return (prod.grade_configs || []).map(gc => ({
    color: gc.color,
    sort_order: gc.sort_order,
    sizes: { ...gc.sizes },  // quantidades por caixa (padrão = 1 cx)
    total_pieces: gc.total_pieces,
  }))
}

function calcPieces(item: EditableItem | NewItem): number {
  if (item.type === 'regular') {
    return Object.values(item.draftSizes).reduce((s, v) => s + (v || 0), 0)
  }
  return item.draftGrade.reduce((s, gc) => s + gc.total_pieces, 0)
}

function calcSubtotal(item: EditableItem | NewItem): number {
  // preço por PEÇA × total de peças (tanto regular quanto pack)
  return item.unit_price * calcPieces(item)
}

// ── componente principal ───────────────────────────────────────────────────────

export default function OrderEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  // ── dados remotos ────────────────────────────────────────────────────────────

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: () => ordersApi.get(id!).then(r => r.data),
  })

  const { data: statuses = [] } = useQuery<StatusOption[]>({
    queryKey: ['statuses'],
    queryFn: () => statusesApi.list().then(r => r.data),
  })

  const { data: usersList = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
    enabled: isAdmin,
  })

  // ── form header ──────────────────────────────────────────────────────────────

  const [form, setForm] = useState({
    client_id: '',
    client_display: '',
    buyer_name: '',
    transportadora: '',
    freight_type: 'CIF',
    delivery_date: '',
    payment_terms: '',
    rep_id: '',
    status_id: '',
    industry_order_number: '',
    discount_pct: '',
    notes: '',
  })

  // ── itens editáveis ──────────────────────────────────────────────────────────

  const [items, setItems] = useState<EditableItem[]>([])
  const [newItems, setNewItems] = useState<NewItem[]>([])

  // ── busca de clientes ────────────────────────────────────────────────────────

  const [clientResults, setClientResults] = useState<ClientOption[]>([])
  const [showClientDropdown, setShowClientDropdown] = useState(false)

  const handleClientSearch = useCallback(async (val: string) => {
    setForm(f => ({ ...f, client_display: val, client_id: '' }))
    if (val.length >= 2) {
      const res = await clientsApi.list(val)
      setClientResults(res.data || [])
      setShowClientDropdown(true)
    } else {
      setShowClientDropdown(false)
    }
  }, [])

  // ── busca de produtos para adicionar ────────────────────────────────────────

  const [prodSearch, setProdSearch] = useState('')
  const [prodResults, setProdResults] = useState<Product[]>([])
  const [showProdDropdown, setShowProdDropdown] = useState(false)
  const [searching, setSearching] = useState(false)

  const searchProducts = useCallback(async (val: string) => {
    setProdSearch(val)
    if (val.length < 2) { setShowProdDropdown(false); return }
    setSearching(true)
    try {
      const res = await productsApi.list({ price_table_id: order?.price_table_id, search: val })
      setProdResults(res.data || [])
      setShowProdDropdown(true)
    } finally {
      setSearching(false)
    }
  }, [order?.price_table_id])

  // ── inicializa form quando order carrega ─────────────────────────────────────

  useEffect(() => {
    if (!order) return
    setForm({
      client_id: order.client_id || '',
      client_display: order.client_trade_name || order.client_name || '',
      buyer_name: order.buyer_name || '',
      transportadora: order.transportadora || '',
      freight_type: order.freight_type || 'CIF',
      delivery_date: order.delivery_date ? order.delivery_date.split('T')[0] : '',
      payment_terms: order.payment_terms || '',
      rep_id: order.rep_id || '',
      status_id: order.status_id || '',
      industry_order_number: order.industry_order_number || '',
      discount_pct: String(order.discount_pct ?? ''),
      notes: order.notes || '',
    })
    setItems((order.items || []).map((it: OrderItemRaw) => ({
      ...it,
      draftSizes: initSizes(it),
      draftBoxes: it.boxes_count || 1,
      draftGrade: initDraftGrade(it),
      removed: false,
    })))
  }, [order])

  // ── handlers de itens ────────────────────────────────────────────────────────

  const updateSize = (itemId: string, size: string, val: number) => {
    setItems(prev => prev.map(it =>
      it.id === itemId ? { ...it, draftSizes: { ...it.draftSizes, [size]: val } } : it
    ))
  }

  const updateBoxes = (itemId: string, val: number) => {
    setItems(prev => prev.map(it =>
      it.id === itemId ? { ...it, draftBoxes: val } : it
    ))
  }

  const removeItem = (itemId: string) => {
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, removed: true } : it))
  }

  const updateNewSize = (tempId: string, size: string, val: number) => {
    setNewItems(prev => prev.map(it =>
      it.tempId === tempId ? { ...it, draftSizes: { ...it.draftSizes, [size]: val } } : it
    ))
  }

  const updateNewBoxes = (tempId: string, val: number) => {
    setNewItems(prev => prev.map(it =>
      it.tempId === tempId ? { ...it, draftBoxes: val } : it
    ))
  }

  const removeNewItem = (tempId: string) => {
    setNewItems(prev => prev.filter(it => it.tempId !== tempId))
  }

  const updateGrade = (itemId: string, colorIdx: number, size: string, val: number) => {
    setItems(prev => prev.map(it => {
      if (it.id !== itemId) return it
      const newGrade = it.draftGrade.map((gc, i) => {
        if (i !== colorIdx) return gc
        const newSizes = { ...gc.sizes, [size]: val }
        const total_pieces = Object.values(newSizes).reduce((s, v) => s + (v || 0), 0)
        return { ...gc, sizes: newSizes, total_pieces }
      })
      return { ...it, draftGrade: newGrade }
    }))
  }

  const updateNewGrade = (tempId: string, colorIdx: number, size: string, val: number) => {
    setNewItems(prev => prev.map(it => {
      if (it.tempId !== tempId) return it
      const newGrade = it.draftGrade.map((gc, i) => {
        if (i !== colorIdx) return gc
        const newSizes = { ...gc.sizes, [size]: val }
        const total_pieces = Object.values(newSizes).reduce((s, v) => s + (v || 0), 0)
        return { ...gc, sizes: newSizes, total_pieces }
      })
      return { ...it, draftGrade: newGrade }
    }))
  }

  const addProduct = (prod: Product) => {
    // Verifica se já existe (não removido)
    const existsActive = items.some(it => it.product_id === prod.id && !it.removed)
    const existsNew = newItems.some(it => it.product_id === prod.id)
    if (existsActive || existsNew) {
      setShowProdDropdown(false)
      setProdSearch('')
      return
    }
    const newItem: NewItem = {
      tempId: `new-${Date.now()}`,
      product_id: prod.id,
      reference: prod.reference,
      product_name: prod.product_name,
      type: prod.type,
      image_url: prod.image_url,
      size_range: prod.size_range,
      blocked_sizes: prod.blocked_sizes || null,
      unit_price: prod.base_price,
      grade_configs: prod.grade_configs || null,
      draftSizes: initSizes(prod),
      draftBoxes: 1,
      draftGrade: initDraftGradeFromProduct(prod),
    }
    setNewItems(prev => [...prev, newItem])
    setShowProdDropdown(false)
    setProdSearch('')
  }

  // ── totais calculados ────────────────────────────────────────────────────────

  const activeItems = items.filter(it => !it.removed)
  const allItems = [...activeItems, ...newItems]
  const totalPieces = allItems.reduce((s, it) => s + calcPieces(it), 0)
  const totalValue = allItems.reduce((s, it) => s + calcSubtotal(it), 0)

  // ── salvar ────────────────────────────────────────────────────────────────────

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const handleSave = async () => {
    if (!order) return
    setSaving(true)
    setSaveError('')
    try {
      const newDiscount = parseFloat(form.discount_pct.replace(',', '.')) || 0
      const oldDiscount = Number(order.discount_pct) || 0

      // 1. Desconto mudou → recalcula preços
      if (isAdmin && Math.abs(newDiscount - oldDiscount) > 0.001) {
        await ordersApi.changePriceTable(id!, order.price_table_id, newDiscount)
      }

      // 2. Info do cabeçalho
      await ordersApi.updateInfo(id!, {
        payment_terms: form.payment_terms || null,
        delivery_date: form.delivery_date || null,
        freight_type: form.freight_type || 'CIF',
        notes: form.notes || null,
        buyer_name: form.buyer_name || null,
        industry_order_number: form.industry_order_number || null,
        transportadora: form.transportadora || null,
        client_id: form.client_id && form.client_id !== order.client_id ? form.client_id : undefined,
        rep_id: isAdmin && form.rep_id && form.rep_id !== order.rep_id ? form.rep_id : undefined,
      })

      // 3. Status mudou
      if (form.status_id && form.status_id !== order.status_id) {
        await ordersApi.updateStatus(id!, form.status_id)
      }

      // 4. Remover itens marcados
      const removedIds = items.filter(it => it.removed).map(it => it.id)
      await Promise.all(removedIds.map(iid => ordersApi.removeItem(id!, iid)))

      // 5. Atualizar itens modificados
      for (const it of activeItems) {
        const origItem = order.items?.find((o: OrderItemRaw) => o.id === it.id)
        if (!origItem) continue
        if (it.type === 'regular') {
          const sizesChanged = JSON.stringify(it.draftSizes) !== JSON.stringify(origItem.sizes || {})
          if (sizesChanged) {
            await ordersApi.updateItem(id!, it.id, { sizes: it.draftSizes })
          }
        } else {
          // Pack: compara draftGrade com o estado inicial (custom_grade ou grade_configs × boxes)
          const origGrade = initDraftGrade(origItem)
          const gradeChanged = JSON.stringify(it.draftGrade) !== JSON.stringify(origGrade)
          if (gradeChanged) {
            await ordersApi.updateItem(id!, it.id, { custom_grade: it.draftGrade })
          }
        }
      }

      // 6. Adicionar novos itens
      if (newItems.length > 0) {
        const toAdd = newItems.map(it => ({
          product_id: it.product_id,
          reference: it.reference,
          boxes_count: 1,
          unit_price: it.unit_price,
          sizes: it.type === 'regular' ? it.draftSizes : undefined,
          custom_grade: it.type === 'pack' ? it.draftGrade : undefined,
        }))
        await ordersApi.addItems(id!, toAdd)
      }

      qc.invalidateQueries({ queryKey: ['order', id] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      navigate(`/orders/${id}`)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setSaveError(msg || 'Erro ao salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  // ── render helpers ────────────────────────────────────────────────────────────

  const inputCls = 'w-full border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary'
  const labelCls = 'block text-xs font-medium text-on-surface-variant mb-1'

  // Campos obrigatórios — ámbar quando vazios
  const warnCls = (val: string) => val.trim()
    ? inputCls
    : 'w-full border-2 border-amber-400 rounded-lg px-3 py-2 text-sm bg-amber-50 text-on-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-500'
  const warnLabelCls = (val: string) => val.trim()
    ? labelCls
    : 'block text-xs font-semibold text-amber-600 mb-1'

  const reps = usersList.filter(u => u.role === 'rep' || u.role === 'admin')

  if (isLoading || !order) return <PageSpinner />

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-surface-container-lowest">

      {/* Topbar */}
      <div className="sticky top-0 z-30 bg-white border-b border-outline-variant shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-2">
          <button onClick={() => navigate(`/orders/${id}`)}
            className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant shrink-0">
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-on-surface text-base leading-tight">
              {formatOrderNumber(order.order_number)}
            </h1>
            <p className="text-xs text-on-surface-variant truncate">{order.client_trade_name || order.client_name}</p>
          </div>
          {/* Visualizar */}
          <button onClick={() => window.open(`/orders/${id}/print`, '_blank')}
            title="Visualizar pedido (somente leitura)"
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant text-sm text-on-surface-variant hover:bg-surface-container shrink-0">
            <Eye size={15} /> Visualizar
          </button>
          {/* Imprimir */}
          <button onClick={() => window.open(`/orders/${id}/print`, '_blank')}
            title="Imprimir"
            className="hidden sm:flex p-2 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container shrink-0">
            <Printer size={15} />
          </button>
          {/* Cancelar */}
          <button onClick={() => navigate(`/orders/${id}`)}
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant text-sm text-on-surface-variant hover:bg-surface-container shrink-0">
            <X size={15} /> Cancelar
          </button>
          {/* Salvar */}
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 shrink-0">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
        {saveError && (
          <div className="max-w-7xl mx-auto px-4 pb-2">
            <div className="flex items-center gap-2 text-error text-sm bg-error/8 rounded-lg px-3 py-2">
              <AlertTriangle size={15} /> {saveError}
            </div>
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Informações do Pedido ── */}
        <div className="bg-white rounded-2xl border border-outline-variant shadow-sm p-5">
          <h2 className="font-semibold text-on-surface mb-4 text-sm uppercase tracking-wide text-on-surface-variant">
            Informações do Pedido
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

            {/* Cliente */}
            <div className="relative sm:col-span-2 lg:col-span-2">
              <label className={labelCls}>Cliente *</label>
              <input
                className={inputCls}
                value={form.client_display}
                onChange={e => handleClientSearch(e.target.value)}
                onFocus={() => form.client_display.length >= 2 && setShowClientDropdown(true)}
                onBlur={() => setTimeout(() => setShowClientDropdown(false), 150)}
                placeholder="Buscar cliente..."
              />
              {showClientDropdown && clientResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border border-outline-variant rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {clientResults.map(c => (
                    <button key={c.id} type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-surface-container"
                      onMouseDown={() => {
                        setForm(f => ({ ...f, client_id: c.id, client_display: c.trade_name || c.name }))
                        setShowClientDropdown(false)
                      }}>
                      <span className="font-medium">{c.trade_name || c.name}</span>
                      {c.city && <span className="text-on-surface-variant ml-2 text-xs">– {c.city}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Comprador */}
            <div>
              <label className={warnLabelCls(form.buyer_name)}>
                Comprador {!form.buyer_name.trim() && <span className="text-amber-500">⚠</span>}
              </label>
              <input className={warnCls(form.buyer_name)} value={form.buyer_name}
                onChange={e => setForm(f => ({ ...f, buyer_name: e.target.value }))}
                placeholder="Nome do comprador" />
            </div>

            {/* Transportadora */}
            <div>
              <label className={labelCls}>Transportadora</label>
              <input className={inputCls} value={form.transportadora}
                onChange={e => setForm(f => ({ ...f, transportadora: e.target.value }))}
                placeholder="Nome da transportadora" />
            </div>

            {/* Frete */}
            <div>
              <label className={labelCls}>Frete</label>
              <select className={inputCls} value={form.freight_type}
                onChange={e => setForm(f => ({ ...f, freight_type: e.target.value }))}>
                <option value="CIF">CIF (por conta do vendedor)</option>
                <option value="FOB">FOB (por conta do cliente)</option>
              </select>
            </div>

            {/* Previsão de Entrega */}
            <div>
              <label className={warnLabelCls(form.delivery_date)}>
                Previsão de Entrega {!form.delivery_date.trim() && <span className="text-amber-500">⚠</span>}
              </label>
              <input type="date" className={warnCls(form.delivery_date)} value={form.delivery_date}
                onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))} />
            </div>

            {/* Condição de Pagamento */}
            <div>
              <label className={warnLabelCls(form.payment_terms)}>
                Cond. Pagamento {!form.payment_terms.trim() && <span className="text-amber-500">⚠</span>}
              </label>
              <input className={warnCls(form.payment_terms)} value={form.payment_terms}
                onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))}
                placeholder="Ex: 30/60/90" />
            </div>

            {/* Vendedor (admin only) */}
            {isAdmin && (
              <div>
                <label className={labelCls}>Vendedor</label>
                <select className={inputCls} value={form.rep_id}
                  onChange={e => setForm(f => ({ ...f, rep_id: e.target.value }))}>
                  {reps.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}

            {/* Status */}
            <div>
              <label className={labelCls}>Status</label>
              <select className={inputCls} value={form.status_id}
                onChange={e => setForm(f => ({ ...f, status_id: e.target.value }))}>
                <option value="">– sem status –</option>
                {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            {/* Nr. Pedido Fábrica */}
            <div>
              <label className={labelCls}>Nº Pedido Fábrica</label>
              <input className={inputCls} value={form.industry_order_number}
                onChange={e => setForm(f => ({ ...f, industry_order_number: e.target.value }))}
                placeholder="Número na fábrica" />
            </div>

            {/* Desconto (admin only) */}
            {isAdmin && (
              <div>
                <label className={labelCls}>Desconto %</label>
                <input className={inputCls} value={form.discount_pct} inputMode="decimal"
                  onChange={e => setForm(f => ({ ...f, discount_pct: e.target.value }))}
                  placeholder="0,00" />
              </div>
            )}

            {/* Observações */}
            <div className="sm:col-span-2 lg:col-span-3">
              <label className={labelCls}>Observações</label>
              <textarea className={`${inputCls} resize-none h-20`} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Observações do pedido..." />
            </div>
          </div>
        </div>

        {/* ── Itens do Pedido ── */}
        <div className="bg-white rounded-2xl border border-outline-variant shadow-sm overflow-hidden">
          <div className="p-5 border-b border-outline-variant flex items-center justify-between gap-4">
            <h2 className="font-semibold text-on-surface text-sm uppercase tracking-wide text-on-surface-variant">
              Itens do Pedido
            </h2>
            {/* Busca de produto */}
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input
                className="w-full border border-outline-variant rounded-lg pl-8 pr-3 py-2 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                value={prodSearch}
                onChange={e => searchProducts(e.target.value)}
                onBlur={() => setTimeout(() => setShowProdDropdown(false), 150)}
                placeholder="Adicionar produto..."
              />
              {showProdDropdown && (
                <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border border-outline-variant rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {searching && <p className="px-3 py-2 text-sm text-on-surface-variant">Buscando...</p>}
                  {!searching && prodResults.length === 0 && (
                    <p className="px-3 py-2 text-sm text-on-surface-variant">Nenhum produto encontrado</p>
                  )}
                  {prodResults.map(p => (
                    <button key={p.id} type="button"
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-container text-left"
                      onMouseDown={() => addProduct(p)}>
                      {p.image_url
                        ? <img src={p.image_url} className="w-8 h-8 object-cover rounded shrink-0" />
                        : <div className="w-8 h-8 rounded bg-surface-container-low shrink-0" />}
                      <div className="min-w-0">
                        <p className="font-medium text-on-surface truncate">{p.reference}</p>
                        <p className="text-xs text-on-surface-variant truncate">{p.product_name}</p>
                      </div>
                      <span className="ml-auto text-xs font-medium text-primary shrink-0">{formatCurrency(p.base_price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tabela de itens — scrollável horizontalmente no desktop */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant text-xs">
                  <th className="px-4 py-2 text-left font-medium w-8">#</th>
                  <th className="px-2 py-2 text-left font-medium">Produto</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">R$ Tab.</th>
                  <th className="px-3 py-2 text-center font-medium">Quantidades / Grade</th>
                  <th className="px-3 py-2 text-right font-medium">Peças</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/50">

                {/* Itens existentes */}
                {items.map((it, idx) => !it.removed && (
                  <ItemRow
                    key={it.id}
                    index={idx + 1}
                    reference={it.reference}
                    productName={it.product_name}
                    imageUrl={it.image_url}
                    type={it.type}
                    unitPrice={it.unit_price}
                    gradeConfigs={it.grade_configs}
                    draftSizes={it.draftSizes}
                    draftBoxes={it.draftBoxes}
                    draftGrade={it.draftGrade}
                    onSizeChange={(size, val) => updateSize(it.id, size, val)}
                    onBoxesChange={val => updateBoxes(it.id, val)}
                    onGradeChange={(colorIdx, size, val) => updateGrade(it.id, colorIdx, size, val)}
                    onRemove={() => removeItem(it.id)}
                    priceTableName={order?.price_table_name}
                  />
                ))}

                {/* Novos itens */}
                {newItems.map((it, idx) => (
                  <ItemRow
                    key={it.tempId}
                    index={items.filter(i => !i.removed).length + idx + 1}
                    reference={it.reference}
                    productName={it.product_name}
                    imageUrl={it.image_url}
                    type={it.type}
                    unitPrice={it.unit_price}
                    gradeConfigs={it.grade_configs}
                    draftSizes={it.draftSizes}
                    draftBoxes={it.draftBoxes}
                    draftGrade={it.draftGrade}
                    onSizeChange={(size, val) => updateNewSize(it.tempId, size, val)}
                    onBoxesChange={val => updateNewBoxes(it.tempId, val)}
                    onGradeChange={(colorIdx, size, val) => updateNewGrade(it.tempId, colorIdx, size, val)}
                    onRemove={() => removeNewItem(it.tempId)}
                    isNew
                    priceTableName={order?.price_table_name}
                  />
                ))}

                {activeItems.length === 0 && newItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-on-surface-variant">
                      Nenhum item. Use a busca acima para adicionar produtos.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totais */}
          <div className="px-5 py-4 border-t border-outline-variant bg-surface-container-low flex items-center justify-end gap-8">
            <div className="text-sm text-on-surface-variant">
              <span className="font-medium text-on-surface">{allItems.length}</span> produto{allItems.length !== 1 ? 's' : ''}
            </div>
            <div className="text-sm text-on-surface-variant">
              <span className="font-medium text-on-surface">{totalPieces}</span> peças
            </div>
            <div className="text-base font-bold text-on-surface">
              {formatCurrency(totalValue)}
            </div>
          </div>
        </div>

        {/* Botões de ação no final (mobile-friendly) */}
        <div className="flex gap-3 pb-8">
          <button onClick={() => navigate(`/orders/${id}`)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-outline-variant text-sm text-on-surface-variant hover:bg-surface-container">
            <X size={16} /> Cancelar
          </button>
          <button onClick={() => window.open(`/orders/${id}/print`, '_blank')}
            className="hidden sm:flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-outline-variant text-sm text-on-surface-variant hover:bg-surface-container">
            <Eye size={16} /> Visualizar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-8 py-3 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-60">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Salvando...' : 'Salvar Pedido'}
          </button>
        </div>

      </div>
    </div>
  )
}

// ── ItemRow — linha de item na tabela ──────────────────────────────────────────

interface ItemRowProps {
  index: number
  reference: string
  productName: string | null
  imageUrl: string | null
  type: 'regular' | 'pack'
  unitPrice: number
  gradeConfigs: GradeConfig[] | null
  draftSizes: Record<string, number>
  draftBoxes: number
  draftGrade: DraftGradeEntry[]
  onSizeChange: (size: string, val: number) => void
  onBoxesChange: (val: number) => void
  onGradeChange: (colorIdx: number, size: string, val: number) => void
  onRemove: () => void
  isNew?: boolean
  priceTableName?: string | null
}

function ItemRow({
  index, reference, productName, imageUrl, type, unitPrice,
  gradeConfigs: _gradeConfigs, draftSizes, draftGrade,
  onSizeChange, onGradeChange, onRemove, isNew, priceTableName,
}: ItemRowProps) {
  const sizes = sortSizes(Object.keys(draftSizes))

  // Tamanhos únicos de toda a grade pack
  const gradeSizes = sortSizes(
    [...new Set((draftGrade || []).flatMap(gc => Object.keys(gc.sizes)))]
  )

  const pieces = type === 'regular'
    ? Object.values(draftSizes).reduce((s, v) => s + (v || 0), 0)
    : (draftGrade || []).reduce((s, gc) => s + gc.total_pieces, 0)

  const subtotal = unitPrice * pieces

  const inputNum = 'w-10 text-center border border-outline-variant rounded px-0.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary bg-white'

  return (
    <tr className={`align-top hover:bg-surface-container/40 transition-colors ${isNew ? 'bg-primary/3' : ''}`}>

      {/* # */}
      <td className="px-4 py-3 text-xs text-on-surface-variant">{index}</td>

      {/* Produto */}
      <td className="px-2 py-3">
        <div className="flex items-center gap-2 min-w-[180px]">
          {imageUrl
            ? <img src={imageUrl} alt="" className="w-10 h-10 object-cover rounded shrink-0" />
            : <div className="w-10 h-10 rounded bg-surface-container-low shrink-0" />}
          <div className="min-w-0">
            <p className="font-semibold text-on-surface text-sm">{reference}</p>
            {priceTableName && <p className="text-[10px] text-primary/70 font-medium leading-tight">{priceTableName}</p>}
            <p className="text-xs text-on-surface-variant truncate max-w-[160px]">{productName}</p>
            {isNew && <span className="text-xs text-primary font-medium">+ novo</span>}
          </div>
        </div>
      </td>

      {/* Preço tabela */}
      <td className="px-3 py-3 text-right text-sm text-on-surface-variant whitespace-nowrap align-middle">
        {formatCurrency(unitPrice)}
      </td>

      {/* Grade / Quantidades */}
      <td className="px-3 py-3">

        {/* Regular: uma linha de inputs por tamanho */}
        {type === 'regular' && sizes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  {sizes.map(s => (
                    <th key={s} className="w-10 text-center pb-1 text-on-surface-variant font-medium px-0.5">{s}</th>
                  ))}
                  <th className="pl-3 pb-1 text-center text-on-surface-variant font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  {sizes.map(size => (
                    <td key={size} className="px-0.5 py-0.5">
                      <input
                        type="number" min={0} max={999}
                        className={inputNum}
                        value={draftSizes[size] || 0}
                        onChange={e => onSizeChange(size, parseInt(e.target.value) || 0)}
                        onFocus={e => e.target.select()}
                      />
                    </td>
                  ))}
                  <td className="pl-3 py-0.5 text-center font-bold text-on-surface">
                    {pieces || '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Pack: tabela cor × tamanho */}
        {type === 'pack' && draftGrade.length > 0 && (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr>
                  <th className="text-left pr-3 pb-1 text-on-surface-variant font-medium whitespace-nowrap">Cor</th>
                  {gradeSizes.map(s => (
                    <th key={s} className="w-9 text-center pb-1 text-on-surface-variant font-medium">{s}</th>
                  ))}
                  <th className="pl-2 pb-1 text-center text-on-surface-variant font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {draftGrade.map((gc, colorIdx) => (
                  <tr key={colorIdx}>
                    <td className="pr-3 py-0.5 font-semibold text-on-surface whitespace-nowrap">{gc.color || '—'}</td>
                    {gradeSizes.map(size => (
                      <td key={size} className="px-0.5 py-0.5">
                        <input
                          type="number" min={0} max={999}
                          className={inputNum}
                          value={gc.sizes[size] || 0}
                          onChange={e => onGradeChange(colorIdx, size, parseInt(e.target.value) || 0)}
                          onFocus={e => e.target.select()}
                        />
                      </td>
                    ))}
                    <td className="pl-2 py-0.5 text-center font-bold text-on-surface">{gc.total_pieces}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-outline-variant/40">
                  <td className="pr-3 pt-1 text-xs text-outline font-medium">Total</td>
                  {gradeSizes.map(size => (
                    <td key={size} className="px-0.5 pt-1 text-center text-xs font-semibold text-on-surface-variant">
                      {draftGrade.reduce((s, gc) => s + (gc.sizes[size] || 0), 0) || ''}
                    </td>
                  ))}
                  <td className="pl-2 pt-1 text-center font-bold text-primary">{pieces}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {type === 'regular' && sizes.length === 0 && (
          <span className="text-xs text-on-surface-variant italic">sem grade</span>
        )}
      </td>

      {/* Total peças */}
      <td className="px-3 py-3 text-right align-middle">
        <span className="inline-block bg-surface-container text-on-surface font-semibold text-sm px-2 py-0.5 rounded-lg min-w-[40px] text-center">
          {pieces}
        </span>
      </td>

      {/* Total R$ */}
      <td className="px-3 py-3 text-right font-medium text-on-surface align-middle whitespace-nowrap text-sm">
        {formatCurrency(subtotal)}
      </td>

      {/* Remover */}
      <td className="px-2 py-3 align-middle">
        <button onClick={onRemove}
          className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors">
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  )
}
