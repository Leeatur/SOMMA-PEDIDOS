import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft, Save, X, Search, Trash2, AlertTriangle,
  Loader2, Eye, Printer, Check,
} from 'lucide-react'
import {
  ordersApi, clientsApi, usersApi, statusesApi, productsApi, priceTablesApi, paymentConditionsApi,
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
  blocked_sizes: string[] | null
  boxes_count: number
  unit_price: number
  original_unit_price: number | null   // preço original da tabela (antes de ajuste manual)
  total_pieces: number
  subtotal: number
  sizes: Record<string, number> | null
  grade_configs: GradeConfig[] | null
  custom_grade: DraftGradeEntry[] | null
  observation: string | null
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

interface ClientOption { id: string; name: string; trade_name: string | null; city: string | null; cnpj: string | null }
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

// ─── Rascunho automático da edição de pedido (auto-save / auto-recover) ──────
// Mesmo princípio do Novo Pedido: salva as edições não salvas no aparelho e
// recupera ao recarregar a página. Chaveado por usuário + id do pedido.
const ORDER_EDIT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

function orderEditDraftKey(userId?: string, orderId?: string) {
  return `somma_orderedit_draft_${userId || 'anon'}_${orderId || ''}`
}

function loadOrderEditDraft(userId?: string, orderId?: string): Record<string, any> | null {
  try {
    const raw = localStorage.getItem(orderEditDraftKey(userId, orderId))
    if (!raw) return null
    const draft = JSON.parse(raw)
    if (!draft || typeof draft !== 'object') return null
    if (draft.savedAt && Date.now() - draft.savedAt > ORDER_EDIT_DRAFT_TTL_MS) {
      localStorage.removeItem(orderEditDraftKey(userId, orderId))
      return null
    }
    return draft
  } catch {
    return null
  }
}

function saveOrderEditDraft(userId: string | undefined, orderId: string | undefined, draft: Record<string, unknown>) {
  try {
    localStorage.setItem(orderEditDraftKey(userId, orderId), JSON.stringify({ ...draft, savedAt: Date.now() }))
  } catch { /* ignora se o armazenamento estiver cheio */ }
}

function clearOrderEditDraft(userId?: string, orderId?: string) {
  try { localStorage.removeItem(orderEditDraftKey(userId, orderId)) } catch { /* noop */ }
}

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

  const { data: paymentConditions = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['payment-conditions'],
    queryFn: () => paymentConditionsApi.list().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })

  // Tabela de política (desconto × comissão) da tabela de preço do pedido
  const { data: priceTableDetail } = useQuery<{ discount_rules: Array<{ discount_pct: number; total_commission_pct: number; rep_commission_pct: number; office_commission_pct: number }> }>({
    queryKey: ['price-table-detail', order?.price_table_id],
    queryFn: () => priceTablesApi.get(order!.price_table_id).then(r => r.data),
    enabled: !!order?.price_table_id,
  })
  const discountRules = priceTableDetail?.discount_rules || []

  // (desconto picker removido temporariamente para debug)

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
    discount_pct: '',      // desconto à vista (cash) — NÃO afeta comissão
    notes: '',
  })
  // Desconto de política (prazo) — afeta comissão, selecionado no grid
  const [policyDiscountPct, setPolicyDiscountPct] = useState<number>(0)

  // Comissão manual — override dos valores calculados
  const [manualCommission, setManualCommission] = useState<{
    rep: string; repPct: string
    office: string; officePct: string
  } | null>(null)

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
  const [quickEditProduct, setQuickEditProduct] = useState<Product | null>(null)
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
  // Controle do rascunho automático: 'hydrated' vira true após a 1ª carga;
  // 'baseline' guarda o estado salvo p/ só persistir rascunho em edição real.
  const hydratedRef = useRef(false)
  const baselineRef = useRef<string>('')

  useEffect(() => {
    if (!order) return
    // Recupera rascunho de edição não salvo para ESTE pedido (se houver)
    const draft = loadOrderEditDraft(user?.id, id)
    if (draft) {
      setForm(draft.form)
      setPolicyDiscountPct(draft.policyDiscountPct ?? 0)
      setManualCommission(draft.manualCommission ?? null)
      setItems(draft.items ?? [])
      setNewItems(draft.newItems ?? [])
      baselineRef.current = JSON.stringify({
        form: draft.form,
        policyDiscountPct: draft.policyDiscountPct ?? 0,
        manualCommission: draft.manualCommission ?? null,
        items: draft.items ?? [],
        newItems: draft.newItems ?? [],
      })
      hydratedRef.current = true
      return
    }
    // Sem rascunho: popula a partir do pedido salvo no banco
    const baseForm = {
      client_id: order.client_id || '',
      client_display: order.client_name || order.client_trade_name || '',
      buyer_name: order.buyer_name || '',
      transportadora: order.transportadora || '',
      freight_type: order.freight_type || 'CIF',
      delivery_date: order.delivery_date ? order.delivery_date.split('T')[0] : '',
      payment_terms: order.payment_terms || '',
      rep_id: order.rep_id || '',
      status_id: order.status_id || '',
      industry_order_number: order.industry_order_number || '',
      // Desconto Comercial = desconto salvo no pedido (assume que era à vista, não de prazo)
      // Política de Prazo começa em 0 — admin seleciona no grid se quiser aplicar
      discount_pct: String(order.discount_pct ?? '0'),
      notes: order.notes || '',
    }
    // Política de Prazo começa em 0 (separado do Desconto Comercial)
    // Comissão manual inicializa com os valores atuais do pedido
    const baseComm = {
      rep:       String(Number(order.rep_commission_value    || 0).toFixed(2)).replace('.', ','),
      repPct:    String(Number(order.rep_commission_pct      || 0).toFixed(2)).replace('.', ','),
      office:    String(Number(order.office_commission_value || 0).toFixed(2)).replace('.', ','),
      officePct: String(Number(order.office_commission_pct   || 0).toFixed(2)).replace('.', ','),
    }
    const baseItems = (order.items || []).map((it: OrderItemRaw) => ({
      ...it,
      draftSizes: initSizes(it),
      draftBoxes: it.boxes_count || 1,
      draftGrade: initDraftGrade(it),
      removed: false,
    }))
    setForm(baseForm)
    setPolicyDiscountPct(0)
    setManualCommission(baseComm)
    setItems(baseItems)
    baselineRef.current = JSON.stringify({ form: baseForm, policyDiscountPct: 0, manualCommission: baseComm, items: baseItems, newItems: [] })
    hydratedRef.current = true
  }, [order, id, user?.id])

  // Auto-save: grava o rascunho das edições não salvas (debounce 400ms),
  // apenas quando o estado diverge do que está salvo no banco (baseline).
  useEffect(() => {
    if (!order || !hydratedRef.current) return
    const snapshot = JSON.stringify({ form, policyDiscountPct, manualCommission, items, newItems })
    if (snapshot === baselineRef.current) return
    const t = setTimeout(() => {
      saveOrderEditDraft(user?.id, id, { form, policyDiscountPct, manualCommission, items, newItems })
    }, 400)
    return () => clearTimeout(t)
  }, [order, id, user?.id, form, policyDiscountPct, manualCommission, items, newItems])

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

  const updateExistingPrice = (itemId: string, val: number) => {
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, unit_price: val } : it))
  }
  const updateNewPrice = (tempId: string, val: number) => {
    setNewItems(prev => prev.map(it => it.tempId === tempId ? { ...it, unit_price: val } : it))
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
    const existsActive = items.some(it => it.product_id === prod.id && !it.removed)
    const existsNew = newItems.some(it => it.product_id === prod.id)
    if (existsActive || existsNew) {
      setShowProdDropdown(false); setProdSearch(''); return
    }
    setShowProdDropdown(false); setProdSearch('')
    // Abre modal para preencher grade/tamanhos antes de adicionar
    setQuickEditProduct(prod)
  }

  const confirmAddProduct = (prod: Product, sizes: Record<string, number>, boxes: number) => {
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
      draftSizes: prod.type === 'regular' ? sizes : {},
      draftBoxes: boxes,
      draftGrade: prod.type === 'pack' ? initDraftGradeFromProduct(prod) : [],
    }
    setNewItems(prev => [...prev, newItem])
    setQuickEditProduct(null)
  }

  // ── totais calculados ────────────────────────────────────────────────────────

  const activeItems = items.filter(it => !it.removed)
  const allItems = [...activeItems, ...newItems]
  const totalPieces = allItems.reduce((s, it) => s + calcPieces(it), 0)
  const totalValue = allItems.reduce((s, it) => s + calcSubtotal(it), 0)

  // ── salvar ────────────────────────────────────────────────────────────────────

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // destination: para onde navegar ao salvar com sucesso
  // 'detail'  → /orders/:id  (padrão do botão "Salvar")
  // 'list'    → /orders      (botão "Salvar e Voltar")
  const handleSave = async (destination: 'detail' | 'list' = 'detail') => {
    if (!order) return
    setSaving(true)
    setSaveError('')
    try {
      // Desconto Comercial (cash) — só reduz preço do cliente, NÃO afeta comissão
      const cashDiscount = parseFloat(form.discount_pct.replace(',', '.')) || 0
      // Desconto de Política (prazo) — afeta comissão (selecionado no grid)
      const totalDiscount = policyDiscountPct + cashDiscount
      const oldTotalDiscount = Number(order.discount_pct) || 0

      // 1. Só recalcula via changePriceTable se o desconto realmente mudou
      // (evita resetar preços manuais desnecessariamente)
      if (isAdmin && Math.abs(totalDiscount - oldTotalDiscount) > 0.001) {
        // Passa commission_discount_pct separado = só o desconto de PRAZO para comissão
        await ordersApi.changePriceTable(id!, order.price_table_id, totalDiscount, policyDiscountPct)
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

      // 3. Comissão manual (se admin ajustou manualmente)
      if (isAdmin && manualCommission) {
        const repV    = parseFloat(manualCommission.rep.replace(',', '.'))    || 0
        const offV    = parseFloat(manualCommission.office.replace(',', '.')) || 0
        const repPct  = parseFloat(manualCommission.repPct.replace(',', '.'))
        const offPct  = parseFloat(manualCommission.officePct.replace(',', '.'))
        const origRep = Number(order.rep_commission_value    || 0)
        const origOff = Number(order.office_commission_value || 0)
        const origRepPct = Number(order.rep_commission_pct   || 0)
        const origOffPct = Number(order.office_commission_pct || 0)
        const changed = Math.abs(repV - origRep) > 0.01 || Math.abs(offV - origOff) > 0.01
                     || (!isNaN(repPct) && Math.abs(repPct - origRepPct) > 0.001)
                     || (!isNaN(offPct) && Math.abs(offPct - origOffPct) > 0.001)
        if (changed) {
          await ordersApi.updateCommission(id!, {
            rep_commission_value:    repV,
            office_commission_value: offV,
            rep_commission_pct:    !isNaN(repPct) ? repPct : undefined,
            office_commission_pct: !isNaN(offPct) ? offPct : undefined,
          })
        }
      }

      // 4. Status mudou
      if (form.status_id && form.status_id !== order.status_id) {
        await ordersApi.updateStatus(id!, form.status_id)
      }

      // 5. Remover itens marcados
      const removedIds = items.filter(it => it.removed).map(it => it.id)
      await Promise.all(removedIds.map(iid => ordersApi.removeItem(id!, iid)))

      // 6. Atualizar itens modificados (tamanhos, grade e preço unitário)
      for (const it of activeItems) {
        const origItem = order.items?.find((o: OrderItemRaw) => o.id === it.id)
        if (!origItem) continue

        const priceChanged = Math.abs(it.unit_price - Number(origItem.unit_price || 0)) > 0.001

        if (it.type === 'regular') {
          const sizesChanged = JSON.stringify(it.draftSizes) !== JSON.stringify(origItem.sizes || {})
          if (sizesChanged || priceChanged) {
            await ordersApi.updateItem(id!, it.id, {
              sizes: it.draftSizes,
              ...(priceChanged ? { unit_price: it.unit_price } : {}),
            })
          }
        } else {
          const origGrade = initDraftGrade(origItem)
          const gradeChanged = JSON.stringify(it.draftGrade) !== JSON.stringify(origGrade)
          if (gradeChanged || priceChanged) {
            await ordersApi.updateItem(id!, it.id, {
              custom_grade: it.draftGrade,
              ...(priceChanged ? { unit_price: it.unit_price } : {}),
            })
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

      // Edições salvas: descarta o rascunho deste pedido
      clearOrderEditDraft(user?.id, id)
      qc.invalidateQueries({ queryKey: ['order', id], refetchType: 'all' })
      qc.invalidateQueries({ queryKey: ['orders'], refetchType: 'all' })
      navigate(destination === 'list' ? '/orders' : `/orders/${id}`)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setSaveError(msg || 'Erro ao salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  // ── render helpers ────────────────────────────────────────────────────────────

  const inputCls = 'w-full border border-outline-variant rounded-lg px-3 py-1 text-[12px] bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary'
  const labelCls = 'block text-[12px] font-medium text-on-surface-variant mb-1'

  // Campos obrigatórios — ámbar quando vazios
  const warnCls = (val: string) => val.trim()
    ? inputCls
    : 'w-full border-2 border-amber-400 rounded-lg px-3 py-1 text-[12px] bg-amber-50 text-on-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-500'
  const warnLabelCls = (val: string) => val.trim()
    ? labelCls
    : 'block text-[12px] font-semibold text-amber-600 mb-1'

  const reps = usersList.filter(u => u.role === 'representante' || u.role === 'admin')

  if (isLoading || !order) return <PageSpinner />

  // ── render ────────────────────────────────────────────────────────────────────

  return (<>
    <div className="min-h-screen bg-surface-container-lowest">

      {/* Topbar */}
      <div className="sticky top-0 z-30 bg-white border-b border-outline-variant shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-2">
          <button onClick={() => navigate(`/orders/${id}`)}
            className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant shrink-0">
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-on-surface text-[12px] leading-tight">
              {formatOrderNumber(order.order_number)}
            </h1>
            <p className="text-[12px] text-on-surface-variant truncate">{order.client_name || order.client_trade_name}</p>
          </div>
          {/* Visualizar */}
          <button onClick={() => window.open(`/orders/${id}/print`, '_blank')}
            title="Visualizar pedido (somente leitura)"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-lg border border-outline-variant text-[12px] text-on-surface-variant hover:bg-surface-container shrink-0">
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
            className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-lg border border-outline-variant text-[12px] text-on-surface-variant hover:bg-surface-container shrink-0">
            <X size={15} /> Cancelar
          </button>
          {/* Salvar e Voltar */}
          <button onClick={() => handleSave('list')} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 disabled:opacity-60 shrink-0">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {saving ? 'Salvando...' : 'Salvar e Voltar'}
          </button>
          {/* Salvar (fica na tela) */}
          <button onClick={() => handleSave('detail')} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1 rounded-lg bg-primary text-white text-[12px] font-semibold hover:bg-primary/90 disabled:opacity-60 shrink-0">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {saving ? '...' : 'Salvar'}
          </button>
        </div>
        {saveError && (
          <div className="max-w-7xl mx-auto px-4 pb-2">
            <div className="flex items-center gap-2 text-error text-[12px] bg-error/8 rounded-lg px-3 py-1">
              <AlertTriangle size={15} /> {saveError}
            </div>
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Informações do Pedido ── */}
        <div className="bg-white rounded-2xl border border-outline-variant shadow-sm p-5">
          <h2 className="font-semibold text-on-surface mb-4 text-[12px] uppercase tracking-wide text-on-surface-variant">
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
                      className="w-full text-left px-3 py-2 text-[12px] hover:bg-surface-container border-b border-outline-variant/20 last:border-0"
                      onMouseDown={() => {
                        setForm(f => ({ ...f, client_id: c.id, client_display: c.name }))
                        setShowClientDropdown(false)
                      }}>
                      <p className="font-semibold text-on-surface">{c.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {c.cnpj && <span className="text-outline font-mono text-[11px]">{c.cnpj}</span>}
                        {c.city && <span className="text-outline text-[11px]">{c.city}</span>}
                      </div>
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
              <input
                list="payment-conditions-list-edit"
                className={warnCls(form.payment_terms)}
                value={form.payment_terms}
                onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))}
                placeholder="Selecione ou digite..."
              />
              {paymentConditions.length > 0 && (
                <datalist id="payment-conditions-list-edit">
                  {paymentConditions.map(c => <option key={c.id} value={c.name} />)}
                </datalist>
              )}
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

            {/* Desconto */}
            {isAdmin && (
              <div>
                <label className={labelCls}>Desconto Comercial %</label>
                <input className={inputCls} value={form.discount_pct} inputMode="decimal"
                  onChange={e => setForm(f => ({ ...f, discount_pct: e.target.value }))}
                  placeholder="0,00" />
              </div>
            )}

            {/* Tabela de Política de Prazo — SEPARADA do Desconto Comercial */}
            {isAdmin && discountRules.length > 0 && (
              <div className="sm:col-span-2 lg:col-span-3">
                <label className={labelCls}>
                  Política de Prazo — {order?.price_table_name}
                  <span className="ml-1 text-[10px] font-normal text-outline/60 normal-case tracking-normal">
                    (condições especiais a prazo — clique para selecionar)
                  </span>
                </label>
                <div className="overflow-x-auto border border-outline-variant/40 rounded-xl">
                  <table className="text-[12px] w-full min-w-[480px]">
                    <thead className="bg-surface-container-low border-b border-outline-variant/40">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-outline">Desconto de Prazo</th>
                        <th className="px-3 py-2 text-center font-semibold text-outline">Comissão Total</th>
                        <th className="px-3 py-2 text-center font-semibold text-emerald-700">Com. Representante</th>
                        <th className="px-3 py-2 text-center font-semibold text-blue-700">Com. Escritório</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/20">
                      {discountRules.map((r, i) => {
                        const isActive = Math.abs(Number(r.discount_pct) - policyDiscountPct) < 0.11
                        return (
                          <tr
                            key={i}
                            onClick={() => setPolicyDiscountPct(Number(r.discount_pct))}
                            className={`cursor-pointer transition-colors ${isActive
                              ? 'bg-primary/10 font-bold ring-1 ring-inset ring-primary/30'
                              : 'bg-white hover:bg-primary/5'
                            }`}
                          >
                            <td className="px-3 py-2.5">
                              {isActive && <span className="inline-block w-2 h-2 bg-primary rounded-full mr-2" />}
                              <span className={isActive ? 'text-primary' : ''}>{Number(r.discount_pct).toFixed(1)}%</span>
                              {isActive && <span className="ml-2 text-[10px] text-primary font-bold">← SELECIONADO</span>}
                            </td>
                            <td className="px-3 py-2.5 text-center">{Number(r.total_commission_pct).toFixed(1)}%</td>
                            <td className="px-3 py-2.5 text-center text-emerald-700 font-semibold">{Number(r.rep_commission_pct).toFixed(1)}%</td>
                            <td className="px-3 py-2.5 text-center text-blue-700 font-semibold">{Number(r.office_commission_pct).toFixed(1)}%</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-outline mt-1">
                  💡 Desconto de prazo afeta comissão. Desconto Comercial é separado e não afeta comissão.
                </p>
              </div>
            )}

            {/* Ajuste Manual de Comissão (admin only) */}
            {isAdmin && manualCommission && (
              <div className="sm:col-span-2 lg:col-span-3">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                  <label className="block text-[11px] font-bold text-amber-800 uppercase tracking-wide mb-1 flex items-center gap-2 flex-wrap">
                    🔧 Ajuste Manual de Comissão
                    <span className="text-[10px] font-bold bg-red-600 text-white px-1.5 py-0.5 rounded-full">ADMIN</span>
                    {order?.commission_manual_override && (
                      <span className="text-[10px] font-bold bg-orange-600 text-white px-1.5 py-0.5 rounded-full">⚠ OVERRIDE ATIVO</span>
                    )}
                    <span className="text-[10px] font-normal normal-case text-amber-600">
                      — sobrescreve o cálculo automático
                    </span>
                  </label>
                  {/* Grid 2 colunas: Rep | Escrit */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* ── Com. Representante ── */}
                    {([
                      { label: 'Com. Representante', color: 'emerald', pctKey: 'repPct', valKey: 'rep' },
                      { label: 'Com. Escritório',    color: 'blue',    pctKey: 'officePct', valKey: 'office' },
                    ] as const).map(({ label, color, pctKey, valKey }) => {
                      const totalVal = Number(order?.total_value || 0)
                      const inputCls = (c: string) =>
                        `w-full border border-amber-300 bg-white rounded-lg px-2 py-1.5 text-[12px] font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400 text-${c}-700`
                      return (
                        <div key={valKey}>
                          <label className="block text-[11px] font-semibold text-outline mb-1.5">{label}</label>
                          <div className="flex gap-2">
                            {/* Campo % */}
                            <div className="flex-1">
                              <p className="text-[10px] text-outline/60 mb-0.5">%</p>
                              <div className="relative">
                                <input
                                  className={inputCls(color) + ' pr-5'}
                                  value={manualCommission![pctKey]}
                                  inputMode="decimal"
                                  placeholder="0,00"
                                  onChange={e => {
                                    const txt = e.target.value
                                    const pct = parseFloat(txt.replace(',', '.'))
                                    const newVal = (!isNaN(pct) && totalVal > 0)
                                      ? (totalVal * pct / 100).toFixed(2).replace('.', ',')
                                      : manualCommission![valKey]
                                    setManualCommission(c => c ? { ...c, [pctKey]: txt, [valKey]: newVal } : c)
                                  }}
                                  onBlur={e => {
                                    const pct = parseFloat(e.target.value.replace(',', '.'))
                                    if (!isNaN(pct) && pct >= 0) {
                                      const newVal = totalVal > 0
                                        ? (totalVal * pct / 100).toFixed(2).replace('.', ',')
                                        : manualCommission![valKey]
                                      setManualCommission(c => c ? {
                                        ...c,
                                        [pctKey]: pct.toFixed(2).replace('.', ','),
                                        [valKey]: newVal,
                                      } : c)
                                    }
                                  }}
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-outline/50 pointer-events-none">%</span>
                              </div>
                            </div>
                            {/* Campo R$ */}
                            <div className="flex-1">
                              <p className="text-[10px] text-outline/60 mb-0.5">R$</p>
                              <div className="relative">
                                <input
                                  className={inputCls(color) + ' pl-6'}
                                  value={manualCommission![valKey]}
                                  inputMode="decimal"
                                  placeholder="0,00"
                                  onChange={e => {
                                    const txt = e.target.value
                                    const val = parseFloat(txt.replace(',', '.'))
                                    const newPct = (!isNaN(val) && totalVal > 0)
                                      ? (val / totalVal * 100).toFixed(2).replace('.', ',')
                                      : manualCommission![pctKey]
                                    setManualCommission(c => c ? { ...c, [valKey]: txt, [pctKey]: newPct } : c)
                                  }}
                                  onBlur={e => {
                                    const val = parseFloat(e.target.value.replace(',', '.'))
                                    if (!isNaN(val) && val >= 0) {
                                      const newPct = totalVal > 0
                                        ? (val / totalVal * 100).toFixed(2).replace('.', ',')
                                        : manualCommission![pctKey]
                                      setManualCommission(c => c ? {
                                        ...c,
                                        [valKey]: val.toFixed(2).replace('.', ','),
                                        [pctKey]: newPct,
                                      } : c)
                                    }
                                  }}
                                />
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-outline/50 pointer-events-none">R$</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <p className="text-[10px] text-amber-600">
                      Atual: Rep R$ {Number(order?.rep_commission_value||0).toLocaleString('pt-BR',{minimumFractionDigits:2})} ·
                      Escr. R$ {Number(order?.office_commission_value||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}
                      {order?.commission_manual_override && <span className="ml-1 font-bold text-orange-600">(ajuste manual)</span>}
                    </p>
                    {order?.commission_manual_override && (
                      <button
                        type="button"
                        className="text-[10px] text-red-600 underline hover:text-red-800"
                        onClick={async () => {
                          if (!confirm('Resetar comissão para o cálculo automático?')) return
                          await ordersApi.resetCommission(id!)
                          qc.invalidateQueries({ queryKey: ['order', id], refetchType: 'all' })
                          qc.invalidateQueries({ queryKey: ['orders'], refetchType: 'all' })
                        }}
                      >
                        Resetar para automático
                      </button>
                    )}
                  </div>
                </div>
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
            <h2 className="font-semibold text-on-surface text-[12px] uppercase tracking-wide text-on-surface-variant">
              Itens do Pedido
            </h2>
            {/* Busca de produto */}
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input
                className="w-full border border-outline-variant rounded-lg pl-8 pr-3 py-1 text-[12px] bg-surface focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                value={prodSearch}
                onChange={e => searchProducts(e.target.value)}
                onBlur={() => setTimeout(() => setShowProdDropdown(false), 150)}
                placeholder="Adicionar produto..."
              />
              {showProdDropdown && (
                <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border border-outline-variant rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {searching && <p className="px-3 py-1 text-[12px] text-on-surface-variant">Buscando...</p>}
                  {!searching && prodResults.length === 0 && (
                    <p className="px-3 py-1 text-[12px] text-on-surface-variant">Nenhum produto encontrado</p>
                  )}
                  {prodResults.map(p => (
                    <button key={p.id} type="button"
                      className="w-full flex items-center gap-2 px-3 py-1 text-[12px] hover:bg-surface-container text-left"
                      onMouseDown={() => addProduct(p)}>
                      {p.image_url
                        ? <img src={p.image_url} className="w-8 h-8 object-cover rounded shrink-0" />
                        : <div className="w-8 h-8 rounded bg-surface-container-low shrink-0" />}
                      <div className="min-w-0">
                        <p className="font-medium text-on-surface truncate">{p.reference}</p>
                        <p className="text-[12px] text-on-surface-variant truncate">{p.product_name}</p>
                      </div>
                      <span className="ml-auto text-[12px] font-medium text-primary shrink-0">{formatCurrency(p.base_price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tabela de itens — scrollável horizontalmente no desktop */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-[12px]">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant text-[12px]">
                  <th className="px-4 py-1 text-left font-medium w-8">#</th>
                  <th className="px-2 py-1 text-left font-medium">Produto</th>
                  <th className="px-3 py-1 text-right font-medium whitespace-nowrap text-outline/70">R$ Tabela</th>
                  <th className="px-3 py-1 text-right font-medium whitespace-nowrap">Preço Final <span className="text-[10px] text-primary/60 font-normal">(editável)</span></th>
                  <th className="px-3 py-1 text-center font-medium">Quantidades / Grade</th>
                  <th className="px-3 py-1 text-right font-medium">Peças</th>
                  <th className="px-3 py-1 text-right font-medium">Total</th>
                  <th className="px-2 py-1 w-8"></th>
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
                    originalUnitPrice={it.original_unit_price}
                    gradeConfigs={it.grade_configs}
                    draftSizes={it.draftSizes}
                    draftBoxes={it.draftBoxes}
                    draftGrade={it.draftGrade}
                    onSizeChange={(size, val) => updateSize(it.id, size, val)}
                    onBoxesChange={val => updateBoxes(it.id, val)}
                    onGradeChange={(colorIdx, size, val) => updateGrade(it.id, colorIdx, size, val)}
                    onPriceChange={val => updateExistingPrice(it.id, val)}
                    onRemove={() => removeItem(it.id)}
                    priceTableName={order?.price_table_name}
                    productObservation={it.observation}
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
                    originalUnitPrice={null}
                    gradeConfigs={it.grade_configs}
                    draftSizes={it.draftSizes}
                    draftBoxes={it.draftBoxes}
                    draftGrade={it.draftGrade}
                    onSizeChange={(size, val) => updateNewSize(it.tempId, size, val)}
                    onBoxesChange={val => updateNewBoxes(it.tempId, val)}
                    onGradeChange={(colorIdx, size, val) => updateNewGrade(it.tempId, colorIdx, size, val)}
                    onPriceChange={val => updateNewPrice(it.tempId, val)}
                    onRemove={() => removeNewItem(it.tempId)}
                    isNew
                    priceTableName={order?.price_table_name}
                  />
                ))}

                {activeItems.length === 0 && newItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-[12px] text-on-surface-variant">
                      Nenhum item. Use a busca acima para adicionar produtos.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totais */}
          <div className="px-5 py-2.5 border-t border-outline-variant bg-surface-container-low flex items-center justify-end gap-8">
            <div className="text-[12px] text-on-surface-variant">
              <span className="font-medium text-on-surface">{allItems.length}</span> produto{allItems.length !== 1 ? 's' : ''}
            </div>
            <div className="text-[12px] text-on-surface-variant">
              <span className="font-medium text-on-surface">{totalPieces}</span> peças
            </div>
            <div className="text-[12px] font-bold text-on-surface">
              {formatCurrency(totalValue)}
            </div>
          </div>
        </div>

        {/* Botões de ação no final (mobile-friendly) */}
        <div className="flex gap-3 pb-8">
          <button onClick={() => navigate(`/orders/${id}`)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2 rounded-xl border border-outline-variant text-[12px] text-on-surface-variant hover:bg-surface-container">
            <X size={16} /> Cancelar
          </button>
          <button onClick={() => window.open(`/orders/${id}/print`, '_blank')}
            className="hidden sm:flex items-center justify-center gap-2 px-5 py-2 rounded-xl border border-outline-variant text-[12px] text-on-surface-variant hover:bg-surface-container">
            <Eye size={16} /> Visualizar
          </button>
          <button onClick={() => handleSave('detail')} disabled={saving}
            className="sm:flex-none flex items-center justify-center gap-2 px-6 py-2 rounded-xl bg-primary text-white text-[12px] font-semibold hover:bg-primary/90 disabled:opacity-60">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? '...' : 'Salvar'}
          </button>
          <button onClick={() => handleSave('list')} disabled={saving}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2 rounded-xl bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 disabled:opacity-60">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Salvando...' : 'Salvar e Voltar'}
          </button>
        </div>

      </div>
    </div>

    {/* Modal de adição de produto */}
    {quickEditProduct && (
      <OrderEditQuickModal
        product={quickEditProduct}
        onClose={() => setQuickEditProduct(null)}
        onAdd={confirmAddProduct}
      />
    )}
    </>
  )
}

// ── OrderEditQuickModal ─────────────────────────────────────────────────────────
function OrderEditQuickModal({
  product, onClose, onAdd,
}: {
  product: Product
  onClose: () => void
  onAdd: (p: Product, sizes: Record<string,number>, boxes: number) => void
}) {
  const isPack = product.type === 'pack'
  const grades = product.grade_configs || []
  const SIZE_ORD = ['RN','PP','XP','P','M','G','GG','XG','EXG','2XG','3XG','4XG','34','36','38','40','42','44','46','48','50','52','54','56','58','60','U']
  const sort = (s: string[]) => [...s].sort((a,b)=>{const ai=SIZE_ORD.indexOf(a.trim().toUpperCase()),bi=SIZE_ORD.indexOf(b.trim().toUpperCase()); if(ai===-1&&bi===-1)return a.localeCompare(b); if(ai===-1)return 1; if(bi===-1)return -1; return ai-bi})
  const parseRange = (r: string) => { const m=r.match(/^(\d+)-(\d+)$/); if(m){const s=parseInt(m[1]),e=parseInt(m[2]),arr=[]; for(let i=s;i<=e;i+=2)arr.push(String(i)); return arr} return r.includes(',')?r.split(',').map(x=>x.trim()):[r] }

  const blockedNew = new Set((product.blocked_sizes || []).map(s => s.trim().toUpperCase()))
  const allSizes = (isPack ? [] : (() => { if(grades.length){const s=new Set<string>(); grades.forEach(g=>Object.keys(g.sizes).forEach(k=>s.add(k.trim()))); return sort([...s])} return sort(parseRange(product.size_range||'')) })()).filter(s => !blockedNew.has(s.trim().toUpperCase()))

  const [sizes, setSizes] = useState<Record<string,number>>(() => Object.fromEntries(allSizes.map(s=>[s,0])))
  const [boxes, setBoxes] = useState(1)

  const totalPiecesPerBox = grades.reduce((s,g)=>s+g.total_pieces,0)||0
  const totalPieces = isPack ? totalPiecesPerBox*boxes : Object.values(sizes).reduce((s,v)=>s+v,0)
  const totalValue = Number(product.base_price)*totalPieces
  const fmtR=(v:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v)
  const fmtN=(v:number)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2}).format(v)

  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()}
    window.addEventListener('keydown',h); return()=>window.removeEventListener('keydown',h)
  },[onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose}/>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="bg-surface-container-low px-4 py-3 border-b border-outline-variant flex items-start justify-between gap-3 flex-shrink-0">
          <div className="flex gap-3 flex-1 min-w-0">
            {product.image_url && <img src={product.image_url} alt={product.reference} className="w-16 h-16 object-cover rounded-xl flex-shrink-0"/>}
            <div className="min-w-0">
              <p className="font-bold text-on-surface">{product.reference}</p>
              {product.product_name && <p className="text-[12px] text-outline truncate">{product.product_name}</p>}
              <p className="font-bold text-primary">{fmtR(Number(product.base_price))}/pç</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-outline hover:bg-surface-container flex-shrink-0"><X className="h-5 w-5"/></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* PACK */}
          {isPack && grades.length > 0 && (()=>{
            const packSizes=sort([...new Set(grades.flatMap(g=>Object.keys(g.sizes).map(s=>s.trim())))])
            const grand=grades.reduce((s,g)=>s+g.total_pieces,0)
            return (
              <div>
                <p className="text-[11px] text-outline font-semibold uppercase tracking-wide mb-2">Grade do Pack</p>
                <div className="border border-outline-variant rounded-xl overflow-x-auto mb-3">
                  <table className="min-w-full text-[12px]">
                    <thead className="bg-surface-container-low">
                      <tr>
                        <th className="px-2 py-2 text-left font-bold text-outline border-r border-outline-variant/30">COR</th>
                        {packSizes.map(s=><th key={s} className="px-2 py-2 text-center font-bold text-outline border-r border-outline-variant/20 last:border-r-0">{s}</th>)}
                        <th className="px-2 py-2 text-center font-bold text-primary">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/20">
                      {grades.map((g,i)=>(
                        <tr key={i} className={i%2===0?'bg-white':'bg-surface-container-low/30'}>
                          <td className="px-2 py-1.5 font-semibold text-on-surface border-r border-outline-variant/30 whitespace-nowrap">{g.color||'—'}</td>
                          {packSizes.map(s=><td key={s} className="px-2 py-1.5 text-center text-on-surface-variant border-r border-outline-variant/20 last:border-r-0">{(g.sizes[s]||g.sizes[s+' ']||0)>0?(g.sizes[s]||g.sizes[s+' ']||0)*boxes:'—'}</td>)}
                          <td className="px-2 py-1.5 text-center font-bold text-primary">{g.total_pieces*boxes}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-outline-variant">
                      <tr className="bg-surface-container-low">
                        <td className="px-2 py-1.5 font-bold text-on-surface border-r border-outline-variant/30">QT. PACK</td>
                        {packSizes.map(s=><td key={s} className="px-2 py-1.5 text-center font-semibold border-r border-outline-variant/20 last:border-r-0">{grades.reduce((sum,g)=>sum+(g.sizes[s]||g.sizes[s+' ']||0)*boxes,0)||''}</td>)}
                        <td className="px-2 py-1.5 text-center font-bold text-primary">{grand*boxes}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-[12px] text-outline font-medium">Qtd. Caixas:</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={()=>setBoxes(Math.max(1,boxes-1))} className="w-9 h-9 rounded-xl border border-outline-variant flex items-center justify-center hover:bg-surface-container active:scale-95">
                      <span className="text-lg font-bold text-on-surface-variant leading-none">−</span>
                    </button>
                    <input type="number" min="1" value={boxes} onChange={e=>setBoxes(Math.max(1,parseInt(e.target.value)||1))}
                      className="w-16 text-center border-2 border-outline-variant rounded-xl py-1.5 text-[15px] font-bold focus:outline-none focus:border-primary"/>
                    <button type="button" onClick={()=>setBoxes(boxes+1)} className="w-9 h-9 rounded-xl border border-outline-variant flex items-center justify-center hover:bg-surface-container active:scale-95">
                      <span className="text-lg font-bold text-on-surface-variant leading-none">+</span>
                    </button>
                  </div>
                  <span className="text-[13px] font-bold text-primary">{grand*boxes} pç total</span>
                </div>
              </div>
            )
          })()}

          {/* REGULAR */}
          {!isPack && allSizes.length > 0 && (
            <div>
              <p className="text-[11px] text-outline font-semibold uppercase tracking-wide mb-2">Quantidades por tamanho</p>
              <div className="border border-outline-variant rounded-xl overflow-hidden">
                <table className="w-full" style={{tableLayout:'fixed'}}>
                  <thead className="bg-surface-container-low">
                    <tr>{allSizes.map(s=><th key={s} className="px-1 py-2 text-center text-[11px] font-bold text-outline border-r border-outline-variant/30 last:border-r-0">{s}</th>)}</tr>
                  </thead>
                  <tbody>
                    <tr>{allSizes.map((s,idx)=>(
                      <td key={s} className="border-r border-outline-variant/20 last:border-r-0 border-t border-outline-variant/20 p-0">
                        <input type="number" min="0" value={sizes[s]||''} placeholder="0" tabIndex={idx+1}
                          onChange={e=>setSizes(prev=>({...prev,[s]:Math.max(0,parseInt(e.target.value)||0)}))}
                          onFocus={e=>e.target.select()}
                          className="w-full text-center py-2.5 text-[13px] font-semibold text-on-surface focus:outline-none focus:bg-primary/5 bg-transparent"/>
                      </td>
                    ))}</tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Totais */}
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-[11px] text-outline mb-1">Preço Unit.</p><div className="px-3 py-2 bg-surface-container-low border border-outline-variant/50 rounded-lg text-[12px] font-semibold">{fmtN(Number(product.base_price))}</div></div>
            <div><p className="text-[11px] text-outline mb-1">Total</p><div className="px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg text-[12px] font-bold text-primary">{fmtN(totalValue)}</div></div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-outline-variant flex items-center justify-end gap-3 bg-surface-container-low flex-shrink-0">
          <button type="button" onClick={onClose} className="text-[12px] text-outline hover:text-on-surface px-4 py-2">Cancelar</button>
          <button type="button" disabled={totalPieces===0}
            onClick={()=>onAdd(product,sizes,boxes)}
            className="flex items-center gap-2 bg-primary text-white px-5 py-2 rounded-xl font-semibold text-[12px] disabled:opacity-50 hover:bg-primary/90 active:scale-95">
            <Check className="h-4 w-4"/> Adicionar
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
  originalUnitPrice: number | null   // preço original da tabela
  gradeConfigs: GradeConfig[] | null
  draftSizes: Record<string, number>
  draftBoxes: number
  draftGrade: DraftGradeEntry[]
  onSizeChange: (size: string, val: number) => void
  onBoxesChange: (val: number) => void
  onGradeChange: (colorIdx: number, size: string, val: number) => void
  onPriceChange?: (val: number) => void
  onRemove: () => void
  isNew?: boolean
  priceTableName?: string | null
  productObservation?: string | null
}

function ItemRow({
  index, reference, productName, imageUrl, type, unitPrice, originalUnitPrice,
  gradeConfigs: _gradeConfigs, draftSizes, draftGrade,
  onSizeChange, onGradeChange, onPriceChange, onRemove, isNew, priceTableName,
  productObservation,
}: ItemRowProps) {
  const sizes = sortSizes(Object.keys(draftSizes))

  // Estado local para o campo de preço
  const [priceText, setPriceText] = useState(Number(unitPrice).toFixed(2).replace('.', ','))
  const isEditingPrice = useRef(false)  // true enquanto o usuário está digitando

  // Sincroniza com unitPrice SOMENTE quando não está editando (vem de fora)
  useEffect(() => {
    if (!isEditingPrice.current) {
      setPriceText(Number(unitPrice).toFixed(2).replace('.', ','))
    }
  }, [unitPrice])

  // Tamanhos únicos de toda a grade pack
  const gradeSizes = sortSizes(
    [...new Set((draftGrade || []).flatMap(gc => Object.keys(gc.sizes)))]
  )

  const pieces = type === 'regular'
    ? Object.values(draftSizes).reduce((s, v) => s + (v || 0), 0)
    : (draftGrade || []).reduce((s, gc) => s + gc.total_pieces, 0)

  const subtotal = unitPrice * pieces

  const inputNum = 'w-10 text-center border border-outline-variant rounded px-0.5 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary bg-white'

  return (
    <tr className={`align-top hover:bg-surface-container/40 transition-colors ${isNew ? 'bg-primary/3' : ''}`}>

      {/* # */}
      <td className="px-4 py-2 text-[12px] text-on-surface-variant">{index}</td>

      {/* Produto */}
      <td className="px-2 py-2">
        <div className="flex items-center gap-2 min-w-[280px] max-w-[340px]">
          {imageUrl
            ? <img src={imageUrl} alt="" className="w-10 h-10 object-cover rounded shrink-0" />
            : <div className="w-10 h-10 rounded bg-surface-container-low shrink-0" />}
          <div className="min-w-0">
            <p className="font-semibold text-on-surface text-[12px]">{reference}</p>
            {priceTableName && <p className="text-[12px] text-primary/70 font-medium leading-tight">{priceTableName}</p>}
            <p className="text-[12px] text-on-surface-variant max-w-[260px]">{productName}</p>
            {productObservation && (
              <p className="text-[11px] font-bold text-red-600 uppercase mt-0.5 flex items-center gap-1">
                <span>⚠️</span>{productObservation}
              </p>
            )}
            {isNew && <span className="text-[12px] text-primary font-medium">+ novo</span>}
          </div>
        </div>
      </td>

      {/* R$ Tabela — preço original (somente leitura) */}
      <td className="px-3 py-2 text-right text-[12px] align-middle whitespace-nowrap text-outline/70">
        {originalUnitPrice != null && originalUnitPrice !== unitPrice
          ? <span className="line-through text-outline/50">{Number(originalUnitPrice).toFixed(2).replace('.', ',')}</span>
          : originalUnitPrice != null
            ? Number(originalUnitPrice).toFixed(2).replace('.', ',')
            : <span className="text-outline/30">—</span>
        }
      </td>

      {/* Preço Final — editável */}
      <td className="px-3 py-2 text-right text-[12px] align-middle whitespace-nowrap">
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-0.5">
            <span className="text-outline/60 text-[11px]">R$</span>
            <input
              type="text" inputMode="decimal"
              value={priceText}
              onChange={e => {
                const newText = e.target.value
                isEditingPrice.current = true
                setPriceText(newText)
                // Atualiza o estado pai IMEDIATAMENTE para garantir que
                // handleSave() leia o valor correto mesmo sem blur prévio
                const v = parseFloat(newText.replace(',', '.'))
                if (!isNaN(v) && v > 0) onPriceChange?.(v)
              }}
              onBlur={e => {
                isEditingPrice.current = false
                const raw = e.target.value.replace(',', '.')
                const v = parseFloat(raw)
                if (!isNaN(v) && v > 0) {
                  const formatted = v.toFixed(2).replace('.', ',')
                  setPriceText(formatted)
                  onPriceChange?.(v)  // garante formato final correto no pai
                } else {
                  setPriceText(Number(unitPrice).toFixed(2).replace('.', ','))
                }
              }}
              onFocus={e => {
                isEditingPrice.current = true  // marca que está editando
                e.target.select()
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                }
              }}
              className={`w-24 text-right text-[12px] font-semibold border rounded-lg px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                Math.abs(parseFloat(priceText.replace(',','.')) - unitPrice) > 0.01
                  ? 'border-amber-400 text-amber-700 bg-amber-50 focus:border-amber-500'
                  : 'border-outline-variant/50 text-primary bg-white focus:border-primary'
              }`}
              title="Clique para editar o preço unitário"
            />
          </div>
          {Math.abs(parseFloat(priceText.replace(',','.')) - unitPrice) > 0.01 && (
            <span className="text-[10px] text-amber-600 font-semibold">✏️ alterado</span>
          )}
        </div>
      </td>

      {/* Grade / Quantidades */}
      <td className="px-3 py-2">

        {/* Regular: uma linha de inputs por tamanho */}
        {type === 'regular' && sizes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="text-[12px] border-collapse">
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
                  {sizes.map((size, sIdx) => (
                    <td key={size} className="px-0.5 py-0.5">
                      <input
                        type="number" min={0} max={999}
                        className={inputNum}
                        value={draftSizes[size] || 0}
                        onChange={e => onSizeChange(size, parseInt(e.target.value) || 0)}
                        onFocus={e => e.target.select()}
                        autoFocus={sIdx === 0}
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
            <table className="text-[12px] border-collapse w-full">
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
                  <td className="pr-3 pt-1 text-[12px] text-outline font-medium">Total</td>
                  {gradeSizes.map(size => (
                    <td key={size} className="px-0.5 pt-1 text-center text-[12px] font-semibold text-on-surface-variant">
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
          <span className="text-[12px] text-on-surface-variant italic">sem grade</span>
        )}
      </td>

      {/* Total peças */}
      <td className="px-3 py-2 text-right align-middle">
        <span className="inline-block bg-surface-container text-on-surface font-semibold text-[12px] px-2 py-0.5 rounded-lg min-w-[40px] text-center">
          {pieces}
        </span>
      </td>

      {/* Total R$ */}
      <td className="px-3 py-2 text-right font-medium text-on-surface align-middle whitespace-nowrap text-[12px]">
        {formatCurrency(subtotal)}
      </td>

      {/* Remover */}
      <td className="px-2 py-2 align-middle">
        <button onClick={onRemove}
          className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors">
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  )
}
