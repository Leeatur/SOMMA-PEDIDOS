import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  Image as ImageIcon,
  Clock,
  User,
  Building2,
  Tag,
  MessageSquare,
  TrendingUp,
  Check,
  ChevronDown,
  Printer,
  Plus,
  Minus,
  Trash2,
  Search,
  Info,
} from 'lucide-react'
import { ordersApi, statusesApi, productsApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { StatusBadge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Select, Textarea, Input } from '../components/ui/Input'
import { PageSpinner } from '../components/ui/Spinner'
import { formatCurrency, formatDateTime, formatOrderNumber, formatPct } from '../utils/format'

interface GradeConfig {
  id: string
  color: string | null
  sizes: Record<string, number>
  total_pieces: number
  sort_order: number
}

interface OrderItem {
  id: string
  product_id: string
  reference: string
  product_name: string | null
  type: 'regular' | 'pack'
  image_url: string | null
  boxes_count: number
  unit_price: number
  total_pieces: number
  subtotal: number
  sizes: Record<string, number> | null
  grade_configs: GradeConfig[] | null
}

interface StatusHistory {
  id: string
  changed_by_name: string
  from_status_name: string | null
  to_status_name: string
  to_status_color: string
  notes: string | null
  created_at: string
}

interface OrderDetail {
  id: string
  order_number: number
  price_table_id: string
  client_name: string
  client_city: string | null
  client_phone: string | null
  rep_name: string
  factory_name: string
  price_table_name: string
  discount_pct: number
  total_commission_pct: number
  rep_commission_pct: number
  office_commission_pct: number
  total_pieces: number
  total_value: number
  rep_commission_value: number
  office_commission_value: number
  notes: string | null
  status_name: string | null
  status_color: string | null
  status_id: string | null
  created_at: string
  items: OrderItem[]
  history: StatusHistory[]
}

interface Status { id: string; name: string; color: string }

interface Product {
  id: string
  reference: string
  type: 'regular' | 'pack'
  product_name: string | null
  base_price: number
  image_url: string | null
  grade_configs: Array<{ id: string; color: string | null; sizes: Record<string, number>; total_pieces: number; sort_order: number }> | null
}

interface AddCartItem { product: Product; boxes_count: number; sizes: Record<string, number> }

const SIZE_ORDER_DETAIL = [
  'RN','PP','XP','P','M','G','GG','XG','EXG','XGG','2XG','3XG','4XG',
  '34','36','38','40','42','44','46','48','50','52','54','56','58','60',
  '1','2','4','6','8','10','12','14','16','18','U',
]
function sortSizesDetail(sizes: string[]) {
  return [...sizes].sort((a, b) => {
    const ai = SIZE_ORDER_DETAIL.indexOf(a.toUpperCase())
    const bi = SIZE_ORDER_DETAIL.indexOf(b.toUpperCase())
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}
function initSizesDetail(product: Product): Record<string, number> {
  if (!product.grade_configs || product.grade_configs.length === 0) return {}
  const allSizes = new Set<string>()
  product.grade_configs.forEach(gc => Object.keys(gc.sizes).forEach(s => allSizes.add(s)))
  return Object.fromEntries(sortSizesDetail([...allSizes]).map(s => [s, 0]))
}

function GradeDisplay({ configs, boxCount }: { configs: GradeConfig[]; boxCount: number }) {
  return (
    <div className="space-y-2 mt-2">
      {configs.map((gc, i) => {
        const sizes = Object.keys(gc.sizes).sort()
        return (
          <div key={i}>
            {gc.color && <p className="text-xs font-medium text-gray-600 mb-1">{gc.color}</p>}
            <div className="overflow-x-auto scrollbar-hide">
              <table className="min-w-max text-xs border border-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-50">
                  <tr>
                    {sizes.map((s) => (
                      <th key={s} className="px-2 py-1 text-center text-gray-600 font-medium min-w-[28px]">{s}</th>
                    ))}
                    <th className="px-2 py-1 text-center text-gray-500 border-l border-gray-200">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-white">
                    {sizes.map((s) => (
                      <td key={s} className="px-2 py-1.5 text-center">{gc.sizes[s] * boxCount}</td>
                    ))}
                    <td className="px-2 py-1.5 text-center font-bold border-l border-gray-200">
                      {gc.total_pieces * boxCount}
                    </td>
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

export function OrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const [statusModal, setStatusModal] = useState(false)
  const [newStatusId, setNewStatusId] = useState('')
  const [statusNotes, setStatusNotes] = useState('')
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [addItemsModal, setAddItemsModal] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [addCart, setAddCart] = useState<AddCartItem[]>([])
  const [expandedGrade, setExpandedGrade] = useState<string | null>(null)

  const { data: order, isLoading } = useQuery<OrderDetail>({
    queryKey: ['order', id],
    queryFn: () => ordersApi.get(id!).then((r) => r.data),
    enabled: !!id,
  })

  const { data: statuses } = useQuery<Status[]>({
    queryKey: ['statuses'],
    queryFn: () => statusesApi.list().then((r) => r.data),
  })

  const updateStatusMut = useMutation({
    mutationFn: () => ordersApi.updateStatus(id!, newStatusId, statusNotes || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order', id] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      setStatusModal(false)
      setNewStatusId('')
      setStatusNotes('')
    },
  })

  const addItemsMut = useMutation({
    mutationFn: () => ordersApi.addItems(id!, addCart.map(c => ({
      product_id: c.product.id,
      reference: c.product.reference,
      boxes_count: c.boxes_count,
      unit_price: c.product.base_price,
      sizes: c.product.type === 'regular' ? c.sizes : undefined,
    }))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order', id] })
      setAddItemsModal(false)
      setAddCart([])
      setProductSearch('')
    },
  })

  const { data: addProducts, isLoading: loadingAddProducts } = useQuery<Product[]>({
    queryKey: ['products-add', order?.price_table_id, productSearch],
    queryFn: () => productsApi.list({ price_table_id: order!.price_table_id, search: productSearch || undefined }).then(r => r.data),
    enabled: addItemsModal && !!order?.price_table_id,
  })

  const addToCart = useCallback((product: Product) => {
    setAddCart(prev => {
      const ex = prev.find(c => c.product.id === product.id)
      if (ex) return prev
      const sizes = product.type === 'regular' ? initSizesDetail(product) : {}
      return [...prev, { product, boxes_count: 1, sizes }]
    })
  }, [])

  const updateAddSize = useCallback((productId: string, size: string, value: number) => {
    setAddCart(prev => prev.map(c =>
      c.product.id === productId ? { ...c, sizes: { ...c.sizes, [size]: Math.max(0, value) } } : c
    ))
  }, [])

  const removeFromAddCart = useCallback((productId: string) => {
    setAddCart(prev => prev.filter(c => c.product.id !== productId))
  }, [])

  const updateAddCount = useCallback((productId: string, delta: number) => {
    setAddCart(prev => prev.map(c => {
      if (c.product.id !== productId) return c
      const next = Math.max(1, c.boxes_count + delta)
      return { ...c, boxes_count: next }
    }))
  }, [])

  function toggleItem(itemId: string) {
    const next = new Set(expandedItems)
    if (next.has(itemId)) next.delete(itemId)
    else next.add(itemId)
    setExpandedItems(next)
  }

  if (isLoading) return <PageSpinner />
  if (!order) return (
    <div className="p-8 text-center text-gray-500">Pedido não encontrado</div>
  )

  const statusOptions = (statuses || []).map((s) => ({ value: s.id, label: s.name }))

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 lg:px-8 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-bold text-gray-900">
                {formatOrderNumber(order.order_number)}
              </h1>
              {order.status_name && order.status_color && (
                <StatusBadge name={order.status_name} color={order.status_color} />
              )}
            </div>
          </div>
          <button
            onClick={() => window.open(`/orders/${id}/print`, '_blank')}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-indigo-500 transition-colors"
            title="Imprimir pedido"
          >
            <Printer className="h-4.5 w-4.5" />
          </button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddItemsModal(true)}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            Itens
          </Button>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setStatusModal(true); setNewStatusId(order.status_id || '') }}
              icon={<ChevronDown className="h-3.5 w-3.5" />}
            >
              Status
            </Button>
          )}
        </div>
      </div>

      <div className="px-4 py-5 lg:px-8 max-w-3xl mx-auto space-y-5">
        {/* Client + Meta */}
        <Card padding="md">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="col-span-2">
              <p className="text-xs text-gray-500 mb-0.5">Cliente</p>
              <p className="font-semibold text-gray-900">{order.client_name}</p>
              {order.client_city && (
                <p className="text-xs text-gray-500">{order.client_city}</p>
              )}
              {order.client_phone && (
                <a
                  href={`tel:${order.client_phone}`}
                  className="text-xs text-indigo-500 hover:underline"
                >
                  {order.client_phone}
                </a>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                <User className="h-3 w-3" /> Representante
              </p>
              <p className="font-medium text-gray-800">{order.rep_name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                <Building2 className="h-3 w-3" /> Fábrica
              </p>
              <p className="font-medium text-gray-800">{order.factory_name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                <Tag className="h-3 w-3" /> Tabela
              </p>
              <p className="font-medium text-gray-800 truncate">{order.price_table_name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                <Clock className="h-3 w-3" /> Data
              </p>
              <p className="font-medium text-gray-800">{formatDateTime(order.created_at)}</p>
            </div>
          </div>
          {order.notes && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                <MessageSquare className="h-3 w-3" /> Observações
              </p>
              <p className="text-sm text-gray-700">{order.notes}</p>
            </div>
          )}
        </Card>

        {/* Financial summary */}
        <Card padding="md">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-gray-900">Resumo Financeiro</h2>
          </div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Desconto aplicado:</span>
              <span className="font-medium">{formatPct(order.discount_pct)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 text-base">
              <span>Total do Pedido:</span>
              <span>{formatCurrency(order.total_value)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Total de Peças:</span>
              <span>{order.total_pieces} pç</span>
            </div>
          </div>
        </Card>

        {/* Items */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Itens do Pedido ({order.items.length})
          </h2>
          <div className="space-y-2">
            {order.items.map((item) => {
              const isExpanded = expandedItems.has(item.id)
              return (
                <div key={item.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <button
                    className="w-full text-left p-3"
                    onClick={() => toggleItem(item.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 bg-gray-100 rounded-lg flex-shrink-0 overflow-hidden">
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.reference} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300">
                            <ImageIcon className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-sm">{item.reference}</p>
                        {item.product_name && (
                          <p className="text-xs text-gray-500 truncate">{item.product_name}</p>
                        )}
                        {item.type === 'regular' && item.sizes && Object.values(item.sizes).some(v => v > 0) ? (
                          <p className="text-xs text-gray-500 mt-0.5">{item.total_pieces} peças</p>
                        ) : (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {item.boxes_count} cx × {Math.round(item.total_pieces / Math.max(item.boxes_count,1))} pç/cx = {item.total_pieces} peças
                          </p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-gray-900">{formatCurrency(item.subtotal)}</p>
                        <p className="text-xs text-gray-400">R$ {Number(item.unit_price).toFixed(2)}/pç</p>
                        <ChevronDown className={`h-3.5 w-3.5 text-gray-400 ml-auto mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-gray-100 pt-2">
                      {item.type === 'regular' && item.sizes && Object.values(item.sizes).some(v => v > 0) ? (
                        <>
                          <p className="text-xs font-medium text-gray-600 mb-1.5">Quantidades por tamanho:</p>
                          <div className="overflow-x-auto scrollbar-hide">
                            <table className="min-w-max text-xs border border-gray-200 rounded-lg overflow-hidden">
                              <thead className="bg-gray-50">
                                <tr>{sortSizesDetail(Object.keys(item.sizes).filter(s => (item.sizes![s]||0) > 0)).map(s => (
                                  <th key={s} className="px-2 py-1 text-center text-gray-600 font-medium min-w-[28px]">{s}</th>
                                ))}<th className="px-2 py-1 text-center text-gray-500 border-l border-gray-200">Total</th></tr>
                              </thead>
                              <tbody>
                                <tr className="bg-white">{sortSizesDetail(Object.keys(item.sizes).filter(s => (item.sizes![s]||0) > 0)).map(s => (
                                  <td key={s} className="px-2 py-1 text-center">{item.sizes![s]}</td>
                                ))}<td className="px-2 py-1 text-center font-bold border-l border-gray-200">{item.total_pieces}</td></tr>
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : item.grade_configs && item.grade_configs.length > 0 ? (
                        <>
                          <p className="text-xs font-medium text-gray-600 mb-1.5">Composição da grade:</p>
                          <GradeDisplay configs={item.grade_configs} boxCount={item.boxes_count} />
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Status History */}
        {order.history.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Histórico de Status</h2>
            <div className="space-y-2">
              {order.history.map((h) => (
                <div key={h.id} className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: h.to_status_color + '22', border: `1px solid ${h.to_status_color}44` }}
                    >
                      <Check className="h-3 w-3" style={{ color: h.to_status_color }} />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge name={h.to_status_name} color={h.to_status_color} />
                      {h.from_status_name && (
                        <span className="text-xs text-gray-400">← {h.from_status_name}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {h.changed_by_name} &bull; {formatDateTime(h.created_at)}
                    </p>
                    {h.notes && (
                      <p className="text-xs text-gray-600 mt-0.5 italic">"{h.notes}"</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Modal Adicionar Itens ── */}
      <Modal
        open={addItemsModal}
        onClose={() => { setAddItemsModal(false); setAddCart([]); setProductSearch('') }}
        title={`Adicionar Itens — ${order.price_table_name}`}
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-500">
              {addCart.length > 0 ? `${addCart.length} produto${addCart.length > 1 ? 's' : ''} selecionado${addCart.length > 1 ? 's' : ''}` : 'Selecione os produtos'}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setAddItemsModal(false); setAddCart([]) }}>Cancelar</Button>
              <Button
                disabled={addCart.length === 0}
                loading={addItemsMut.isPending}
                onClick={() => addItemsMut.mutate()}
                icon={<Plus className="h-4 w-4" />}
              >
                Adicionar ao Pedido
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          <Input
            placeholder="Buscar referência ou nome..."
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            autoFocus
          />

          {/* Carrinho temporário */}
          {addCart.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">Itens a adicionar</p>
              {addCart.map(c => {
                const isRegular = c.product.type === 'regular'
                const piecesPerBox = c.product.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 1
                const totalPieces = isRegular
                  ? Object.values(c.sizes).reduce((s, v) => s + (v || 0), 0)
                  : c.boxes_count * piecesPerBox
                return (
                  <div key={c.product.id} className="bg-white rounded-lg px-3 py-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{c.product.reference}</p>
                        <p className="text-xs text-gray-500">{totalPieces} pç</p>
                      </div>
                      {!isRegular && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => updateAddCount(c.product.id, -1)} className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center hover:bg-gray-200">
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-8 text-center text-sm font-bold">{c.boxes_count}</span>
                          <button onClick={() => updateAddCount(c.product.id, 1)} className="w-6 h-6 rounded bg-indigo-100 flex items-center justify-center hover:bg-indigo-200">
                            <Plus className="h-3 w-3 text-indigo-600" />
                          </button>
                        </div>
                      )}
                      <button onClick={() => removeFromAddCart(c.product.id)} className="w-6 h-6 rounded text-red-400 hover:bg-red-50 flex items-center justify-center">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    {isRegular && (
                      <div className="overflow-x-auto">
                        <table className="text-xs">
                          <thead>
                            <tr>{sortSizesDetail(Object.keys(c.sizes)).map(s => (
                              <th key={s} className="px-1 pb-0.5 text-center text-gray-500 font-medium min-w-[34px]">{s}</th>
                            ))}<th className="px-1 pb-0.5 text-center text-indigo-500 font-bold pl-1">Tot</th></tr>
                          </thead>
                          <tbody>
                            <tr>{sortSizesDetail(Object.keys(c.sizes)).map(s => (
                              <td key={s} className="px-0.5">
                                <input type="number" min="0" value={c.sizes[s] || 0}
                                  onChange={e => updateAddSize(c.product.id, s, parseInt(e.target.value) || 0)}
                                  className="w-8 h-6 text-center border border-gray-200 rounded text-xs font-bold focus:outline-none focus:ring-1 focus:ring-blue-400" />
                              </td>
                            ))}<td className="px-1 pl-1 text-center font-bold text-indigo-600">{totalPieces}</td></tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Catálogo */}
          <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
            {loadingAddProducts ? (
              <div className="text-center py-6 text-sm text-gray-400">Carregando produtos…</div>
            ) : (addProducts || []).map(p => {
              const inCart = addCart.find(c => c.product.id === p.id)
              const piecesPerBox = p.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 0
              const isExpanded = expandedGrade === p.id
              return (
                <div key={p.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-12 h-12 bg-gray-100 rounded-lg flex-shrink-0 overflow-hidden">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.reference} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                          <ImageIcon className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-gray-900">{p.reference}</p>
                      {p.product_name && <p className="text-xs text-gray-500 truncate">{p.product_name}</p>}
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-indigo-600">R$ {Number(p.base_price).toFixed(2)}<span className="text-xs text-gray-400 font-normal">/pç</span></p>
                        {piecesPerBox > 0 && (
                          <button onClick={() => setExpandedGrade(isExpanded ? null : p.id)} className="text-xs text-gray-400 flex items-center gap-0.5 hover:text-gray-600">
                            <Info className="h-3 w-3" />{piecesPerBox} pç/cx
                          </button>
                        )}
                      </div>
                    </div>
                    {inCart ? (
                      p.type === 'regular' ? (
                        <button onClick={() => removeFromAddCart(p.id)} className="w-7 h-7 rounded-lg text-red-400 hover:bg-red-50 flex items-center justify-center flex-shrink-0">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => updateAddCount(p.id, -1)} className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200">
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-8 text-center font-bold text-sm">{inCart.boxes_count}</span>
                          <button onClick={() => updateAddCount(p.id, 1)} className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center hover:bg-indigo-200">
                            <Plus className="h-3.5 w-3.5 text-indigo-600" />
                          </button>
                          <button onClick={() => removeFromAddCart(p.id)} className="w-7 h-7 rounded-lg text-red-400 hover:bg-red-50 flex items-center justify-center">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )
                    ) : (
                      <button onClick={() => addToCart(p)} className="flex-shrink-0 flex items-center gap-1 bg-indigo-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-indigo-700">
                        <Plus className="h-3.5 w-3.5" /> Add
                      </button>
                    )}
                  </div>
                  {isExpanded && p.grade_configs && (
                    <div className="px-3 pb-3 border-t border-gray-100 pt-2">
                      <GradeDisplay configs={p.grade_configs} boxCount={inCart?.boxes_count || 1} />
                    </div>
                  )}
                </div>
              )
            })}
            {!loadingAddProducts && (addProducts || []).length === 0 && (
              <p className="text-center text-sm text-gray-400 py-4">Nenhum produto encontrado</p>
            )}
          </div>
        </div>
      </Modal>

      {/* Status Change Modal */}
      <Modal
        open={statusModal}
        onClose={() => setStatusModal(false)}
        title="Alterar Status"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setStatusModal(false)}>Cancelar</Button>
            <Button
              onClick={() => updateStatusMut.mutate()}
              loading={updateStatusMut.isPending}
              disabled={!newStatusId}
            >
              Confirmar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Select
            label="Novo Status"
            options={statusOptions}
            value={newStatusId}
            onChange={(e) => setNewStatusId(e.target.value)}
            placeholder="Selecione o status"
          />
          {newStatusId && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Novo status:</span>
              {statuses?.find((s) => s.id === newStatusId) && (
                <StatusBadge
                  name={statuses.find((s) => s.id === newStatusId)!.name}
                  color={statuses.find((s) => s.id === newStatusId)!.color}
                />
              )}
            </div>
          )}
          <Textarea
            label="Observação (opcional)"
            value={statusNotes}
            onChange={(e) => setStatusNotes(e.target.value)}
            placeholder="Motivo da alteração..."
            rows={2}
          />
        </div>
      </Modal>
    </div>
  )
}
