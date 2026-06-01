import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
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
  WifiOff,
  AlertCircle,
  Info,
  X,
} from 'lucide-react'
import { clientsApi, priceTablesApi, productsApi, ordersApi, factoriesApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { db } from '../db/db'
import { Button } from '../components/ui/Button'
import { Input, MaskedInput, Textarea, Select } from '../components/ui/Input'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import { NewClientModal, CreatedClient } from '../components/ui/NewClientModal'
import { formatCurrency, formatPct } from '../utils/format'
import { maskPercent, parseDecimal } from '../utils/masks'

// ─── Helpers de ordenação de tamanhos ───────────────────────────────────────
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
  cnpj: string | null
  phone: string | null
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
}

interface DiscountRule {
  id: string
  discount_pct: number
  total_commission_pct: number
  rep_commission_pct: number
  office_commission_pct: number
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
  base_price: number
  image_url: string | null
  size_range: string | null
  grade_configs: GradeConfig[] | null
}

interface CartItem {
  product: Product
  boxes_count: number          // usado para packs
  sizes: Record<string, number> // usado para produtos regulares
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
                <thead className="bg-surface-container-low">
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
}: {
  sizes: Record<string, number>
  onChange: (size: string, value: number) => void
  onRemove: () => void
}) {
  const sizeKeys = sortSizes(Object.keys(sizes))
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
      <div className="overflow-x-auto">
        <table className="text-[12px] size-grid-table">
          <thead>
            <tr>
              {sizeKeys.map(s => (
                <th key={s} className="px-1 pb-0.5 text-center text-outline font-medium min-w-[36px]">{s}</th>
              ))}
              <th className="px-1 pb-0.5 text-center text-primary font-bold pl-2">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {sizeKeys.map((s, idx) => (
                <td key={s} className="px-0.5">
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
                </td>
              ))}
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
        <thead className="bg-surface-container-low">
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

// ─── Página principal ────────────────────────────────────────────────────────
export function NewOrder() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const [step, setStep] = useState(0)

  // Step 1: Client
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [showNewClient, setShowNewClient] = useState(false)

  // Step 2: Price table
  const [selectedFactory, setSelectedFactory] = useState('')
  const [selectedTable, setSelectedTable] = useState<PriceTable | null>(null)

  // Step 3: Products
  const [productSearch, setProductSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [expandedGrade, setExpandedGrade] = useState<string | null>(null)
  const [quickAddProduct, setQuickAddProduct] = useState<Product | null>(null)

  // Step 4: Review
  const [discountPct, setDiscountPct] = useState<string>('0')
  const [customDiscount, setCustomDiscount] = useState(false)
  const [cashDiscountPct, setCashDiscountPct] = useState<string>('0') // desconto à vista
  const [notes, setNotes] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [freightType, setFreightType] = useState('CIF')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [buyerName, setBuyerName] = useState('')
  const [industryOrderNumber, setIndustryOrderNumber] = useState('')

  const online = navigator.onLine

  // Queries
  const { data: clients, isLoading: loadingClients } = useQuery<Client[]>({
    queryKey: ['clients', clientSearch],
    queryFn: () => clientsApi.list(clientSearch || undefined).then((r) => r.data),
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
    // Desconto à vista NÃO mexe na comissão — comissão é sobre o desconto da tabela
    const tableDiscountedValue = grossValue * (1 - discountNum / 100)
    const totalValue = tableDiscountedValue * (1 - cashDiscountNum / 100)
    const rule = findMatchingRule(discountNum)
    return {
      totalPieces,
      grossValue,
      totalValue,
      repCommission: rule ? tableDiscountedValue * rule.rep_commission_pct / 100 : 0,
      officeCommission: rule ? tableDiscountedValue * rule.office_commission_pct / 100 : 0,
      totalCommission: rule ? tableDiscountedValue * rule.total_commission_pct / 100 : 0,
      rule,
    }
  }, [cart, effectiveDiscountNum, discountNum, cashDiscountNum, findMatchingRule])


  function removeFromCart(productId: string) {
    setCart(cart.filter((c) => c.product.id !== productId))
  }

  function updateSize(productId: string, size: string, value: number) {
    setCart(cart.map(c =>
      c.product.id === productId ? { ...c, sizes: { ...c.sizes, [size]: Math.max(0, value) } } : c
    ))
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
        })),
        discount_pct: effectiveDiscountNum,
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
    onSuccess: (result) => {
      if (result.online) {
        navigate(`/orders/${result.id}`)
      } else {
        navigate('/orders')
      }
    },
  })

  const totals = cartTotals()
  const factoryOptions = ((factories || []) as { id: string; name: string }[]).map((f) => ({
    value: f.id,
    label: f.name,
  }))

  return (
    <div className="pb-24 lg:pb-0 min-h-screen bg-surface-container-low">
      {/* Header */}
      <div className="bg-white border-b border-outline-variant px-4 py-2 lg:px-8 sticky top-0 z-10">
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
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h1 className="text-[12px] font-bold text-on-surface">Novo Pedido</h1>
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
                {(clients || []).map((c) => (
                  <Card
                    key={c.id}
                    padding="md"
                    onClick={() => {
                      setSelectedClient(c)
                      setStep(1)
                    }}
                    className={selectedClient?.id === c.id ? 'ring-2 ring-primary' : ''}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <span className="text-[12px] font-bold text-emerald-700">
                          {c.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-on-surface truncate">{c.name}</p>
                        {c.city && <p className="text-[12px] text-outline">{c.city}</p>}
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
                <div className="flex items-center gap-2">
                  <Badge variant="info">{cart.length} itens</Badge>
                  <Button size="sm" onClick={() => setStep(3)}>
                    Revisar <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            {/* Search + filter */}
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
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
                    <div key={p.id} id={`product-card-${p.id}`} className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
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
                      {cartItem && isRegular && (
                        <div className="px-3 pb-3 border-t border-outline-variant/50 pt-2 bg-primary/5">
                          <SizeGrid
                            sizes={cartItem.sizes}
                            onChange={(size, val) => updateSize(p.id, size, val)}
                            onRemove={() => removeFromCart(p.id)}
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
              <div className="fixed bottom-16 lg:bottom-6 left-0 right-0 lg:left-auto lg:right-8 lg:max-w-xs px-3 lg:px-0 z-40">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="w-full flex items-center justify-between bg-green-600 hover:bg-green-700 active:scale-[0.98] text-white rounded-2xl shadow-2xl px-5 py-3.5 transition-all"
                  style={{ boxShadow: '0 8px 32px rgba(22,163,74,0.5)' }}
                >
                  <div className="text-left">
                    <p className="text-xs font-medium text-green-100">{cart.length} item{cart.length > 1 ? 'ns' : ''} · {totals.totalPieces} pç</p>
                    <p className="text-lg font-bold leading-tight">{formatCurrency(totals.totalValue)}</p>
                  </div>
                  <div className="flex items-center gap-2 bg-white/20 rounded-xl px-4 py-2">
                    <span className="text-sm font-bold">Fechar Pedido</span>
                    <ChevronRight className="h-5 w-5" />
                  </div>
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
                        <div className="text-right flex-shrink-0">
                          <p className="text-[12px] font-bold text-on-surface">{formatCurrency(subtotal)}</p>
                          <p className="text-[12px] text-outline/70">R$ {Number(item.unit_price).toFixed(2)}/pç</p>
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
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  placeholder="Ex: 30/60/90 dias"
                  className={paymentTerms.trim()
                    ? 'w-full border border-outline-variant rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary'
                    : 'w-full border-2 border-amber-400 rounded-lg px-3 py-1.5 text-[12px] bg-amber-50 text-on-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-500'}
                />
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
              <div className="p-3 border-b border-outline-variant/50">
                <h3 className="text-[12px] font-semibold text-on-surface-variant mb-2">Desconto</h3>
                {discountRules.length > 0 && !customDiscount ? (
                  <div className="space-y-1">
                    <div className="grid grid-cols-2 gap-2">
                      {discountRules.map((rule) => {
                        const isSelected = parseDecimal(discountPct) === rule.discount_pct
                        const discountedTotal = totals.grossValue * (1 - rule.discount_pct / 100)
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
                                {isAdmin && rule.rep_commission_pct > 0 && (
                                  <p className="text-[12px] text-emerald-600 mt-0.5 leading-tight">
                                    com. {formatPct(rule.rep_commission_pct)}
                                  </p>
                                )}
                              </div>
                              {isSelected && <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                    <button
                      onClick={() => setCustomDiscount(true)}
                      className="text-[12px] text-primary hover:text-primary"
                    >
                      Digitar desconto personalizado
                    </button>
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

              {/* Desconto à Vista */}
              <div className="p-3 border-b border-outline-variant/50">
                <h3 className="text-[12px] font-semibold text-on-surface-variant mb-2">
                  Desconto à Vista
                </h3>
                <div className="flex items-center gap-3">
                  {/* Input numérico simples com % inline */}
                  <div className="flex items-center border border-outline-variant rounded-xl overflow-hidden bg-surface-container-lowest focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary transition-all" style={{ width: 110 }}>
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
                  {cashDiscountNum > 0 && (
                    <div className="text-[12px] text-emerald-700 font-medium">
                      −{formatCurrency(totals.grossValue * cashDiscountNum / 100)}
                    </div>
                  )}
                  {effectiveDiscountNum > 0 && cashDiscountNum > 0 && (
                    <div className="text-[12px] text-primary font-semibold">
                      Total: {formatPct(effectiveDiscountNum)}
                    </div>
                  )}
                </div>
              </div>

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
                    <span>Desconto à vista ({formatPct(cashDiscountNum)}):</span>
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
                  <div className="flex justify-between text-emerald-600 pt-1 border-t border-outline-variant">
                    <span>Comissão rep ({formatPct(totals.rule.rep_commission_pct)}):</span>
                    <span className="font-semibold">{formatCurrency(totals.repCommission)}</span>
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
          onAdd={(p, sizes, boxes, observation) => {
            const exists = cart.find(c => c.product.id === p.id)
            if (exists) {
              setCart(cart.map(c => c.product.id === p.id ? { ...c, sizes, boxes_count: boxes, observation } : c))
            } else {
              setCart([...cart, { product: p, boxes_count: boxes, sizes, unit_price: p.base_price, observation }])
            }
            setQuickAddProduct(null)
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
  onAdd: (p: Product, sizes: Record<string, number>, boxes: number, observation: string) => void
}) {
  const isPack = product.type === 'pack'

  // Para packs: grade selecionada (cor)
  const grades = product.grade_configs || []

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

  // Pack: total = TODAS as cores × caixas (ex: 6 cores × 6 pç/cor = 36 pç/cx)
  const totalPiecesPerBox = grades.reduce((s, g) => s + g.total_pieces, 0) || 0
  const totalPieces = isPack
    ? totalPiecesPerBox * boxes
    : Object.values(sizes).reduce((s, v) => s + v, 0)
  const totalValue = Number(product.base_price) * totalPieces

  const fmtR = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
  const fmtN = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(v)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && totalPieces > 0) {
        onAdd(product, sizes, boxes, observation)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onAdd, product, sizes, boxes, observation, totalPieces])

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
              {product.image_url
                ? <img src={product.image_url} alt={product.reference} className="w-full h-full object-cover" />
                : <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-outline/30" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              }
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-outline hover:bg-surface-container flex-shrink-0 -mt-1">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── PACK: tabela completa de cores × tamanhos ── */}
          {isPack && grades.length > 0 && (() => {
            const packSizes = sortSizes([...new Set(grades.flatMap(g => Object.keys(g.sizes).map(s => s.trim())))])
            const grandTotal = grades.reduce((s, g) => s + g.total_pieces, 0)
            return (
              <div>
                <p className="text-[11px] text-outline font-semibold uppercase tracking-wide mb-2">Grade do Pack</p>
                <div className="border border-outline-variant rounded-xl overflow-x-auto">
                  <table className="min-w-full text-[12px]">
                    <thead className="bg-surface-container-low">
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

          {/* ── REGULAR: grade de tamanhos por input ── */}
          {!isPack && allSizes.length > 0 && (
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
              <p className="text-[11px] text-outline font-semibold uppercase tracking-wide mb-2">Quantidades por tamanho</p>
              <div className="border border-outline-variant rounded-xl overflow-hidden">
                <table className="w-full" style={{ tableLayout: 'fixed' }}>
                  <thead className="bg-surface-container-low">
                    <tr>{allSizes.map(s => (
                      <th key={s} className="px-1 py-2 text-center text-[11px] font-bold text-outline border-r border-outline-variant/30 last:border-r-0">{s}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    <tr>{allSizes.map((s, idx) => (
                      <td key={s} className="border-r border-outline-variant/20 last:border-r-0 border-t border-outline-variant/20 p-0">
                        <input type="number" min="0"
                          value={sizes[s] || ''}
                          onChange={e => setSizes(prev => ({ ...prev, [s]: Math.max(0, parseInt(e.target.value) || 0) }))}
                          onFocus={e => e.target.select()}
                          tabIndex={idx + 1}
                          className="w-full text-center py-2.5 text-[13px] font-semibold text-on-surface focus:outline-none focus:bg-primary/5 bg-transparent"
                          placeholder="0" />
                      </td>
                    ))}</tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

                    {/* ── Totais ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] text-outline font-medium mb-1">Preço Unit.</p>
              <div className="px-3 py-2 bg-surface-container-low border border-outline-variant/50 rounded-lg text-[12px] font-semibold text-on-surface">
                {fmtN(Number(product.base_price))}
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
            onClick={() => onAdd(product, sizes, boxes, observation)}
            icon={<Check className="h-4 w-4" />}
          >
            {cartItem ? 'Atualizar' : 'Adicionar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
