import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users,
  Tags,
  Package,
  ClipboardList,
  ChevronRight,
  ChevronLeft,
  Search,
  Plus,
  Minus,
  Trash2,
  Image as ImageIcon,
  Check,
  Pencil,
  WifiOff,
  AlertCircle,
  Info,
  X,
} from 'lucide-react'
import { clientsApi, priceTablesApi, productsApi, ordersApi, factoriesApi, paymentConditionsApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { db } from '../db/db'
import { Button } from '../components/ui/Button'
import { Input, MaskedInput, Textarea, Select } from '../components/ui/Input'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import { NewClientModal, CreatedClient } from '../components/ui/NewClientModal'
import { useVoiceInput, parseReferenceFromSpeech, parseGradeFromSpeech } from '../hooks/useVoiceInput'
import { formatCurrency, formatPct } from '../utils/format'
import { maskPercent, parseDecimal } from '../utils/masks'
import { ProductPhotos } from '../components/ui/ProductPhotos'

// ─── Helpers de ordenação de tamanhos ───────────────────────────────────────
const SIZE_ORDER = [
  'RN','PP','XP','P','M','G','GG','XG','EXG','XGG','2XG','3XG','4XG',
  '34','36','38','40','42','44','46','48','50','52','54','56','58','60',
  '1','2','4','6','8','10','12','14','16','18','U',
]

function sortSizes(sizes: string[]) {
  const isNum = (s: string) => /^\d+$/.test(s.trim())
  return [...sizes].sort((a, b) => {
    // Tamanhos numéricos (08, 10, 70, 100…) sempre em ordem crescente numérica
    if (isNum(a) && isNum(b)) return parseInt(a, 10) - parseInt(b, 10)
    const ai = SIZE_ORDER.indexOf(a.toUpperCase())
    const bi = SIZE_ORDER.indexOf(b.toUpperCase())
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

// Distribuidora: o desconto vem da Condição de Pagamento (ex.: "PIX - 5% desconto")
// e as seções manuais de desconto são removidas. Ativa explicitamente
// (VITE_PAYMENT_DRIVEN_DISCOUNT=true) OU herda o modo distribuidora
// (VITE_SINGLE_COMMISSION=true), salvo se desligado de propósito (=false).
const PAYMENT_DRIVEN_DISCOUNT =
  import.meta.env.VITE_PAYMENT_DRIVEN_DISCOUNT === 'true' ||
  (import.meta.env.VITE_PAYMENT_DRIVEN_DISCOUNT !== 'false' && import.meta.env.VITE_SINGLE_COMMISSION === 'true')
function parsePaymentDiscount(name: string): number {
  const m = (name || '').match(/(\d+(?:[.,]\d+)?)\s*%/)
  return m ? parseFloat(m[1].replace(',', '.')) : 0
}

function parseSizeRange(sr: string | null | undefined): string[] {
  if (!sr) return []
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

function initSizes(product: Product): Record<string, number> {
  // 1. Tentar extrair tamanhos do grade_configs (com proteção contra sizes nulo)
  if (product.grade_configs && product.grade_configs.length > 0) {
    const allSizes = new Set<string>()
    product.grade_configs.forEach(gc => {
      if (gc.sizes) Object.keys(gc.sizes).forEach(s => allSizes.add(s))
    })
    if (allSizes.size > 0) {
      return Object.fromEntries(sortSizes([...allSizes]).map(s => [s, 0]))
    }
  }
  // 2. Fallback: parsear size_range
  const fromRange = parseSizeRange(product.size_range)
  if (fromRange.length > 0) {
    return Object.fromEntries(sortSizes(fromRange).map(s => [s, 0]))
  }
  return {}
}

// ─── Interfaces ──────────────────────────────────────────────────────────────
interface Client {
  id: string
  name: string
  trade_name: string | null
  city: string | null
  state: string | null
  cnpj: string | null
  phone: string | null
  buyer_name: string | null
}

interface PriceTable {
  id: string
  name: string
  factory_id: string
  factory_name: string
  collection: string | null
  season: string | null
  year: number | null
  discount_rules?: DiscountRule[]
  is_pe?: boolean
  max_cash_discount_pct?: number | null
}

interface DiscountRule {
  id: string
  discount_pct: number
  total_commission_pct: number
  rep_commission_pct: number
  office_commission_pct: number
  guide_commission_pct?: number
}

// Modo fábrica (NXO): comissão de 3 vias — Loja (rep) + Escritório (office) + Guia (guide). Default off.
const FACTORY_COMM = import.meta.env.VITE_FACTORY_COMMISSION === 'true'

// Pack multi-grade (NXO): cada linha de grade_configs vira uma grade selecionável com
// multiplicador próprio; o cliente pode misturar grades. Default off (pack soma tudo × caixas).
const MULTI_GRADE = import.meta.env.VITE_MULTI_GRADE === 'true'

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
  base_price: number
  image_url: string | null
  images?: (string | null)[] | null
  size_range: string | null
  grade_configs: GradeConfig[] | null
  active: boolean
  blocked_sizes: string[]
  observation: string | null
  stock?: Record<string, Record<string, number>> | null
}

interface CustomGradeEntry {
  color: string
  sizes: Record<string, number>
  total_pieces: number
}

interface CartItem {
  product: Product
  boxes_count: number          // usado para packs
  sizes: Record<string, number> // usado para produtos regulares (achatado por tamanho)
  custom_grade?: CustomGradeEntry[] // regulares com variantes cor × tamanho (detalhe por cor)
  unit_price: number
  observation?: string         // observação por item
}

const STEPS = [
  { label: 'Cliente', icon: <Users className="h-4 w-4" /> },
  { label: 'Tabela', icon: <Tags className="h-4 w-4" /> },
  { label: 'Produtos', icon: <Package className="h-4 w-4" /> },
  { label: 'Revisão', icon: <ClipboardList className="h-4 w-4" /> },
]

// ─── Componente: grade de tamanhos para PACKS (preview) ─────────────────────
function GradePreview({ configs, boxCount }: { configs: GradeConfig[]; boxCount: number }) {
  return (
    <div className="space-y-1.5 mt-2">
      {configs.map((gc, i) => {
        const sizes = sortSizes(Object.keys(gc.sizes))
        return (
          <div key={i}>
            {gc.color && <p className="text-[12px] font-medium text-on-surface-variant">{gc.color}</p>}
            <div className="overflow-x-auto scrollbar-hide">
              <table className="min-w-max text-[12px] border border-outline-variant rounded-lg overflow-hidden">
                <thead className="bg-surface-container-low sticky top-0 z-10">
                  <tr>
                    {sizes.map((s) => (
                      <th key={s} className="px-2 py-1 text-on-surface-variant text-center font-medium min-w-[28px]">{s}</th>
                    ))}
                    <th className="px-2 py-1 text-outline border-l border-outline-variant text-center">Total/cx</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-white">
                    {sizes.map((s) => (
                      <td key={s} className="px-2 py-1 text-center">{gc.sizes[s] * boxCount}</td>
                    ))}
                    <td className="px-2 py-1 text-center font-bold border-l border-outline-variant">{gc.total_pieces * boxCount}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Componente: grid de entrada de quantidades por tamanho (produtos regulares) ─
function SizeGrid({
  sizes,
  onChange,
  onRemove,
  blockedSizes = [],
}: {
  sizes: Record<string, number>
  onChange: (size: string, value: number) => void
  onRemove: () => void
  blockedSizes?: string[]
}) {
  const sizeKeys = sortSizes(Object.keys(sizes))
  const blocked = new Set(blockedSizes.map(s => s.toUpperCase()))
  const total = Object.values(sizes).reduce((s, v) => s + (v || 0), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-medium text-on-surface-variant">Qtd por tamanho:</span>
        <button
          onClick={onRemove}
          className="text-red-400 hover:text-red-600 flex items-center gap-1 text-[12px]"
        >
          <Trash2 className="h-3 w-3" /> Remover
        </button>
      </div>
      {blockedSizes.length > 0 && (
        <p className="text-[11px] text-amber-600 mb-1.5">
          🚫 Tamanhos bloqueados: {blockedSizes.join(', ')}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="text-[12px] size-grid-table">
          <thead className="bg-surface-container-lowest sticky top-0 z-10">
            <tr>
              {sizeKeys.map(s => (
                <th key={s} className={`px-1 pb-0.5 text-center font-medium min-w-[36px] ${blocked.has(s.toUpperCase()) ? 'text-red-300 line-through' : 'text-outline'}`}>{s}</th>
              ))}
              <th className="px-1 pb-0.5 text-center text-primary font-bold pl-2">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {sizeKeys.map((s, idx) => {
                const isBlocked = blocked.has(s.toUpperCase())
                return (
                <td key={s} className="px-0.5">
                  {isBlocked ? (
                    <div className="w-9 h-7 flex items-center justify-center bg-red-50 border border-red-200 rounded text-[11px] text-red-300 font-bold cursor-not-allowed" title={`Tamanho ${s} bloqueado`}>
                      🚫
                    </div>
                  ) : (
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={sizes[s] === 0 ? '' : sizes[s]}
                    placeholder="0"
                    onChange={e => onChange(s, parseInt(e.target.value) || 0)}
                    onFocus={e => e.target.select()}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                        if (e.key === 'Enter') e.preventDefault()
                        const table = e.currentTarget.closest('table')
                        if (!table) return
                        const inputs = Array.from(table.querySelectorAll<HTMLInputElement>('input[type="number"]'))
                        const next = inputs[idx + 1]
                        if (next) { e.preventDefault(); next.focus() }
                      }
                    }}
                    className="w-9 h-7 text-center border border-outline-variant rounded text-[12px] font-bold focus:outline-none focus:ring-1 focus:ring-primary focus:border-indigo-400 bg-white"
                  />
                  )}
                </td>
                )
              })}
              <td className="px-1 pl-2 text-center font-bold text-primary text-[12px]">{total}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Componente: exibição (somente leitura) das quantidades por tamanho ──────
function SizeDisplay({ sizes }: { sizes: Record<string, number> }) {
  const sizeKeys = sortSizes(Object.keys(sizes).filter(s => (sizes[s] || 0) > 0))
  const total = Object.values(sizes).reduce((s, v) => s + (v || 0), 0)
  if (sizeKeys.length === 0) return <p className="text-[12px] text-outline/70 italic">Nenhum tamanho preenchido</p>

  return (
    <div className="overflow-x-auto scrollbar-hide">
      <table className="min-w-max text-[12px] border border-outline-variant rounded-lg overflow-hidden">
        <thead className="bg-surface-container-low sticky top-0 z-10">
          <tr>
            {sizeKeys.map(s => (
              <th key={s} className="px-2 py-1 text-center text-on-surface-variant font-medium min-w-[28px]">{s}</th>
            ))}
            <th className="px-2 py-1 text-center text-outline border-l border-outline-variant font-bold">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-white">
            {sizeKeys.map(s => (
              <td key={s} className="px-2 py-1 text-center">{sizes[s]}</td>
            ))}
            <td className="px-2 py-1 text-center font-bold border-l border-outline-variant text-primary">{total}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ─── Rascunho automático do pedido (auto-save / auto-recover) ────────────────
// Salva o pedido em andamento no aparelho a cada alteração e recupera
// automaticamente se a página recarregar (ex.: pull-to-refresh no celular),
// evitando que o vendedor perca o pedido que ainda não foi finalizado.
const ORDER_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // descarta rascunhos com +7 dias

function orderDraftKey(userId?: string) {
  return `somma_neworder_draft_${userId || 'anon'}`
}

function loadOrderDraft(userId?: string): Record<string, any> | null {
  try {
    const raw = localStorage.getItem(orderDraftKey(userId))
    if (!raw) return null
    const draft = JSON.parse(raw)
    if (!draft || typeof draft !== 'object') return null
    if (draft.savedAt && Date.now() - draft.savedAt > ORDER_DRAFT_TTL_MS) {
      localStorage.removeItem(orderDraftKey(userId))
      return null
    }
    return draft
  } catch {
    return null
  }
}

function saveOrderDraft(userId: string | undefined, draft: Record<string, unknown>) {
  try {
    localStorage.setItem(orderDraftKey(userId), JSON.stringify({ ...draft, savedAt: Date.now() }))
  } catch { /* ignora se o armazenamento estiver cheio */ }
}

function clearOrderDraft(userId?: string) {
  try { localStorage.removeItem(orderDraftKey(userId)) } catch { /* noop */ }
}

// ─── Página principal ────────────────────────────────────────────────────────
export function NewOrder() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  // Recupera o rascunho salvo (se houver) uma única vez, no primeiro render
  const d = useRef(loadOrderDraft(user?.id)).current
  const [step, setStep] = useState<number>(() => d?.step ?? 0)

  // Step 1: Client
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(() => d?.selectedClient ?? null)
  const [showNewClient, setShowNewClient] = useState(false)

  // Step 2: Price table
  const [selectedFactory, setSelectedFactory] = useState<string>(() => d?.selectedFactory ?? '')
  const [selectedTable, setSelectedTable] = useState<PriceTable | null>(() => d?.selectedTable ?? null)

  // Step 3: Products
  const [productSearch, setProductSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [cart, setCart] = useState<CartItem[]>(() => d?.cart ?? [])
  const [expandedGrade, setExpandedGrade] = useState<string | null>(null)
  const [quickAddProduct, setQuickAddProduct] = useState<Product | null>(null)
  // Referência ao campo de busca: usada para devolver o foco automaticamente
  // (reabrir "card" de busca pronto para a próxima referência) após cada item confirmado
  // ── Voz: busca de referência ─────────────────────────────────────────────────
  const voicePendingRef = useRef(false)
  const voiceRef = useVoiceInput({
    onResult: (text) => {
      const ref = parseReferenceFromSpeech(text)
      setProductSearch(ref)
      voicePendingRef.current = true // sinaliza que voz está esperando produtos
    },
  })

  const productSearchRef = useRef<HTMLInputElement | null>(null)
  const focusProductSearch = useCallback(() => {
    // IMPORTANTE: no iOS/Safari (incl. PWA instalado), o teclado só aparece se o
    // .focus() acontecer de forma SÍNCRONA dentro do gesto do usuário (clique/tecla).
    // Qualquer setTimeout/Promise quebra essa cadeia e o campo foca "silenciosamente"
    // sem abrir o teclado — por isso chamamos direto, sem atraso. O input do card de
    // busca já fica montado por trás do modal (não desmonta ao abrir/fechar).
    productSearchRef.current?.focus()
  }, [])

  // Mede a altura do header fixo para "grudar" o card de busca logo abaixo dele,
  // mantendo-o sempre visível mesmo com a lista de produtos rolada
  const headerRef = useRef<HTMLDivElement | null>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const update = () => setHeaderHeight(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Step 4: Review
  const [discountPct, setDiscountPct] = useState<string>(() => d?.discountPct ?? '0')
  const [customDiscount, setCustomDiscount] = useState<boolean>(() => d?.customDiscount ?? false)
  const [cashDiscountPct, setCashDiscountPct] = useState<string>(() => d?.cashDiscountPct ?? '0') // desconto à vista
  const [notes, setNotes] = useState<string>(() => d?.notes ?? '')
  const [paymentTerms, setPaymentTerms] = useState<string>(() => d?.paymentTerms ?? '')
  const [freightType, setFreightType] = useState<string>(() => d?.freightType ?? 'CIF')
  const [deliveryDate, setDeliveryDate] = useState<string>(() => d?.deliveryDate ?? '')
  const [buyerName, setBuyerName] = useState<string>(() => d?.buyerName ?? '')
  const [industryOrderNumber, setIndustryOrderNumber] = useState<string>(() => d?.industryOrderNumber ?? '')

  // Auto-save: grava o rascunho do pedido a cada alteração (debounce 400ms).
  // Só salva quando há conteúdo de verdade; senão limpa o rascunho.
  useEffect(() => {
    const hasContent = !!(selectedClient || cart.length || selectedTable ||
      notes || paymentTerms || buyerName || deliveryDate || industryOrderNumber)
    if (!hasContent) { clearOrderDraft(user?.id); return }
    const t = setTimeout(() => {
      saveOrderDraft(user?.id, {
        step, selectedClient, selectedFactory, selectedTable, cart,
        discountPct, customDiscount, cashDiscountPct, notes, paymentTerms,
        freightType, deliveryDate, buyerName, industryOrderNumber,
      })
    }, 400)
    return () => clearTimeout(t)
  }, [user?.id, step, selectedClient, selectedFactory, selectedTable, cart,
      discountPct, customDiscount, cashDiscountPct, notes, paymentTerms,
      freightType, deliveryDate, buyerName, industryOrderNumber])

  const online = navigator.onLine

  // ── Atalhos de teclado globais: ESC volta, Enter avança ──────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Não interfere se estiver em modal aberto
      if (showNewClient) return
      // Não interfere em textarea
      if (e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'Escape') {
        e.preventDefault()
        if (step === 0) {
          navigate('/orders')
        } else if (step === 2 && cart.length > 0) {
          if (window.confirm(`Você tem ${cart.length} item(ns) no carrinho.\nVoltar irá esvaziar o carrinho.\n\nDeseja continuar?`)) {
            setCart([])
            setStep(1)
          }
        } else {
          setStep(s => Math.max(0, s - 1))
        }
      }

      // Enter no Step 0: seleciona o primeiro cliente da lista
      if (e.key === 'Enter' && step === 0 && !selectedClient) {
        const first = (document.querySelector('[data-client-card]') as HTMLElement)
        if (first) first.click()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [step, showNewClient, selectedClient, cart, navigate])

  // Debounce da busca de clientes (300ms)
  const [debouncedClientSearch, setDebouncedClientSearch] = useState(clientSearch)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedClientSearch(clientSearch), 300)
    return () => clearTimeout(t)
  }, [clientSearch])

  // Queries
  const { data: clients, isLoading: loadingClients } = useQuery<Client[]>({
    queryKey: ['clients', debouncedClientSearch],
    queryFn: () => clientsApi.list(debouncedClientSearch || undefined).then((r) => r.data),
    enabled: step === 0,
  })

  const { data: factories } = useQuery({
    queryKey: ['factories'],
    queryFn: () => factoriesApi.list().then((r) => r.data),
    enabled: step === 1,
  })

  const { data: priceTables, isLoading: loadingTables } = useQuery<PriceTable[]>({
    queryKey: ['price-tables', selectedFactory],
    queryFn: () => priceTablesApi.list(selectedFactory || undefined).then((r) => r.data),
    enabled: step === 1,
  })

  const { data: tableDetail } = useQuery<PriceTable>({
    queryKey: ['price-table-detail', selectedTable?.id],
    queryFn: () => priceTablesApi.get(selectedTable!.id).then((r) => r.data),
    enabled: !!selectedTable?.id && step >= 3,
  })

  const { data: paymentConditions = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['payment-conditions'],
    queryFn: () => paymentConditionsApi.list().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const { data: products, isLoading: loadingProducts } = useQuery<Product[]>({
    queryKey: ['products', selectedTable?.id, productSearch, typeFilter],
    queryFn: () =>
      productsApi.list({
        price_table_id: selectedTable?.id,
        search: productSearch || undefined,
        type: typeFilter || undefined,
      }).then((r) => r.data),
    enabled: step === 2 && !!selectedTable?.id,
  })

  // Auto-seleciona primeiro produto quando voz reconheceu uma referência
  useEffect(() => {
    if (voicePendingRef.current && products && products.length > 0) {
      voicePendingRef.current = false
      setQuickAddProduct(products[0])
      setProductSearch('')
    }
  }, [products])

  // Calculations
  const discountNum = parseDecimal(discountPct) || 0
  const cashDiscountNum = parseDecimal(cashDiscountPct) || 0
  const effectiveDiscountNum = discountNum + cashDiscountNum   // total = tabela + à vista
  const discountRules = tableDetail?.discount_rules || []

  const findMatchingRule = useCallback((discount: number): DiscountRule | null => {
    if (!discountRules.length) return null
    return discountRules.reduce((closest, rule) => {
      if (!closest) return rule
      const d1 = Math.abs(rule.discount_pct - discount)
      const d2 = Math.abs(closest.discount_pct - discount)
      return d1 < d2 ? rule : closest
    }, null as DiscountRule | null)
  }, [discountRules])

  const cartTotals = useCallback(() => {
    let totalPieces = 0
    let grossValue = 0
    for (const item of cart) {
      let itemPieces: number
      if (item.product.type === 'regular') {
        itemPieces = Object.values(item.sizes).reduce((s, v) => s + (v || 0), 0)
      } else {
        const piecesPerBox = item.product.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 1
        itemPieces = item.boxes_count * piecesPerBox
      }
      totalPieces += itemPieces
      grossValue += item.unit_price * itemPieces
    }
    // Desconto à vista NÃO mexe na comissão — comissão é sobre o desconto da tabela.
    // Exceção (distribuidora): comissão sobre o valor LÍQUIDO (total do pedido, já com o desconto da condição de pagamento).
    const tableDiscountedValue = grossValue * (1 - discountNum / 100)
    const totalValue = tableDiscountedValue * (1 - cashDiscountNum / 100)
    const commBase = PAYMENT_DRIVEN_DISCOUNT ? totalValue : tableDiscountedValue
    const matchedRule = findMatchingRule(discountNum)
    // Tabelas de Pronta Entrega: comissão padrão 6% repres. + 4% escritório quando não há regras
    const PE_DEFAULT = { total_commission_pct: 10, rep_commission_pct: 6, office_commission_pct: 4, guide_commission_pct: 0 }
    const rule = matchedRule ?? (tableDetail?.is_pe ? PE_DEFAULT : null)
    // Admin: 100% comissão vai para escritório, 0% para rep
    const repCommPct = (isAdmin && rule) ? 0 : (rule?.rep_commission_pct || 0)
    const offCommPct = (isAdmin && rule) ? rule.total_commission_pct : (rule?.office_commission_pct || 0)
    const guideCommPct = (isAdmin && rule) ? 0 : (rule?.guide_commission_pct || 0)
    return {
      totalPieces,
      grossValue,
      totalValue,
      repCommission: commBase * repCommPct / 100,
      officeCommission: commBase * offCommPct / 100,
      guideCommission: commBase * guideCommPct / 100,
      totalCommission: rule ? commBase * rule.total_commission_pct / 100 : 0,
      rule,
      isAdminOrder: isAdmin,
    }
  }, [cart, effectiveDiscountNum, discountNum, cashDiscountNum, findMatchingRule, isAdmin])


  function removeFromCart(productId: string) {
    setCart(cart.filter((c) => c.product.id !== productId))
  }

  function updateSize(productId: string, size: string, value: number) {
    setCart(cart.map(c => {
      if (c.product.id !== productId) return c
      // Não permite lançar quantidade em tamanhos bloqueados
      const blocked = new Set((c.product.blocked_sizes || []).map(s => s.toUpperCase()))
      if (blocked.has(size.toUpperCase())) return c
      return { ...c, sizes: { ...c.sizes, [size]: Math.max(0, value) } }
    }))
  }

  function updateBoxCount(productId: string, delta: number) {
    setCart(cart.map((c) => {
      if (c.product.id !== productId) return c
      return { ...c, boxes_count: Math.max(1, c.boxes_count + delta) }
    }))
  }

  function setBoxCountDirect(productId: string, value: number) {
    if (value < 1) return
    setCart(cart.map((c) =>
      c.product.id === productId ? { ...c, boxes_count: value } : c
    ))
  }

  const createMut = useMutation({
    mutationFn: async () => {
      // Valida limite de Desc. À Vista antes de enviar
      const maxCash = tableDetail?.max_cash_discount_pct
      if (maxCash !== null && maxCash !== undefined && cashDiscountNum > maxCash) {
        throw new Error(`Desc. À Vista máximo permitido para esta tabela é ${maxCash.toFixed(2).replace('.', ',')}%`)
      }

      const payload = {
        client_id: selectedClient!.id,
        factory_id: selectedTable!.factory_id,
        price_table_id: selectedTable!.id,
        items: cart.map((c) => ({
          product_id: c.product.id,
          reference: c.product.reference,
          boxes_count: c.boxes_count,
          unit_price: c.unit_price,
          sizes: c.product.type === 'regular' ? c.sizes : undefined,
          custom_grade: c.custom_grade && c.custom_grade.length > 0 ? c.custom_grade : undefined,
        })),
        discount_pct: effectiveDiscountNum,
        // Separar desconto de prazo (comercial) do à vista:
        // o lookup de comissão deve usar só o desconto comercial,
        // mas o preço ao cliente usa o total (commercial + à vista).
        commission_discount_pct: discountNum,
        cash_discount_pct: cashDiscountNum,
        // DESC. ESPECIAL → admin precisa revisar desconto e comissão
        custom_discount: customDiscount || (discountNum > 0 && !discountRules.some(r => r.discount_pct === discountNum)),
        notes: notes || undefined,
        payment_terms: paymentTerms || undefined,
        freight_type: freightType || 'CIF',
        delivery_date: deliveryDate || undefined,
        industry_order_number: industryOrderNumber || undefined,
        buyer_name: buyerName || undefined,
      }
      if (online) {
        const res = await ordersApi.create(payload)
        return { online: true, id: res.data.id }
      } else {
        const offline_id = `offline_${Date.now()}_${Math.random().toString(36).slice(2)}`
        await db.pendingOrders.add({
          offline_id,
          ...payload,
          notes: notes || null,
          createdAt: Date.now(),
          status: 'pending',
        })
        return { online: false, offline_id }
      }
    },
    onSuccess: () => {
      // Pedido finalizado: descarta o rascunho salvo
      clearOrderDraft(user?.id)
      // Invalida e força refetch imediato (ignora staleTime)
      qc.invalidateQueries({ queryKey: ['orders'], refetchType: 'all' })
      qc.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'all' })
      navigate('/orders')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || err?.message || 'Erro ao criar pedido'
      alert(msg)
    },
  })

  const totals = cartTotals()
  const factoryOptions = ((factories || []) as { id: string; name: string }[]).map((f) => ({
    value: f.id,
    label: f.name,
  }))

  // Cancelar/descartar o pedido em andamento (pedido de teste ou cliente desistiu)
  function cancelarPedido() {
    const temConteudo = cart.length > 0 || !!selectedClient
    if (temConteudo && !window.confirm('Cancelar este pedido?\n\nTudo que foi preenchido (cliente e itens) será descartado.')) return
    clearOrderDraft(user?.id)
    setCart([])
    navigate('/orders')
  }

  return (
    <div className="pb-24 lg:pb-0 min-h-screen bg-surface-container-low">
      {/* Header */}
      <div ref={headerRef} className="bg-white border-b border-outline-variant px-4 py-2 lg:px-8 sticky top-0 z-10">
        <div className="w-full">
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => {
                if (step === 0) navigate('/orders')
                else if (step === 2 && cart.length > 0) {
                  if (window.confirm(`Você tem ${cart.length} item(ns) no carrinho.\nVoltar irá esvaziar o carrinho e permitir trocar a tabela.\n\nDeseja continuar?`)) {
                    setCart([])
                    setStep(1)
                  }
                } else {
                  setStep(step - 1)
                }
              }}
              className="p-1.5 rounded-lg text-outline hover:bg-surface-container"
              title="Voltar (ESC)"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h1 className="text-[12px] font-bold text-on-surface">Novo Pedido</h1>
            <div className="ml-auto flex items-center gap-3">
              <button
                type="button"
                onClick={cancelarPedido}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-500 hover:bg-red-50 transition-colors"
                title="Cancelar e descartar este pedido"
              >
                <X className="h-3.5 w-3.5" /> Cancelar pedido
              </button>
              {/* Hint de atalhos */}
              <div className="hidden lg:flex items-center gap-2 text-[10px] text-outline/60">
                <kbd className="px-1.5 py-0.5 bg-surface-container rounded border border-outline-variant font-mono">ESC</kbd>
                <span>Voltar</span>
                <kbd className="px-1.5 py-0.5 bg-surface-container rounded border border-outline-variant font-mono">↵</kbd>
                <span>Confirmar</span>
              </div>
            </div>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-0">
            {STEPS.map((s, i) => (
              <div key={i} className="flex items-center flex-1">
                <div className={`flex-1 flex flex-col items-center gap-1 ${i <= step ? 'text-primary' : 'text-outline/50'}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors ${
                    i < step ? 'bg-primary text-white' :
                    i === step ? 'bg-primary/10 text-primary ring-2 ring-blue-300' :
                    'bg-surface-container text-outline/70'
                  }`}>
                    {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </div>
                  <span className="text-[12px] font-medium hidden sm:block">{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 transition-colors ${i < step ? 'bg-primary' : 'bg-surface-container-high'}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 lg:px-8 w-full">
        {/* STEP 0: Select Client */}
        {step === 0 && (
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[12px] font-semibold text-on-surface mb-1">Selecionar Cliente</h2>
                <p className="text-[12px] text-outline">Escolha o cliente para este pedido</p>
              </div>
              <button
                onClick={() => setShowNewClient(true)}
                className="flex-shrink-0 flex items-center gap-1.5 text-[12px] font-semibold text-primary bg-primary/10 hover:bg-primary/10 border border-primary/30 rounded-lg px-3 py-1.5 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Novo Cliente
              </button>
            </div>

            <Input
              placeholder="Buscar cliente..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
              onClear={() => setClientSearch('')}
            />

            {loadingClients ? (
              <PageSpinner />
            ) : (
              <div className="space-y-1">
                {(clients || []).map((c, idx) => (
                  <Card
                    key={c.id}
                    padding="md"
                    onClick={() => {
                      setSelectedClient(c)
                      if (c.buyer_name) setBuyerName(c.buyer_name)
                      setStep(1)
                    }}
                    className={selectedClient?.id === c.id ? 'ring-2 ring-primary' : ''}
                    {...(idx === 0 ? { 'data-client-card': 'true' } as Record<string, string> : {})}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <span className="text-[12px] font-bold text-emerald-700">
                          {c.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-on-surface text-[13px] truncate">{c.name}</p>
                        {c.trade_name && c.trade_name !== c.name && (
                          <p className="text-[11px] text-outline/70 truncate italic">{c.trade_name}</p>
                        )}
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {c.cnpj && (
                            <span className="text-[11px] text-outline font-mono">{c.cnpj}</span>
                          )}
                          {c.city && (
                            <span className="text-[11px] text-outline">{c.city}{c.state ? `/${c.state}` : ''}</span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-outline/50 flex-shrink-0" />
                    </div>
                  </Card>
                ))}
                {clients?.length === 0 && (
                  <div className="text-center py-6 space-y-1.5">
                    <p className="text-[12px] text-outline">Nenhum cliente encontrado</p>
                    <button
                      onClick={() => setShowNewClient(true)}
                      className="inline-flex items-center gap-2 text-[12px] font-semibold text-primary bg-primary/10 hover:bg-primary/10 border border-primary/30 rounded-lg px-4 py-1 transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      Cadastrar novo cliente
                    </button>
                  </div>
                )}
              </div>
            )}

            <NewClientModal
              open={showNewClient}
              onClose={() => setShowNewClient(false)}
              onCreated={(c: CreatedClient) => {
                setSelectedClient(c)
                setShowNewClient(false)
                setStep(1)
              }}
            />
          </div>
        )}

        {/* STEP 1: Select Price Table */}
        {step === 1 && (
          <div className="space-y-1">
            <div>
              <h2 className="text-[12px] font-semibold text-on-surface mb-1">Tabela de Preços</h2>
              {selectedClient && (
                <p className="text-[12px] text-outline">Cliente: <strong>{selectedClient.name}</strong></p>
              )}
            </div>

            <Select
              label="Filtrar por fábrica"
              options={factoryOptions}
              value={selectedFactory}
              onChange={(e) => setSelectedFactory(e.target.value)}
              placeholder="Todas as fábricas"
            />

            {loadingTables ? (
              <PageSpinner />
            ) : (
              <div className="space-y-1">
                {(priceTables || []).map((t) => (
                  <Card
                    key={t.id}
                    padding="md"
                    onClick={() => {
                      if (selectedTable?.id === t.id) {
                        // Mesma tabela: mantém carrinho
                        setStep(2)
                      } else if (cart.length > 0) {
                        // Tabela diferente com itens no carrinho: confirma
                        if (window.confirm(`Trocar para "${t.name}" irá esvaziar o carrinho com ${cart.length} item(ns).\n\nDeseja continuar?`)) {
                          setSelectedTable(t)
                          setCart([])
                          setStep(2)
                        }
                      } else {
                        setSelectedTable(t)
                        setCart([])
                        setStep(2)
                      }
                    }}
                    className={selectedTable?.id === t.id ? 'ring-2 ring-primary' : ''}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Tags className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-on-surface truncate">{t.name}</p>
                        <p className="text-[12px] text-outline">{t.factory_name}</p>
                        <div className="flex gap-1.5 mt-1 flex-wrap">
                          {t.collection && <Badge variant="info">{t.collection}</Badge>}
                          {t.season && <Badge variant="default">{t.season}</Badge>}
                          {t.year && <Badge variant="default">{t.year}</Badge>}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-outline/50 flex-shrink-0" />
                    </div>
                  </Card>
                ))}
                {priceTables?.length === 0 && (
                  <p className="text-center text-[12px] text-outline py-2.5">Nenhuma tabela disponível</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Browse Catalog + Cart */}
        {step === 2 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[12px] font-semibold text-on-surface">Produtos</h2>
                <p className="text-[12px] text-outline">{selectedTable?.name} — {selectedTable?.factory_name}</p>
              </div>
              {cart.length > 0 && (
                <Badge variant="info">{cart.length} itens</Badge>
              )}
            </div>

            {/* ── Card de busca: sempre visível e "renovado" após cada item confirmado ──
                Contém o campo de busca da próxima referência + botão Finalizar Pedido,
                para que o vendedor possa lançar referência após referência sem perder
                de vista a opção de encerrar o pedido (ajuste solicitado p/ mobile e web) */}
            <div
              className="sticky z-20 bg-white rounded-xl border border-outline-variant shadow-sm p-2 space-y-2"
              style={{ top: headerHeight }}
            >
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    ref={productSearchRef}
                    placeholder="Referência, nome... (Enter para adicionar)"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    leftIcon={<Search className="h-4 w-4" />}
                    onClear={() => setProductSearch('')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && products && products.length > 0) {
                        e.preventDefault()
                        setQuickAddProduct(products[0])
                        setProductSearch('')
                      }
                    }}
                  />
                </div>
                {/* Botão microfone — busca por voz */}
                {voiceRef.status !== 'unsupported' && (
                  <button
                    type="button"
                    onClick={voiceRef.toggle}
                    title={voiceRef.status === 'listening' ? 'Parar gravação' : 'Falar referência'}
                    className={`flex-shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center transition-all ${
                      voiceRef.status === 'listening'
                        ? 'bg-red-500 border-red-500 text-white animate-pulse shadow-lg shadow-red-200'
                        : 'border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary hover:bg-primary/5'
                    }`}
                  >
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                    </svg>
                  </button>
                )}
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="border border-outline-variant rounded-lg px-2 py-1.5 text-[12px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                >
                  <option value="">Todos</option>
                  <option value="regular">Regular</option>
                  <option value="pack">Pack</option>
                </select>
              </div>

              {/* Botão Finalizar Pedido — sempre presente junto ao card de busca */}
              <button
                type="button"
                disabled={cart.length === 0}
                onClick={() => cart.length > 0 && setStep(3)}
                className={`w-full flex items-center justify-center gap-2 rounded-lg py-2 text-[12px] font-bold transition-all ${
                  cart.length > 0
                    ? 'bg-green-600 hover:bg-green-700 active:scale-[0.98] text-white shadow-md'
                    : 'bg-surface-container text-outline/60 cursor-not-allowed'
                }`}
              >
                <Check className="h-3.5 w-3.5" />
                Finalizar Pedido
                {cart.length > 0 && (
                  <span className="font-normal text-white/80">
                    · {cart.length} item{cart.length > 1 ? 'ns' : ''} · {formatCurrency(totals.totalValue)}
                  </span>
                )}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {loadingProducts ? (
              <PageSpinner />
            ) : (
              <div className="space-y-1">
                {(products || []).map((p) => {
                  const cartItem = cart.find((c) => c.product.id === p.id)
                  const isRegular = p.type === 'regular'
                  const totalPiecesPerBox = p.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 0
                  const isExpanded = expandedGrade === p.id
                  const cartTotal = cartItem
                    ? isRegular
                      ? Object.values(cartItem.sizes).reduce((s, v) => s + (v || 0), 0)
                      : cartItem.boxes_count * totalPiecesPerBox
                    : 0

                  return (
                    <div key={p.id} id={`product-card-${p.id}`}
                      className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden cursor-pointer hover:border-primary/50 hover:shadow-md transition-all active:scale-[0.99]"
                      onClick={() => setQuickAddProduct(p)}
                    >
                      <div className="flex gap-3 p-3">
                        {/* Image */}
                        <div className="w-14 h-14 bg-surface-container rounded-lg flex-shrink-0 overflow-hidden">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.reference} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-outline/50">
                              <ImageIcon className="h-6 w-6" />
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-1.5">
                            <p className="font-bold text-on-surface text-[12px]">{p.reference}</p>
                            <Badge variant={p.type === 'pack' ? 'purple' : 'info'} className="text-[12px] flex-shrink-0">
                              {p.type === 'pack' ? 'PACK' : 'REG'}
                            </Badge>
                          </div>
                          {p.product_name && <p className="text-[12px] text-outline truncate">{p.product_name}</p>}
                          <p className="text-[12px] text-primary/70 font-medium truncate">{selectedTable?.name}</p>
                          <p className="text-[12px] font-semibold text-primary">
                            R$ {Number(p.base_price).toFixed(2)}<span className="text-[12px] text-outline/70 font-normal">/pç</span>
                          </p>
                          {/* Para packs: exibe pç/cx com toggle de grade */}
                          {!isRegular && totalPiecesPerBox > 0 && (
                            <button
                              onClick={() => setExpandedGrade(isExpanded ? null : p.id)}
                              className="flex items-center gap-1 text-[12px] text-outline/70 hover:text-on-surface-variant mt-0.5"
                            >
                              <Info className="h-3 w-3" />
                              {totalPiecesPerBox} pç/cx
                            </button>
                          )}
                          {/* Para regulares: exibe range de tamanhos */}
                          {isRegular && p.grade_configs && p.grade_configs.length > 0 && (
                            <p className="text-[12px] text-outline/70 mt-0.5">
                              Tam: {sortSizes(Object.keys(p.grade_configs[0].sizes)).join(' · ')}
                            </p>
                          )}
                          {/* Observação do produto */}
                          {p.observation && (
                            <p className="text-[12px] text-amber-700 italic mt-0.5 line-clamp-2">{p.observation}</p>
                          )}
                        </div>

                        {/* Controles */}
                        <div className="flex-shrink-0 flex flex-col items-end gap-2">
                          {cartItem ? (
                            isRegular ? (
                              /* Regular: mostra total de peças + botão remover */
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-[12px] font-bold text-primary">{cartTotal} pç</span>
                                <button
                                  onClick={() => removeFromCart(p.id)}
                                  className="w-7 h-7 rounded-lg text-red-400 hover:bg-red-50 flex items-center justify-center"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              /* Pack: boxes_count +/- */
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => updateBoxCount(p.id, -1)}
                                  className="w-7 h-7 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high"
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                                <input
                                  type="number"
                                  min="1"
                                  value={cartItem.boxes_count}
                                  onChange={(e) => setBoxCountDirect(p.id, parseInt(e.target.value) || 1)}
                                  className="w-10 h-7 text-center border border-outline-variant rounded-lg text-[12px] font-bold focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <button
                                  onClick={() => updateBoxCount(p.id, 1)}
                                  className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary hover:bg-indigo-200"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => removeFromCart(p.id)}
                                  className="w-7 h-7 rounded-lg text-red-400 hover:bg-red-50 flex items-center justify-center"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )
                          ) : (
                            <button
                              onClick={() => setQuickAddProduct(p)}
                              className="flex items-center gap-1 bg-primary text-white text-[12px] font-medium px-3 py-1.5 rounded-lg hover:bg-primary/90"
                            >
                              <Plus className="h-3.5 w-3.5" /> Adicionar
                            </button>
                          )}
                          {/* Total de peças para packs */}
                          {cartItem && !isRegular && (
                            <p className="text-[12px] text-outline">
                              {cartTotal} pç total
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Área expandida:
                          - Regular em carrinho: SizeGrid (sempre visível)
                          - Pack: grade preview (toggle) */}
                      {cartItem && isRegular && cartItem.custom_grade && cartItem.custom_grade.length > 0 && (
                        <div className="px-3 pb-3 border-t border-outline-variant/50 pt-2 bg-primary/5">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[12px] font-medium text-on-surface-variant">Por cor × tamanho:</span>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setQuickAddProduct(p)} className="text-primary hover:text-primary/80 flex items-center gap-1 text-[12px] font-semibold">
                                <Pencil className="h-3 w-3" /> Editar
                              </button>
                              <button onClick={() => removeFromCart(p.id)} className="text-red-400 hover:text-red-600 flex items-center gap-1 text-[12px]">
                                <Trash2 className="h-3 w-3" /> Remover
                              </button>
                            </div>
                          </div>
                          <div className="space-y-0.5">
                            {cartItem.custom_grade.map(e => (
                              <p key={e.color} className="text-[12px] text-on-surface">
                                <span className="font-semibold">{e.color}:</span>{' '}
                                {sortSizes(Object.keys(e.sizes).filter(s => (e.sizes[s] || 0) > 0)).map(s => `${s}×${e.sizes[s]}`).join('  ') || '—'}
                                <span className="text-primary font-bold ml-1">({e.total_pieces})</span>
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                      {cartItem && isRegular && !(cartItem.custom_grade && cartItem.custom_grade.length > 0) && (
                        <div className="px-3 pb-3 border-t border-outline-variant/50 pt-2 bg-primary/5">
                          <SizeGrid
                            sizes={cartItem.sizes}
                            onChange={(size, val) => updateSize(p.id, size, val)}
                            onRemove={() => removeFromCart(p.id)}
                            blockedSizes={p.blocked_sizes || []}
                          />
                        </div>
                      )}
                      {isExpanded && !isRegular && p.grade_configs && (
                        <div className="px-3 pb-3 border-t border-outline-variant/50 pt-2">
                          <p className="text-[12px] font-medium text-on-surface-variant mb-1.5">Composição da grade:</p>
                          <GradePreview
                            configs={p.grade_configs}
                            boxCount={cartItem?.boxes_count || 1}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
                {products?.length === 0 && (
                  <p className="text-center text-[12px] text-outline py-2.5">Nenhum produto encontrado</p>
                )}
              </div>
            )}

            {/* Floating cart summary */}
            {cart.length > 0 && (
              <div className="fixed bottom-16 lg:bottom-6 left-0 right-0 lg:left-auto lg:right-8 lg:w-80 px-3 lg:px-0 z-40 space-y-1.5">
                {/* Info bar */}
                <div className="bg-black/70 backdrop-blur-sm text-white rounded-xl px-4 py-2 flex items-center justify-between gap-4 text-sm whitespace-nowrap">
                  <span className="text-white/70">{cart.length} item{cart.length > 1 ? 'ns' : ''} · {totals.totalPieces} pç</span>
                  <span className="font-bold text-base">{formatCurrency(totals.totalValue)}</span>
                </div>
                {/* Botão Finalizar Pedido */}
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 active:scale-[0.98] text-white rounded-2xl shadow-2xl py-4 text-base font-bold transition-all"
                  style={{ boxShadow: '0 8px 32px rgba(22,163,74,0.5)' }}
                >
                  Finalizar Pedido
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: Review */}
        {step === 3 && (
          <div className="space-y-1.5">
            <div>
              <h2 className="text-[12px] font-semibold text-on-surface">Revisão do Pedido</h2>
              <p className="text-[12px] text-outline">Confirme os dados antes de enviar</p>
            </div>

            {/* Offline warning */}
            {!online && (
              <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl p-3">
                <WifiOff className="h-4 w-4 text-orange-500 flex-shrink-0 mt-0.5" />
                <p className="text-[12px] text-orange-800">
                  Sem conexão. O pedido será salvo localmente e sincronizado quando você voltar online.
                </p>
              </div>
            )}

            {/* Client + Table summary */}
            <Card padding="sm">
              <div className="space-y-1 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-outline">Cliente:</span>
                  <span className="font-medium text-on-surface">{selectedClient?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">Tabela:</span>
                  <span className="font-medium text-on-surface">{selectedTable?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">Fábrica:</span>
                  <span className="font-medium text-on-surface">{selectedTable?.factory_name}</span>
                </div>
              </div>
            </Card>

            {/* Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-semibold text-on-surface-variant">Itens ({cart.length})</h3>
                <button
                  onClick={() => setStep(2)}
                  className="text-[12px] text-primary hover:text-primary"
                >
                  Editar
                </button>
              </div>
              <div className="space-y-1">
                {cart.map((item) => {
                  const isRegular = item.product.type === 'regular'
                  const piecesPerBox = item.product.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 1
                  const totalPieces = isRegular
                    ? Object.values(item.sizes).reduce((s, v) => s + (v || 0), 0)
                    : item.boxes_count * piecesPerBox
                  const subtotal = item.unit_price * totalPieces * (1 - effectiveDiscountNum / 100)
                  return (
                    <div key={item.product.id} className="bg-white rounded-xl border border-outline-variant p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[12px] text-on-surface">{item.product.reference}</p>
                          <p className="text-[12px] text-primary/70 font-medium">{selectedTable?.name}</p>
                          <p className="text-[12px] text-outline">{item.product.product_name}</p>
                          {isRegular ? (
                            <p className="text-[12px] text-outline mt-0.5">{totalPieces} peças</p>
                          ) : (
                            <p className="text-[12px] text-outline mt-0.5">
                              {item.boxes_count} cx × {piecesPerBox} pç/cx = {totalPieces} peças
                            </p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0 space-y-1">
                          <p className="text-[12px] font-bold text-on-surface">{formatCurrency(subtotal)}</p>
                          {/* Preço editável */}
                          <div className="flex items-center gap-1 justify-end">
                            <span className="text-[11px] text-outline/70">R$</span>
                            <input
                              type="text" inputMode="decimal"
                              defaultValue={Number(item.unit_price).toFixed(2).replace('.', ',')}
                              key={`np-${item.product.id}-${item.unit_price}`}
                              onBlur={e => {
                                const raw = e.target.value.replace(',', '.')
                                const v = parseFloat(raw)
                                if (!isNaN(v) && v > 0) {
                                  setCart(prev => prev.map(c =>
                                    c.product.id === item.product.id ? { ...c, unit_price: v } : c
                                  ))
                                  e.target.value = v.toFixed(2).replace('.', ',')
                                } else {
                                  e.target.value = Number(item.unit_price).toFixed(2).replace('.', ',')
                                }
                              }}
                              onFocus={e => e.target.select()}
                              className="w-20 text-right text-[12px] font-semibold text-primary border border-outline-variant/50 rounded-lg px-1.5 py-0.5 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 bg-white"
                            />
                            <span className="text-[11px] text-outline/70">/pç</span>
                          </div>
                        </div>
                      </div>
                      {/* Grade display */}
                      <div className="mt-2 pt-2 border-t border-outline-variant/50">
                        {isRegular ? (
                          <SizeDisplay sizes={item.sizes} />
                        ) : (
                          item.product.grade_configs && item.product.grade_configs.length > 0 && (
                            <GradePreview configs={item.product.grade_configs} boxCount={item.boxes_count} />
                          )
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Campos do pedido */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={paymentTerms.trim() ? 'block text-[12px] font-medium text-on-surface-variant mb-1' : 'block text-[12px] font-semibold text-amber-600 mb-1'}>
                  Condição de Pagamento {!paymentTerms.trim() && <span className="text-amber-500">⚠</span>}
                </label>
                <input
                  type="text"
                  list="payment-conditions-list"
                  value={paymentTerms}
                  onChange={(e) => {
                    setPaymentTerms(e.target.value)
                    // Distribuidora: aplica o % de desconto embutido no nome da condição
                    if (PAYMENT_DRIVEN_DISCOUNT) setCashDiscountPct(String(parsePaymentDiscount(e.target.value)))
                  }}
                  placeholder="Selecione ou digite..."
                  className={paymentTerms.trim()
                    ? 'w-full border border-outline-variant rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary'
                    : 'w-full border-2 border-amber-400 rounded-lg px-3 py-1.5 text-[12px] bg-amber-50 text-on-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-500'}
                />
                {paymentConditions.length > 0 && (
                  <datalist id="payment-conditions-list">
                    {paymentConditions.map(c => <option key={c.id} value={c.name} />)}
                  </datalist>
                )}
              </div>
              <div>
                <label className="block text-[12px] font-medium text-on-surface-variant mb-1">Tipo de Frete</label>
                <select
                  value={freightType}
                  onChange={(e) => setFreightType(e.target.value)}
                  className="w-full border border-outline-variant rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="CIF">CIF</option>
                  <option value="FOB">FOB</option>
                </select>
              </div>
              <Input
                label="Previsão de Entrega"
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
              <div>
                <label className={buyerName.trim() ? 'block text-[12px] font-medium text-on-surface-variant mb-1' : 'block text-[12px] font-semibold text-amber-600 mb-1'}>
                  Comprador {!buyerName.trim() && <span className="text-amber-500">⚠</span>}
                </label>
                <input
                  type="text"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="Nome do comprador"
                  className={buyerName.trim()
                    ? 'w-full border border-outline-variant rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary'
                    : 'w-full border-2 border-amber-400 rounded-lg px-3 py-1.5 text-[12px] bg-amber-50 text-on-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-500'}
                />
              </div>
              <div className="col-span-2">
                <Input
                  label="Nº do Pedido na Indústria"
                  value={industryOrderNumber}
                  onChange={(e) => setIndustryOrderNumber(e.target.value)}
                  placeholder="Número gerado pela fábrica"
                />
              </div>
            </div>

            {/* Notes */}
            <Textarea
              label="Observações"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Instruções especiais, prazo de entrega, etc."
              rows={2}
            />

            {/* ── Bloco de fechamento: desconto + totais + confirmar ── */}
            <div className="bg-white border border-outline-variant rounded-2xl overflow-hidden shadow-sm">

              {/* Desconto */}
              {!PAYMENT_DRIVEN_DISCOUNT && (
              <div className="p-3 border-b border-outline-variant/50">
                <h3 className="text-[12px] font-semibold text-on-surface-variant mb-2">Desconto Comercial</h3>
                {discountRules.length > 0 && !customDiscount ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      {discountRules.map((rule) => {
                        const isSelected = parseDecimal(discountPct) === rule.discount_pct
                        const discountedTotal = totals.grossValue * (1 - rule.discount_pct / 100)
                        // Admin: mostra total commission como "X% escrit."
                        const adminCommLabel = isAdmin
                          ? `${formatPct(rule.total_commission_pct)} escrit.`
                          : rule.rep_commission_pct > 0 ? `com. ${formatPct(rule.rep_commission_pct)}` : null
                        return (
                          <button
                            key={rule.id}
                            onClick={() => setDiscountPct(maskPercent(String(rule.discount_pct)))}
                            className={`text-left p-3 rounded-xl border transition-colors ${
                              isSelected
                                ? 'border-primary bg-primary/10 ring-1 ring-blue-400'
                                : 'border-outline-variant bg-surface-container-low hover:border-outline-variant hover:bg-white'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <div className="min-w-0">
                                <p className="font-bold text-on-surface text-[12px] leading-tight">
                                  {formatPct(rule.discount_pct)}
                                </p>
                                <p className="text-[12px] text-outline mt-0.5 leading-tight">
                                  {formatCurrency(discountedTotal)}
                                </p>
                                {adminCommLabel && (
                                  <p className="text-[12px] text-emerald-600 mt-0.5 leading-tight">
                                    {adminCommLabel}
                                  </p>
                                )}
                              </div>
                              {isSelected && <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />}
                            </div>
                          </button>
                        )
                      })}

                      {/* Card DESC. ESPECIAIS — desconto livre */}
                      {(() => {
                        const specialSelected = customDiscount || (parseDecimal(discountPct) > 0 && !discountRules.some(r => r.discount_pct === parseDecimal(discountPct)))
                        return (
                          <button
                            onClick={() => setCustomDiscount(true)}
                            className={`text-left p-3 rounded-xl border transition-colors ${
                              specialSelected
                                ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-400'
                                : 'border-outline-variant bg-surface-container-low hover:bg-white'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <div className="min-w-0">
                                <p className="font-bold text-amber-700 text-[12px] leading-tight">DESC. ESPECIAL</p>
                                <p className="text-[12px] text-outline mt-0.5 leading-tight">% livre</p>
                                {specialSelected && parseDecimal(discountPct) > 0 && (
                                  <p className="text-[12px] text-amber-600 mt-0.5">{formatPct(parseDecimal(discountPct))}</p>
                                )}
                              </div>
                              {specialSelected && <Check className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />}
                            </div>
                          </button>
                        )
                      })()}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <MaskedInput
                      label="Desconto (%)"
                      mask="percent"
                      value={discountPct}
                      onChangeValue={(v) => setDiscountPct(v)}
                    />
                    {discountRules.length > 0 && (
                      <button
                        onClick={() => setCustomDiscount(false)}
                        className="text-[12px] text-primary hover:text-primary"
                      >
                        Ver descontos configurados
                      </button>
                    )}
                  </div>
                )}
              </div>
              )}

              {/* Desc. À Vista */}
              {!PAYMENT_DRIVEN_DISCOUNT && (() => {
                const maxCash = tableDetail?.max_cash_discount_pct
                const overLimit = maxCash !== null && maxCash !== undefined && cashDiscountNum > maxCash
                return (
                  <div className="p-3 border-b border-outline-variant/50">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[12px] font-semibold text-on-surface-variant">
                        Desc. À Vista
                        {maxCash !== null && maxCash !== undefined && (
                          <span className="ml-1.5 text-[10px] font-normal text-outline">
                            (máx. {maxCash.toFixed(2).replace('.', ',')}%)
                          </span>
                        )}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={`flex items-center rounded-xl overflow-hidden transition-all ${overLimit ? 'border-2 border-red-500 ring-2 ring-red-200' : 'border border-outline-variant focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary'} bg-surface-container-lowest`} style={{ width: 110 }}>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={cashDiscountNum === 0 ? '' : cashDiscountNum}
                          onChange={e => {
                            const v = parseFloat(e.target.value)
                            setCashDiscountPct(isNaN(v) ? '0' : String(v))
                          }}
                          onFocus={e => e.target.select()}
                          placeholder="0"
                          className="flex-1 text-right text-[14px] font-bold text-on-surface bg-transparent focus:outline-none px-3 py-2 w-0 min-w-0"
                        />
                        <span className="pr-3 text-[14px] font-semibold text-outline select-none">%</span>
                      </div>
                      {cashDiscountNum > 0 && !overLimit && (
                        <div className="text-[12px] text-emerald-700 font-medium">
                          −{formatCurrency(totals.grossValue * cashDiscountNum / 100)}
                        </div>
                      )}
                      {effectiveDiscountNum > 0 && cashDiscountNum > 0 && !overLimit && (
                        <div className="text-[12px] text-primary font-semibold">
                          Total: {formatPct(effectiveDiscountNum)}
                        </div>
                      )}
                    </div>
                    {overLimit && (
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-600 font-semibold bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
                        🚫 Desconto À Vista máximo permitido é {maxCash!.toFixed(2).replace('.', ',')}%.
                        Use o DESC. ESPECIAL para descontos maiores.
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Resumo financeiro */}
              <div className="p-3 space-y-1 text-[12px] bg-surface-container-low">
                <div className="flex justify-between text-outline">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(totals.grossValue)}</span>
                </div>
                {discountNum > 0 && (
                  <div className="flex justify-between text-orange-600">
                    <span>Desconto tabela ({formatPct(discountNum)}):</span>
                    <span>−{formatCurrency(totals.grossValue * discountNum / 100)}</span>
                  </div>
                )}
                {cashDiscountNum > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Desc. À Vista ({formatPct(cashDiscountNum)}):</span>
                    <span>−{formatCurrency(totals.grossValue * cashDiscountNum / 100)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-on-surface text-[12px] pt-1.5 border-t border-outline-variant">
                  <span>Total do pedido:</span>
                  <span>{formatCurrency(totals.totalValue)}</span>
                </div>
                <div className="flex justify-between text-outline/70 text-[12px]">
                  <span>Peças:</span>
                  <span>{totals.totalPieces} pç</span>
                </div>
                {isAdmin && totals.rule && (
                  <div className="pt-1 border-t border-outline-variant space-y-0.5">
                    {totals.isAdminOrder ? (
                      // Admin cria: 100% vai pro escritório
                      <div className="flex justify-between text-blue-600">
                        <span>Com. Escritório ({formatPct(totals.rule.total_commission_pct)}):</span>
                        <span className="font-semibold">{formatCurrency(totals.officeCommission)}</span>
                      </div>
                    ) : (
                      // Rep cria: split normal
                      <>
                        <div className="flex justify-between text-emerald-600">
                          <span>{FACTORY_COMM ? 'Com. Loja' : 'Com. Rep'} ({formatPct(totals.rule.rep_commission_pct)}):</span>
                          <span className="font-semibold">{formatCurrency(totals.repCommission)}</span>
                        </div>
                        <div className="flex justify-between text-blue-600">
                          <span>{FACTORY_COMM ? 'Com. Representante' : 'Com. Escritório'} ({formatPct(totals.rule.office_commission_pct)}):</span>
                          <span className="font-semibold">{formatCurrency(totals.officeCommission)}</span>
                        </div>
                        {FACTORY_COMM && (
                          <div className="flex justify-between text-amber-600">
                            <span>Com. Guia ({formatPct(totals.rule.guide_commission_pct || 0)}):</span>
                            <span className="font-semibold">{formatCurrency(totals.guideCommission)}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Botão confirmar */}
              <div className="p-3 pt-0 bg-surface-container-low">
                {createMut.isError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                    <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-[12px] text-red-700">Erro ao criar pedido. Tente novamente.</p>
                  </div>
                )}
                <Button
                  fullWidth
                  size="lg"
                  loading={createMut.isPending}
                  onClick={() => createMut.mutate()}
                  icon={online ? <Check className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
                >
                  {online ? 'Confirmar Pedido' : 'Salvar Offline'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal de adição rápida (Enter na busca) ── */}
      {quickAddProduct && (
        <QuickAddModal
          product={quickAddProduct}
          cartItem={cart.find(c => c.product.id === quickAddProduct.id) || null}
          selectedTable={selectedTable}
          onClose={() => setQuickAddProduct(null)}
          onAdd={(p, sizes, boxes, observation, price, customGrade) => {
            const exists = cart.find(c => c.product.id === p.id)
            if (exists) {
              setCart(cart.map(c => c.product.id === p.id ? { ...c, sizes, custom_grade: customGrade, boxes_count: boxes, observation, unit_price: price } : c))
            } else {
              setCart([...cart, { product: p, boxes_count: boxes, sizes, custom_grade: customGrade, unit_price: price, observation }])
            }
            setQuickAddProduct(null)
            // Ao confirmar o lançamento da referência, devolve o foco ao campo de busca
            // (o "card novo de busca") já pronto para a próxima referência — o botão
            // Finalizar Pedido permanece sempre visível ali ao lado
            setProductSearch('')
            focusProductSearch()
          }}
        />
      )}
    </div>
  )
}

// ─── QuickAddModal ────────────────────────────────────────────────────────────
function QuickAddModal({
  product, cartItem, selectedTable, onClose, onAdd,
}: {
  product: Product
  cartItem: CartItem | null
  selectedTable: PriceTable | null
  onClose: () => void
  onAdd: (p: Product, sizes: Record<string, number>, boxes: number, observation: string, price: number, customGrade?: CustomGradeEntry[]) => void
}) {
  const isPack = product.type === 'pack'

  // Para packs: grade selecionada (cor)
  const grades = product.grade_configs || []

  // Pack multi-grade: cada grade tem seu multiplicador; cliente mistura.
  const multiGradePack = isPack && MULTI_GRADE && grades.length > 0
  const [gradeMult, setGradeMult] = useState<number[]>(() =>
    grades.map(g => {
      if (!cartItem?.custom_grade?.length || g.total_pieces === 0) return 0
      const entry = cartItem.custom_grade.find(e => (e.color || '') === (g.color || ''))
      return entry ? Math.round((entry.total_pieces || 0) / g.total_pieces) : 0
    })
  )
  const mgCustomGrade: CustomGradeEntry[] = grades
    .map((g, i) => ({
      color: g.color || `Grade ${i + 1}`,
      sizes: Object.fromEntries(Object.entries(g.sizes).map(([s, q]) => [s.trim(), q * (gradeMult[i] || 0)])),
      total_pieces: g.total_pieces * (gradeMult[i] || 0),
    }))
    .filter(e => e.total_pieces > 0)
  const mgFlat: Record<string, number> = {}
  mgCustomGrade.forEach(e => Object.entries(e.sizes).forEach(([s, q]) => { mgFlat[s] = (mgFlat[s] || 0) + q }))
  const mgTotal = mgCustomGrade.reduce((s, e) => s + e.total_pieces, 0)

  // Regular com variantes cor × tamanho (distribuidora): grade editável por cor
  const multiVariant = !isPack && grades.length > 0 && grades.some(g => (g.color || '').trim() !== '')
  const variantSizes = multiVariant
    ? sortSizes([...new Set(grades.flatMap(g => Object.keys(g.sizes).map(s => s.trim())))])
    : []
  const variantColors = multiVariant ? grades.map(g => (g.color || '—')) : []
  const [colorQtys, setColorQtys] = useState<Record<string, Record<string, number>>>(() => {
    const m: Record<string, Record<string, number>> = {}
    if (cartItem?.custom_grade?.length) {
      cartItem.custom_grade.forEach(e => { m[e.color] = { ...e.sizes } })
    }
    grades.forEach(g => {
      const c = g.color || '—'
      if (!m[c]) m[c] = {}
      Object.keys(g.sizes).forEach(s => { if (m[c][s.trim()] === undefined) m[c][s.trim()] = 0 })
    })
    return m
  })
  // Estoque normalizado (case/acentos) p/ casar nome de cor/tamanho entre planilha e catálogo
  const norm = (s: string) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const stockNorm: Record<string, Record<string, number>> = (() => {
    const m: Record<string, Record<string, number>> = {}
    for (const [c, sizes] of Object.entries(product.stock || {})) {
      const k = norm(c); m[k] = m[k] || {}
      for (const [sz, q] of Object.entries(sizes || {})) m[k][norm(sz)] = Number(q) || 0
    }
    return m
  })()
  const hasStock = Object.keys(stockNorm).length > 0
  const availFor = (color: string, size: string): number | undefined => stockNorm[norm(color)]?.[norm(size)]
  const setColorQty = (color: string, size: string, value: number) =>
    setColorQtys(prev => {
      let v = Math.max(0, value)
      if (hasStock) {
        const avail = availFor(color, size) ?? 0  // sem estoque cadastrado p/ a combinação = 0 (bloqueia)
        if (v > avail) v = avail
      }
      return { ...prev, [color]: { ...prev[color], [size]: v } }
    })
  // Achatado por tamanho (mantém a lógica de totais/comissão igual) + detalhe por cor
  const flatSizes: Record<string, number> = {}
  variantSizes.forEach(s => { flatSizes[s] = variantColors.reduce((sum, c) => sum + (colorQtys[c]?.[s] || 0), 0) })
  const customGrade: CustomGradeEntry[] = variantColors
    .map(c => ({ color: c, sizes: colorQtys[c] || {}, total_pieces: Object.values(colorQtys[c] || {}).reduce((a, b) => a + (b || 0), 0) }))
    .filter(e => e.total_pieces > 0)
  const mvTotal = customGrade.reduce((s, e) => s + e.total_pieces, 0)

  // Para regulares: tamanhos
  const allSizes = (() => {
    if (isPack) return []
    if (grades.length) {
      const set = new Set<string>()
      grades.forEach(gc => Object.keys(gc.sizes).forEach(s => set.add(s.trim())))
      return sortSizes([...set])
    }
    return sortSizes(parseSizeRange(product.size_range || ''))
  })()

  const [sizes, setSizes] = useState<Record<string, number>>(() => cartItem?.sizes || initSizes(product))
  const [boxes, setBoxes] = useState(cartItem?.boxes_count || 1)
  const [observation, setObservation] = useState(cartItem?.observation || '')
  const [customPrice, setCustomPrice] = useState<number>(cartItem?.unit_price || Number(product.base_price))
  const [voiceGradeMsg, setVoiceGradeMsg] = useState('')

  // Microfone para preencher grade por voz (apenas produtos REGULAR)
  const voiceGrade = useVoiceInput({
    onResult: (text) => {
      const parsed = parseGradeFromSpeech(text, allSizes)
      if (Object.keys(parsed).length > 0) {
        setSizes(prev => ({ ...prev, ...parsed }))
        setVoiceGradeMsg(`✓ ${Object.entries(parsed).map(([s, q]) => `${s}×${q}`).join('  ')}`)
      } else {
        setVoiceGradeMsg('Não entendi — tente: "36 dois 38 três"')
      }
      setTimeout(() => setVoiceGradeMsg(''), 3000)
    },
  })

  // Pack: total = TODAS as cores × caixas (ex: 6 cores × 6 pç/cor = 36 pç/cx)
  const totalPiecesPerBox = grades.reduce((s, g) => s + g.total_pieces, 0) || 0
  const totalPieces = multiGradePack
    ? mgTotal
    : isPack
    ? totalPiecesPerBox * boxes
    : multiVariant
    ? mvTotal
    : Object.values(sizes).reduce((s, v) => s + v, 0)
  const totalValue = customPrice * totalPieces

  const fmtR = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
  const fmtN = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(v)

  // Garante que tamanhos bloqueados sempre ficam com 0
  const safeSizes = Object.fromEntries(
    Object.entries(sizes).map(([s, v]) => {
      const isBlocked = (product.blocked_sizes || []).map(b => b.toUpperCase()).includes(s.toUpperCase())
      return [s, isBlocked ? 0 : v]
    })
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Sempre para propagação quando o modal está aberto
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.stopPropagation()
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        // Verifica se está no ÚLTIMO input numérico da grade (não move para próximo)
        const target = e.target as HTMLElement
        const isInSizeGrid = target.tagName === 'INPUT' && target.getAttribute('type') === 'number'
        if (isInSizeGrid) {
          // Se há próximo input, deixa o grid handler mover o foco (não adiciona ainda)
          const table = target.closest('table')
          const inputs = table ? Array.from(table.querySelectorAll<HTMLInputElement>('input[type="number"]')) : []
          const idx = inputs.indexOf(target as HTMLInputElement)
          if (idx >= 0 && idx < inputs.length - 1) {
            // Não é o último — deixa navegar para o próximo
            return
          }
        }

        // É o último campo ou Enter fora da grade — adiciona o item
        e.preventDefault()
        if (totalPieces > 0) {
          if (multiGradePack) onAdd(product, mgFlat, 1, observation, customPrice, mgCustomGrade)
          else if (multiVariant) onAdd(product, flatSizes, boxes, observation, customPrice, customGrade)
          else onAdd(product, safeSizes, boxes, observation, customPrice)
        }
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose, onAdd, product, safeSizes, boxes, observation, totalPieces, customPrice])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[95vh] overflow-hidden">


        {/* ── Info do produto ── */}
        <div className="bg-surface-container-low px-5 py-4 border-b border-outline-variant flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[12px] flex-1">
              <span className="text-outline font-medium">Código</span>
              <span className="font-bold text-on-surface">{product.reference}{selectedTable ? ' | ' + selectedTable.factory_name : ''}</span>
              {product.product_name && <>
                <span className="text-outline font-medium">Descrição</span>
                <span className="text-on-surface">{product.product_name}{product.model ? ' - ' + product.model : ''}</span>
              </>}
              {selectedTable && <>
                <span className="text-outline font-medium">Tab. Preço</span>
                <span className="text-on-surface">{selectedTable.name}</span>
              </>}
              <span className="text-outline font-medium">Preço Tab.</span>
              <span className="font-bold text-primary">{fmtR(Number(product.base_price))}</span>
            </div>
            {/* Foto ou ícone */}
            <div className="w-20 h-20 rounded-xl overflow-hidden bg-surface-container flex-shrink-0 flex items-center justify-center border border-outline-variant/30">
              {(product.images?.length || product.image_url)
                ? <ProductPhotos images={product.images?.length ? product.images : [product.image_url]} alt={product.reference} className="w-full h-full" imgClassName="w-full h-full object-cover" />
                : <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-outline/30" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              }
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-outline hover:bg-surface-container flex-shrink-0 -mt-1">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── PACK MULTI-GRADE: cada grade com multiplicador (cliente mistura) ── */}
          {multiGradePack && (
            <div>
              <p className="text-[11px] text-outline font-semibold uppercase tracking-wide mb-2">
                Grades — escolha a quantidade de cada (pode misturar)
              </p>
              <div className="space-y-3">
                {grades.map((g, i) => {
                  const gSizes = sortSizes(Object.keys(g.sizes))
                  const mult = gradeMult[i] || 0
                  const setMult = (v: number) => setGradeMult(prev => prev.map((m, idx) => idx === i ? Math.max(0, v) : m))
                  return (
                    <div key={i} className={`border rounded-xl p-3 ${mult > 0 ? 'border-primary/40 bg-primary/5' : 'border-outline-variant'}`}>
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="text-[13px] font-bold text-on-surface">{g.color || `Grade ${i + 1}`}</span>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setMult(mult - 1)}
                            className="w-8 h-8 rounded-lg border border-outline-variant flex items-center justify-center hover:bg-surface-container active:scale-95">
                            <Minus className="h-4 w-4 text-on-surface-variant" />
                          </button>
                          <input type="number" min="0" value={mult}
                            onChange={e => setMult(parseInt(e.target.value) || 0)}
                            onFocus={e => e.target.select()}
                            className="w-14 text-center border-2 border-outline-variant rounded-lg py-1 text-[14px] font-bold focus:outline-none focus:border-primary" />
                          <button type="button" onClick={() => setMult(mult + 1)}
                            className="w-8 h-8 rounded-lg border border-outline-variant flex items-center justify-center hover:bg-surface-container active:scale-95">
                            <Plus className="h-4 w-4 text-on-surface-variant" />
                          </button>
                        </div>
                      </div>
                      <div className="overflow-x-auto scrollbar-hide">
                        <table className="min-w-max text-[12px] border border-outline-variant/60 rounded-lg overflow-hidden">
                          <thead className="bg-surface-container-low">
                            <tr>
                              {gSizes.map(s => <th key={s} className="px-2 py-1 text-center font-medium text-on-surface-variant min-w-[30px]">{s}</th>)}
                              <th className="px-2 py-1 text-center border-l border-outline-variant text-outline">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="bg-white">
                              {gSizes.map(s => <td key={s} className="px-2 py-1 text-center">{(g.sizes[s] || 0) * (mult || 1) > 0 ? (g.sizes[s] || 0) * Math.max(1, mult) : (g.sizes[s] || 0)}</td>)}
                              <td className="px-2 py-1 text-center font-bold border-l border-outline-variant">{g.total_pieces * Math.max(1, mult)}{mult === 0 ? ' /grade' : ''}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-[13px] font-bold text-primary mt-3">{mgTotal} peças total</p>
            </div>
          )}

          {/* ── PACK: tabela completa de cores × tamanhos ── */}
          {isPack && !multiGradePack && grades.length > 0 && (() => {
            const packSizes = sortSizes([...new Set(grades.flatMap(g => Object.keys(g.sizes).map(s => s.trim())))])
            const grandTotal = grades.reduce((s, g) => s + g.total_pieces, 0)
            return (
              <div>
                <p className="text-[11px] text-outline font-semibold uppercase tracking-wide mb-2">Grade do Pack</p>
                <div className="border border-outline-variant rounded-xl overflow-x-auto">
                  <table className="min-w-full text-[12px]">
                    <thead className="bg-surface-container-low sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-left font-bold text-outline border-r border-outline-variant/40">COR</th>
                        {packSizes.map(s => (
                          <th key={s} className="px-2 py-2 text-center font-bold text-outline border-r border-outline-variant/30 last:border-r-0 min-w-[40px]">{s}</th>
                        ))}
                        <th className="px-3 py-2 text-center font-bold text-primary">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/20">
                      {grades.map((g, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-surface-container-low/30'}>
                          <td className="px-3 py-2 font-semibold text-on-surface border-r border-outline-variant/30 whitespace-nowrap">{g.color || '—'}</td>
                          {packSizes.map(s => (
                            <td key={s} className="px-2 py-2 text-center text-on-surface-variant border-r border-outline-variant/20 last:border-r-0">
                              {(g.sizes[s] || g.sizes[s + ' '] || 0) > 0 ? (g.sizes[s] || g.sizes[s + ' '] || 0) * boxes : '—'}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-center font-bold text-primary">{g.total_pieces * boxes}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-outline-variant">
                      <tr className="bg-surface-container-low">
                        <td className="px-3 py-2 font-bold text-on-surface border-r border-outline-variant/30">QT. PACK</td>
                        {packSizes.map(s => (
                          <td key={s} className="px-2 py-2 text-center font-semibold text-on-surface border-r border-outline-variant/20 last:border-r-0">
                            {grades.reduce((sum, g) => sum + ((g.sizes[s] || g.sizes[s + ' '] || 0) * boxes), 0) || ''}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-center font-bold text-primary text-[14px]">{grandTotal * boxes}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="flex items-center gap-4 mt-3">
                  <p className="text-[12px] text-outline font-medium">Qtd. Caixas:</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setBoxes(Math.max(1, boxes - 1))}
                      className="w-9 h-9 rounded-xl border border-outline-variant flex items-center justify-center hover:bg-surface-container active:scale-95">
                      <Minus className="h-4 w-4 text-on-surface-variant" />
                    </button>
                    <input type="number" min="1" value={boxes}
                      onChange={e => setBoxes(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-16 text-center border-2 border-outline-variant rounded-xl py-1.5 text-[15px] font-bold focus:outline-none focus:border-primary" />
                    <button type="button" onClick={() => setBoxes(boxes + 1)}
                      className="w-9 h-9 rounded-xl border border-outline-variant flex items-center justify-center hover:bg-surface-container active:scale-95">
                      <Plus className="h-4 w-4 text-on-surface-variant" />
                    </button>
                  </div>
                  <span className="text-[13px] font-bold text-primary">{grandTotal * boxes} peças total</span>
                </div>
              </div>
            )
          })()}

          {/* ── REGULAR COM VARIANTES: grade editável cor × tamanho ── */}
          {multiVariant && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-outline font-semibold uppercase tracking-wide">Quantidades por cor × tamanho{hasStock && <span className="ml-1 normal-case font-normal text-emerald-600">(nº verde = estoque; limitado ao disponível)</span>}</p>
                <div>
                  <span className="text-[11px] text-outline font-medium mr-1">Total:</span>
                  <span className="text-[13px] font-bold text-primary">{mvTotal} pç</span>
                </div>
              </div>
              <div className="border border-outline-variant rounded-xl overflow-x-auto">
                <table className="min-w-full text-[12px]">
                  <thead className="bg-surface-container-low sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold text-outline border-r border-outline-variant/40">COR / MODELO</th>
                      {variantSizes.map(s => (
                        <th key={s} className="px-1 py-2 text-center font-bold text-outline border-r border-outline-variant/30 last:border-r-0 min-w-[44px]">{s}</th>
                      ))}
                      <th className="px-2 py-2 text-center font-bold text-primary">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/20">
                    {variantColors.map((color, ci) => {
                      const rowTotal = variantSizes.reduce((sum, s) => sum + (colorQtys[color]?.[s] || 0), 0)
                      return (
                        <tr key={color} className={ci % 2 === 0 ? 'bg-white' : 'bg-surface-container-low/30'}>
                          <td className="px-3 py-1.5 font-semibold text-on-surface border-r border-outline-variant/30 whitespace-nowrap">{color}</td>
                          {variantSizes.map((s) => {
                            const hasSize = colorQtys[color]?.[s] !== undefined
                            return (
                              <td key={s} className="border-r border-outline-variant/20 last:border-r-0 p-0.5 text-center align-top">
                                {hasSize ? (() => {
                                  const avail = hasStock ? (availFor(color, s) ?? 0) : undefined
                                  const atMax = avail !== undefined && (colorQtys[color]?.[s] || 0) >= avail && avail > 0
                                  const blocked = avail === 0
                                  return (
                                    <>
                                      <input
                                        type="number" min="0" inputMode="numeric"
                                        disabled={blocked}
                                        value={colorQtys[color]?.[s] ? colorQtys[color][s] : ''}
                                        placeholder="0"
                                        onChange={e => setColorQty(color, s, parseInt(e.target.value) || 0)}
                                        onFocus={e => e.target.select()}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault()
                                            const table = e.currentTarget.closest('table')
                                            const inputs = table ? Array.from(table.querySelectorAll<HTMLInputElement>('input[type="number"]')) : []
                                            const idx = inputs.indexOf(e.currentTarget)
                                            const next = inputs[idx + 1]
                                            if (next) next.focus()
                                          }
                                        }}
                                        title={avail !== undefined ? `Disponível: ${avail}` : undefined}
                                        className={`w-10 h-7 text-center border rounded text-[12px] font-bold focus:outline-none focus:ring-1 focus:ring-primary ${blocked ? 'bg-gray-100 border-gray-200 text-gray-300 cursor-not-allowed' : atMax ? 'bg-amber-50 border-amber-300' : 'bg-white border-outline-variant'}`}
                                      />
                                      {avail !== undefined && (
                                        <div className={`text-[10px] leading-none mt-0.5 ${avail > 0 ? 'text-emerald-600' : 'text-outline/40'}`}>
                                          {avail}
                                        </div>
                                      )}
                                    </>
                                  )
                                })() : <span className="text-outline/40">—</span>}
                              </td>
                            )
                          })}
                          <td className="px-2 py-1.5 text-center font-bold text-primary">{rowTotal || ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── REGULAR: grade de tamanhos por input ── */}
          {!isPack && !multiVariant && allSizes.length > 0 && (
            <div>
              <div className="flex items-center gap-4 mb-2">
                <div>
                  <p className="text-[11px] text-outline font-medium mb-1">Qtde. Total</p>
                  <div className="min-w-[70px] px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-center font-bold text-on-surface text-[14px]">{totalPieces}</div>
                </div>
                {product.size_range && (
                  <div>
                    <p className="text-[11px] text-outline font-medium mb-1">Grade</p>
                    <div className="px-3 py-2 border border-outline-variant rounded-lg text-[12px] text-on-surface bg-surface-container-low">{product.size_range}</div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-outline font-semibold uppercase tracking-wide">Quantidades por tamanho</p>
                {voiceGrade.status !== 'unsupported' && (
                  <button
                    type="button"
                    onClick={voiceGrade.toggle}
                    title={voiceGrade.status === 'listening' ? 'Parar — processando...' : 'Falar grade: "36 dois 38 três"'}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all ${
                      voiceGrade.status === 'listening'
                        ? 'bg-red-500 border-red-500 text-white animate-pulse'
                        : 'border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'
                    }`}
                  >
                    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                    </svg>
                    {voiceGrade.status === 'listening' ? 'Ouvindo...' : 'Falar grade'}
                  </button>
                )}
              </div>
              {voiceGradeMsg && (
                <p className={`text-[11px] mb-2 font-medium ${voiceGradeMsg.startsWith('✓') ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {voiceGradeMsg}
                </p>
              )}
              {(product.blocked_sizes || []).length > 0 && (
                <p className="text-[11px] text-amber-600 mb-2">🚫 Bloqueados: {(product.blocked_sizes || []).join(', ')}</p>
              )}
              <div className="border border-outline-variant rounded-xl overflow-hidden">
                <table className="w-full" style={{ tableLayout: 'fixed' }}>
                  <thead className="bg-surface-container-low sticky top-0 z-10">
                    <tr>{allSizes.map(s => {
                      const isBlocked = (product.blocked_sizes || []).map(b => b.toUpperCase()).includes(s.toUpperCase())
                      return (
                        <th key={s} className={`px-1 py-2 text-center text-[11px] font-bold border-r border-outline-variant/30 last:border-r-0 ${isBlocked ? 'text-red-300 line-through bg-red-50' : 'text-outline'}`}>{s}</th>
                      )
                    })}</tr>
                  </thead>
                  <tbody>
                    <tr>{allSizes.map((s, idx) => {
                      const isBlocked = (product.blocked_sizes || []).map(b => b.toUpperCase()).includes(s.toUpperCase())
                      return (
                      <td key={s} className={`border-r border-outline-variant/20 last:border-r-0 border-t border-outline-variant/20 p-0 ${isBlocked ? 'bg-red-50' : ''}`}>
                        {isBlocked ? (
                          <div className="w-full text-center py-2.5 text-[13px] text-red-300 cursor-not-allowed select-none" title={`Tamanho ${s} bloqueado`}>🚫</div>
                        ) : (
                        <input type="number" min="0"
                          value={sizes[s] || ''}
                          onChange={e => setSizes(prev => ({ ...prev, [s]: Math.max(0, parseInt(e.target.value) || 0) }))}
                          onFocus={e => e.target.select()}
                          autoFocus={idx === 0}
                          tabIndex={idx + 1}
                          className="w-full text-center py-2.5 text-[13px] font-semibold text-on-surface focus:outline-none focus:bg-primary/5 bg-transparent"
                          placeholder="0" />
                        )}
                      </td>
                      )
                    })}</tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── ATENÇÃO: Observação do produto ── */}
          {product.observation && (
            <div className="mx-0 bg-red-600 px-5 py-3 flex items-center gap-3 rounded-xl">
              <span className="text-white text-[18px] flex-shrink-0">⚠️</span>
              <p className="text-white font-black text-[14px] uppercase tracking-wide leading-tight">
                {product.observation}
              </p>
            </div>
          )}

          {/* ── Totais ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] text-outline font-medium mb-1">Preço Unit. (editável)</p>
              <div className="flex items-center border border-outline-variant rounded-lg overflow-hidden bg-white focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/30">
                <span className="pl-3 text-[12px] text-outline/60">R$</span>
                <input
                  type="text" inputMode="decimal"
                  defaultValue={customPrice.toFixed(2).replace('.', ',')}
                  key={`cp-${product.id}`}
                  onBlur={e => {
                    const raw = e.target.value.replace(',', '.')
                    const v = parseFloat(raw)
                    if (!isNaN(v) && v > 0) {
                      setCustomPrice(v)
                      e.target.value = v.toFixed(2).replace('.', ',')
                    } else {
                      e.target.value = customPrice.toFixed(2).replace('.', ',')
                    }
                  }}
                  onFocus={e => e.target.select()}
                  className="flex-1 px-2 py-2 text-[12px] font-semibold text-on-surface focus:outline-none bg-transparent"
                />
              </div>
            </div>
            <div>
              <p className="text-[11px] text-outline font-medium mb-1">Total</p>
              <div className="px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg text-[12px] font-bold text-primary">
                {fmtN(totalValue)}
              </div>
            </div>
          </div>

          {/* ── Observação ── */}
          <div>
            <p className="text-[11px] text-outline font-medium mb-1">Observação</p>
            <textarea
              value={observation}
              onChange={e => setObservation(e.target.value)}
              rows={2}
              placeholder="Observação para este item..."
              className="w-full border border-outline-variant rounded-xl px-3 py-2 text-[12px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
            />
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 border-t border-outline-variant flex-shrink-0 flex items-center justify-end gap-3 bg-surface-container-low">
          <button onClick={onClose} className="text-[12px] text-outline hover:text-on-surface font-medium px-4 py-2">
            Cancelar
          </button>
          <Button
            disabled={totalPieces === 0}
            onClick={() => multiGradePack
              ? onAdd(product, mgFlat, 1, observation, customPrice, mgCustomGrade)
              : multiVariant
              ? onAdd(product, flatSizes, boxes, observation, customPrice, customGrade)
              : onAdd(product, safeSizes, boxes, observation, customPrice)}
            icon={<Check className="h-4 w-4" />}
          >
            {cartItem ? 'Atualizar' : 'Adicionar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
