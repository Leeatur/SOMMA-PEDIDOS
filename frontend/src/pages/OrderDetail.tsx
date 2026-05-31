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
  Pencil,
  CalendarDays,
  CreditCard,
  Truck,
  RefreshCw,
  AlertTriangle,
  Copy,
} from 'lucide-react'
import { ordersApi, statusesApi, productsApi, clientsApi, priceTablesApi, usersApi } from '../api/client'
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
  rep_id: string
  rep_name: string
  factory_id: string
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
  payment_terms: string | null
  delivery_date: string | null
  freight_type: string | null
  buyer_name: string | null
  industry_order_number: string | null
  status_name: string | null
  status_color: string | null
  status_id: string | null
  created_at: string
  items: OrderItem[]
  history: StatusHistory[]
}

interface EditInfoForm {
  payment_terms: string
  delivery_date: string
  freight_type: string
  buyer_name: string
  industry_order_number: string
  notes: string
  client_id: string
  client_search: string
  rep_id: string
  discount_pct: string
}
interface ClientOption { id: string; name: string; trade_name: string | null; city: string | null }
interface UserOption { id: string; name: string; role: string }

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
    <div className="space-y-1 mt-2">
      {configs.map((gc, i) => {
        const sizes = Object.keys(gc.sizes).sort()
        return (
          <div key={i}>
            {gc.color && <p className="text-[11px] font-medium text-on-surface-variant mb-1">{gc.color}</p>}
            <div className="overflow-x-auto scrollbar-hide">
              <table className="min-w-max text-[11px] border border-outline-variant rounded-lg overflow-hidden">
                <thead className="bg-surface-container-low">
                  <tr>
                    {sizes.map((s) => (
                      <th key={s} className="px-2 py-1 text-center text-on-surface-variant font-medium min-w-[28px]">{s}</th>
                    ))}
                    <th className="px-2 py-1 text-center text-outline border-l border-outline-variant">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-white">
                    {sizes.map((s) => (
                      <td key={s} className="px-2 py-1.5 text-center">{gc.sizes[s] * boxCount}</td>
                    ))}
                    <td className="px-2 py-1.5 text-center font-bold border-l border-outline-variant">
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
  const [deleteModal, setDeleteModal] = useState(false)
  const [editInfoModal, setEditInfoModal] = useState(false)
  const [editInfoForm, setEditInfoForm] = useState<EditInfoForm>({
    payment_terms: '',
    delivery_date: '',
    freight_type: 'CIF',
    buyer_name: '',
    industry_order_number: '',
    notes: '',
    client_id: '',
    client_search: '',
    rep_id: '',
    discount_pct: '0',
  })
  const [removeItemId, setRemoveItemId] = useState<string | null>(null)
  const [changePtModal, setChangePtModal] = useState(false)
  const [newPriceTableId, setNewPriceTableId] = useState('')
  const [newDiscountPct, setNewDiscountPct] = useState('')
  const [editDiscountModal, setEditDiscountModal] = useState(false)
  const [editDiscountValue, setEditDiscountValue] = useState('')

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

  const deleteMut = useMutation({
    mutationFn: () => ordersApi.delete(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      navigate('/orders', { replace: true })
    },
  })

  const duplicateMut = useMutation({
    mutationFn: () => ordersApi.duplicate(id!),
    onSuccess: (res) => {
      const newId = res.data?.id
      if (!newId) { alert('Erro: ID do pedido duplicado não retornado'); return }
      qc.invalidateQueries({ queryKey: ['orders'] })
      navigate(`/orders/${newId}/edit`)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(`Erro ao duplicar pedido: ${msg || 'tente novamente'}`)
    },
  })

  const updateInfoMut = useMutation({
    mutationFn: async () => {
      const newDiscount = parseFloat(editInfoForm.discount_pct.replace(',', '.')) || 0
      // Se desconto mudou, chama changePriceTable para recalcular itens
      if (Math.abs(newDiscount - (order?.discount_pct || 0)) > 0.0001) {
        await ordersApi.changePriceTable(id!, order!.price_table_id, newDiscount)
      }
      return ordersApi.updateInfo(id!, {
        payment_terms: editInfoForm.payment_terms || null,
        delivery_date: editInfoForm.delivery_date || null,
        freight_type: editInfoForm.freight_type || 'CIF',
        buyer_name: editInfoForm.buyer_name || null,
        industry_order_number: editInfoForm.industry_order_number || null,
        notes: editInfoForm.notes || null,
        client_id: editInfoForm.client_id || null,
        rep_id: (editInfoForm.rep_id && editInfoForm.rep_id !== order?.rep_id) ? editInfoForm.rep_id : null,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order', id] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      setEditInfoModal(false)
    },
  })

  const removeItemMut = useMutation({
    mutationFn: (item_id: string) => ordersApi.removeItem(id!, item_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order', id] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      setRemoveItemId(null)
    },
  })

  // Tabelas disponíveis para trocar (mesma fábrica)
  const { data: factoryPriceTables } = useQuery<Array<{ id: string; name: string; collection: string | null }>>({
    queryKey: ['price-tables-factory', order?.factory_id],
    queryFn: () => priceTablesApi.list(order!.factory_id).then(r => r.data),
    enabled: changePtModal && !!order?.factory_id,
  })

  const changePtMut = useMutation({
    mutationFn: () => ordersApi.changePriceTable(
      id!,
      newPriceTableId,
      parseFloat(newDiscountPct) || 0,
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order', id] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      setChangePtModal(false)
      setNewPriceTableId('')
      setNewDiscountPct('')
    },
  })

  const editDiscountMut = useMutation({
    mutationFn: () => ordersApi.changePriceTable(
      id!,
      order!.price_table_id,
      parseFloat(editDiscountValue.replace(',', '.')) || 0,
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order', id] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      setEditDiscountModal(false)
    },
  })

  // Busca de clientes para trocar no pedido
  const { data: clientResults } = useQuery<ClientOption[]>({
    queryKey: ['clients-search-order', editInfoForm.client_search],
    queryFn: () => clientsApi.list(editInfoForm.client_search).then(r => r.data),
    enabled: editInfoModal && editInfoForm.client_search.length >= 2,
  })

  // Lista de usuários para trocar representante (admin only)
  const { data: usersList } = useQuery<UserOption[]>({
    queryKey: ['users-list'],
    queryFn: () => usersApi.list().then(r => r.data),
    enabled: editInfoModal && isAdmin,
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
    <div className="p-8 text-center text-outline">Pedido não encontrado</div>
  )

  const statusOptions = (statuses || []).map((s) => ({ value: s.id, label: s.name }))

  return (
    <div className="pb-24 lg:pb-0">
      {/* ── Mobile Header ── */}
      <div className="lg:hidden bg-white/90 border-b border-border-subtle px-4 py-2 sticky top-0 z-10" style={{ backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="w-10 h-10 flex items-center justify-center rounded-full text-primary hover:bg-surface-container transition-colors active:scale-95">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h1 className="text-lg font-bold text-primary" style={{ fontFamily: 'Plus Jakarta Sans' }}>Detalhes do Pedido</h1>
          </div>
          <button
            onClick={() => window.open(`/orders/${id}/print`, '_blank')}
            className="w-10 h-10 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            <Printer className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ── Desktop Header ── */}
      <div className="hidden lg:block bg-white border-b border-outline-variant px-8 py-2 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg text-outline hover:bg-surface-container">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[11px] font-bold text-on-surface">{formatOrderNumber(order.order_number)}</h1>
              {order.status_name && order.status_color && (
                <StatusBadge name={order.status_name} color={order.status_color} />
              )}
            </div>
          </div>
          <button onClick={() => window.open(`/orders/${id}/print`, '_blank')} className="p-1.5 rounded-lg text-outline hover:bg-surface-container hover:text-primary transition-colors" title="Imprimir pedido">
            <Printer className="h-4.5 w-4.5" />
          </button>
          <Button size="sm" variant="outline" onClick={() => duplicateMut.mutate()} icon={<Copy className="h-3.5 w-3.5" />} disabled={duplicateMut.isPending}>
            {duplicateMut.isPending ? 'Duplicando…' : 'Duplicar Pedido'}
          </Button>
          <Button size="sm" variant="primary" onClick={() => navigate(`/orders/${id}/edit`)} icon={<Pencil className="h-3.5 w-3.5" />}>Editar</Button>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => { setStatusModal(true); setNewStatusId(order.status_id || '') }} icon={<ChevronDown className="h-3.5 w-3.5" />}>Status</Button>
          )}
          <button onClick={() => setDeleteModal(true)} className="p-1.5 rounded-lg text-red-300 hover:bg-red-50 hover:text-red-500 transition-colors" title="Excluir pedido">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Mobile: Order status card ── */}
      <div className="lg:hidden px-4 pt-4">
        <div className="bg-white border border-border-subtle rounded-xl p-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <span className="text-[11px] font-bold text-outline uppercase tracking-wide">Pedido</span>
              <p className="text-lg font-bold text-on-surface leading-tight mt-0.5">{formatOrderNumber(order.order_number)}</p>
            </div>
            {order.status_name && order.status_color ? (
              <span
                className="px-3 py-1 rounded-full text-[11px] font-bold uppercase"
                style={{ backgroundColor: order.status_color + '22', color: order.status_color }}
              >
                {order.status_name}
              </span>
            ) : (
              isAdmin && (
                <button
                  onClick={() => { setStatusModal(true); setNewStatusId(order.status_id || '') }}
                  className="px-3 py-1 rounded-full text-[11px] font-bold uppercase bg-surface-container text-on-surface-variant border border-outline-variant"
                >
                  + Status
                </button>
              )
            )}
          </div>
          <div className="flex items-center gap-2 text-on-surface-variant">
            <Clock className="h-4 w-4" />
            <span className="text-[11px]">{formatDateTime(order.created_at)}</span>
          </div>
          {isAdmin && order.status_name && (
            <button
              onClick={() => { setStatusModal(true); setNewStatusId(order.status_id || '') }}
              className="mt-2 text-[11px] text-primary font-medium flex items-center gap-1 hover:underline"
            >
              <RefreshCw className="h-3 w-3" /> Alterar status
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-5 lg:px-8 max-w-3xl mx-auto space-y-1.5">
        {/* Client + Meta */}
        <Card padding="md">
          <div className="flex items-start justify-between mb-3">
            <p className="text-[11px] font-semibold text-outline uppercase tracking-wide">Informações do Pedido</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-[11px] select-text">
            <div className="col-span-2">
              <p className="text-[11px] text-outline mb-0.5">Cliente</p>
              <p className="font-semibold text-on-surface">{order.client_name}</p>
              {order.client_city && (
                <p className="text-[11px] text-outline">{order.client_city}</p>
              )}
              {order.client_phone && (
                <a
                  href={`tel:${order.client_phone}`}
                  className="text-[11px] text-primary hover:underline"
                >
                  {order.client_phone}
                </a>
              )}
            </div>
            <div>
              <p className="text-[11px] text-outline mb-0.5 flex items-center gap-1">
                <User className="h-3 w-3" /> Representante
              </p>
              <p className="font-medium text-on-surface">{order.rep_name}</p>
            </div>
            <div>
              <p className="text-[11px] text-outline mb-0.5 flex items-center gap-1">
                <Building2 className="h-3 w-3" /> Fábrica
              </p>
              <p className="font-medium text-on-surface">{order.factory_name}</p>
            </div>
            <div>
              <p className="text-[11px] text-outline mb-0.5 flex items-center gap-1">
                <Tag className="h-3 w-3" /> Tabela
              </p>
              <div className="flex items-center gap-2">
                <p className="font-medium text-on-surface truncate">{order.price_table_name}</p>
                {isAdmin && (
                  <button
                    onClick={() => {
                      setNewPriceTableId(order.price_table_id)
                      setNewDiscountPct(String(order.discount_pct))
                      setChangePtModal(true)
                    }}
                    className="p-1 rounded-lg text-outline hover:text-primary hover:bg-primary/10 transition-colors flex-shrink-0"
                    title="Trocar tabela de preços"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-outline mb-0.5 flex items-center gap-1">
                <Clock className="h-3 w-3" /> Emissão
              </p>
              <p className="font-medium text-on-surface">{formatDateTime(order.created_at)}</p>
            </div>

            {/* Campos de realização do pedido */}
            {order.delivery_date && (
              <div>
                <p className="text-[11px] text-outline mb-0.5 flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" /> Data de Entrega
                </p>
                <p className="font-medium text-on-surface">
                  {new Date(order.delivery_date.substring(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR')}
                </p>
              </div>
            )}
            {order.payment_terms && (
              <div>
                <p className="text-[11px] text-outline mb-0.5 flex items-center gap-1">
                  <CreditCard className="h-3 w-3" /> Cond. de Pagamento
                </p>
                <p className="font-medium text-on-surface">{order.payment_terms}</p>
              </div>
            )}
            {order.freight_type && (
              <div>
                <p className="text-[11px] text-outline mb-0.5 flex items-center gap-1">
                  <Truck className="h-3 w-3" /> Frete
                </p>
                <p className="font-medium text-on-surface">{order.freight_type}</p>
              </div>
            )}
            {order.buyer_name && (
              <div>
                <p className="text-[11px] text-outline mb-0.5 flex items-center gap-1">
                  <User className="h-3 w-3" /> Comprador
                </p>
                <p className="font-medium text-on-surface">{order.buyer_name}</p>
              </div>
            )}
            {order.industry_order_number && (
              <div className="col-span-2">
                <p className="text-[11px] text-outline mb-0.5 flex items-center gap-1">
                  <Tag className="h-3 w-3" /> N° Pedido Indústria
                </p>
                <p className="font-medium text-on-surface">{order.industry_order_number}</p>
              </div>
            )}
          </div>
          {order.notes && (
            <div className="mt-3 pt-3 border-t border-outline-variant/50">
              <p className="text-[11px] text-outline flex items-center gap-1 mb-1">
                <MessageSquare className="h-3 w-3" /> Observações
              </p>
              <p className="text-[11px] text-on-surface-variant">{order.notes}</p>
            </div>
          )}
        </Card>

        {/* Financial summary */}
        <Card padding="md">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <h2 className="text-[11px] font-semibold text-on-surface">Resumo Financeiro</h2>
          </div>
          <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between items-center text-on-surface-variant">
              <span>Desconto aplicado:</span>
              <div className="flex items-center gap-2">
                <span className="font-medium">{formatPct(order.discount_pct)}</span>
              </div>
            </div>
            <div className="flex justify-between font-bold text-on-surface text-[11px]">
              <span>Total do Pedido:</span>
              <span>{formatCurrency(order.total_value)}</span>
            </div>
            <div className="flex justify-between text-outline">
              <span>Total de Peças:</span>
              <span>{order.total_pieces} pç</span>
            </div>
          </div>
        </Card>

        {/* Modal: Editar desconto */}
        <Modal
          open={editDiscountModal}
          onClose={() => setEditDiscountModal(false)}
          title="Alterar Desconto"
          size="sm"
          footer={
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditDiscountModal(false)}>Cancelar</Button>
              <Button
                onClick={() => editDiscountMut.mutate()}
                disabled={editDiscountMut.isPending}
                loading={editDiscountMut.isPending}
              >
                Aplicar
              </Button>
            </div>
          }
        >
          <div className="space-y-1">
            <p className="text-[11px] text-on-surface-variant">
              O novo desconto será aplicado a todos os itens do pedido recalculando os valores.
              A tabela de preços permanece a mesma (<span className="font-medium text-on-surface">{order.price_table_name}</span>).
            </p>
            <Input
              label="Desconto (%)"
              type="text"
              inputMode="decimal"
              value={editDiscountValue}
              onChange={e => setEditDiscountValue(e.target.value)}
              placeholder="0,00"
              hint="Use vírgula ou ponto. Ex: 4,61"
            />
            {editDiscountMut.isError && (
              <p className="text-[11px] text-red-500">
                {(editDiscountMut.error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Erro ao alterar desconto'}
              </p>
            )}
          </div>
        </Modal>

        {/* Items */}
        <div>
          <h2 className="text-[11px] font-semibold text-on-surface-variant mb-3">
            Itens do Pedido ({order.items.length})
          </h2>
          <div className="space-y-1">
            {order.items.map((item) => {
              const isExpanded = expandedItems.has(item.id)
              return (
                <div key={item.id} className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
                  <button
                    className="w-full text-left p-3"
                    onClick={() => toggleItem(item.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 bg-surface-container rounded-lg flex-shrink-0 overflow-hidden">
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.reference} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-outline/50">
                            <ImageIcon className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-on-surface text-[11px] select-text">{item.reference}</p>
                        {item.product_name && (
                          <p className="text-[11px] text-outline truncate select-text">{item.product_name}</p>
                        )}
                        {item.type === 'regular' && item.sizes && Object.values(item.sizes).some(v => v > 0) ? (
                          <p className="text-[11px] text-outline mt-0.5">{item.total_pieces} peças</p>
                        ) : (
                          <p className="text-[11px] text-outline mt-0.5">
                            {item.boxes_count} cx × {Math.round(item.total_pieces / Math.max(item.boxes_count,1))} pç/cx = {item.total_pieces} peças
                          </p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[11px] font-bold text-on-surface">{formatCurrency(item.subtotal)}</p>
                        <p className="text-[11px] text-outline/70">R$ {Number(item.unit_price).toFixed(2)}/pç</p>
                        <ChevronDown className={`h-3.5 w-3.5 text-outline/70 ml-auto mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-outline-variant/50 pt-2">
                      {/* Botões de ação do item */}
                      <div className="flex justify-end items-center mb-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setRemoveItemId(item.id) }}
                          className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors"
                        >
                          <Trash2 className="h-3 w-3" /> Remover item
                        </button>
                      </div>

                      {/* Regular product sizes */}
                      {item.type === 'regular' && item.sizes && Object.values(item.sizes).some(v => v > 0) ? (
                        <>
                          <p className="text-[11px] font-medium text-on-surface-variant mb-1.5">Quantidades por tamanho:</p>
                          <div className="overflow-x-auto scrollbar-hide">
                              <table className="min-w-max text-[11px] border border-outline-variant rounded-lg overflow-hidden">
                                <thead className="bg-surface-container-low">
                                  <tr>{sortSizesDetail(Object.keys(item.sizes).filter(s => (item.sizes![s]||0) > 0)).map(s => (
                                    <th key={s} className="px-2 py-1 text-center text-on-surface-variant font-medium min-w-[28px]">{s}</th>
                                  ))}<th className="px-2 py-1 text-center text-outline border-l border-outline-variant">Total</th></tr>
                                </thead>
                                <tbody>
                                  <tr className="bg-white">{sortSizesDetail(Object.keys(item.sizes).filter(s => (item.sizes![s]||0) > 0)).map(s => (
                                    <td key={s} className="px-2 py-1 text-center">{item.sizes![s]}</td>
                                  ))}<td className="px-2 py-1 text-center font-bold border-l border-outline-variant">{item.total_pieces}</td></tr>
                                </tbody>
                              </table>
                          </div>
                        </>
                      ) : item.grade_configs && item.grade_configs.length > 0 ? (
                        <>
                          <p className="text-[11px] font-medium text-on-surface-variant mb-1.5">Composição da grade:</p>
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
            <h2 className="text-[11px] font-semibold text-on-surface-variant mb-3">Histórico de Status</h2>
            <div className="space-y-1">
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
                        <span className="text-[11px] text-outline/70">← {h.from_status_name}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-outline mt-0.5">
                      {h.changed_by_name} &bull; {formatDateTime(h.created_at)}
                    </p>
                    {h.notes && (
                      <p className="text-[11px] text-on-surface-variant mt-0.5 italic">"{h.notes}"</p>
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
            <span className="text-[11px] text-outline">
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
        <div className="space-y-1.5">
          <Input
            placeholder="Buscar referência ou nome..."
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            autoFocus
          />

          {/* Carrinho temporário */}
          {addCart.length > 0 && (
            <div className="bg-primary/10 border border-primary/30 rounded-xl p-3 space-y-1">
              <p className="text-[11px] font-semibold text-primary uppercase tracking-wide">Itens a adicionar</p>
              {addCart.map(c => {
                const isRegular = c.product.type === 'regular'
                const piecesPerBox = c.product.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 1
                const totalPieces = isRegular
                  ? Object.values(c.sizes).reduce((s, v) => s + (v || 0), 0)
                  : c.boxes_count * piecesPerBox
                return (
                  <div key={c.product.id} className="bg-white rounded-lg px-3 py-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-on-surface">{c.product.reference}</p>
                        <p className="text-[11px] text-outline">{totalPieces} pç</p>
                      </div>
                      {!isRegular && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => updateAddCount(c.product.id, -1)} className="w-6 h-6 rounded bg-surface-container flex items-center justify-center hover:bg-surface-container-high">
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-8 text-center text-[11px] font-bold">{c.boxes_count}</span>
                          <button onClick={() => updateAddCount(c.product.id, 1)} className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center hover:bg-indigo-200">
                            <Plus className="h-3 w-3 text-primary" />
                          </button>
                        </div>
                      )}
                      <button onClick={() => removeFromAddCart(c.product.id)} className="w-6 h-6 rounded text-red-400 hover:bg-red-50 flex items-center justify-center">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    {isRegular && (
                      <div className="overflow-x-auto">
                        <table className="text-[11px]">
                          <thead>
                            <tr>{sortSizesDetail(Object.keys(c.sizes)).map(s => (
                              <th key={s} className="px-1 pb-0.5 text-center text-outline font-medium min-w-[34px]">{s}</th>
                            ))}<th className="px-1 pb-0.5 text-center text-primary font-bold pl-1">Tot</th></tr>
                          </thead>
                          <tbody>
                            <tr>{sortSizesDetail(Object.keys(c.sizes)).map(s => (
                              <td key={s} className="px-0.5">
                                <input type="number" min="0" value={c.sizes[s] || 0}
                                  onChange={e => updateAddSize(c.product.id, s, parseInt(e.target.value) || 0)}
                                  className="w-8 h-6 text-center border border-outline-variant rounded text-[11px] font-bold focus:outline-none focus:ring-1 focus:ring-blue-400" />
                              </td>
                            ))}<td className="px-1 pl-1 text-center font-bold text-primary">{totalPieces}</td></tr>
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
          <div className="max-h-96 overflow-y-auto space-y-1 pr-1">
            {loadingAddProducts ? (
              <div className="text-center py-6 text-[11px] text-outline/70">Carregando produtos…</div>
            ) : (addProducts || []).map(p => {
              const inCart = addCart.find(c => c.product.id === p.id)
              const piecesPerBox = p.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 0
              const isExpanded = expandedGrade === p.id
              return (
                <div key={p.id} className="bg-white rounded-xl border border-outline-variant overflow-hidden">
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-12 h-12 bg-surface-container rounded-lg flex-shrink-0 overflow-hidden">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.reference} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-outline/50">
                          <ImageIcon className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[11px] text-on-surface">{p.reference}</p>
                      {p.product_name && <p className="text-[11px] text-outline truncate">{p.product_name}</p>}
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] font-semibold text-primary">R$ {Number(p.base_price).toFixed(2)}<span className="text-[11px] text-outline/70 font-normal">/pç</span></p>
                        {/* pç/cx: só packs têm grade clicável */}
                        {piecesPerBox > 0 && p.type === 'pack' && (
                          <button onClick={() => setExpandedGrade(isExpanded ? null : p.id)} className="text-[11px] text-outline/70 flex items-center gap-0.5 hover:text-on-surface-variant">
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
                          <button onClick={() => updateAddCount(p.id, -1)} className="w-7 h-7 rounded-lg bg-surface-container flex items-center justify-center hover:bg-surface-container-high">
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-8 text-center font-bold text-[11px]">{inCart.boxes_count}</span>
                          <button onClick={() => updateAddCount(p.id, 1)} className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center hover:bg-indigo-200">
                            <Plus className="h-3.5 w-3.5 text-primary" />
                          </button>
                          <button onClick={() => removeFromAddCart(p.id)} className="w-7 h-7 rounded-lg text-red-400 hover:bg-red-50 flex items-center justify-center">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )
                    ) : (
                      <button onClick={() => addToCart(p)} className="flex-shrink-0 flex items-center gap-1 bg-primary text-white text-[11px] font-medium px-3 py-1.5 rounded-lg hover:bg-primary/90">
                        <Plus className="h-3.5 w-3.5" /> Add
                      </button>
                    )}
                  </div>
                  {/* Grade expandida só para packs */}
                  {isExpanded && p.type === 'pack' && p.grade_configs && (
                    <div className="px-3 pb-3 border-t border-outline-variant/50 pt-2">
                      <GradeDisplay configs={p.grade_configs} boxCount={inCart?.boxes_count || 1} />
                    </div>
                  )}
                </div>
              )
            })}
            {!loadingAddProducts && (addProducts || []).length === 0 && (
              <p className="text-center text-[11px] text-outline/70 py-2.5">Nenhum produto encontrado</p>
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
        <div className="space-y-1">
          <Select
            label="Novo Status"
            options={statusOptions}
            value={newStatusId}
            onChange={(e) => setNewStatusId(e.target.value)}
            placeholder="Selecione o status"
          />
          {newStatusId && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-outline">Novo status:</span>
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

      {/* ── Modal Editar Informações ── */}
      <Modal
        open={editInfoModal}
        onClose={() => setEditInfoModal(false)}
        title="Editar Pedido"
        size="md"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setEditInfoModal(false)} disabled={updateInfoMut.isPending}>
              Cancelar
            </Button>
            <Button onClick={() => updateInfoMut.mutate()} loading={updateInfoMut.isPending}>
              Salvar
            </Button>
          </div>
        }
      >
        <div className="space-y-1">

          {/* ── Trocar cliente ── */}
          <div>
            <label className="block text-[11px] font-medium text-on-surface-variant mb-1">Cliente</label>
            <div className="text-[11px] text-outline mb-1.5 bg-surface-container-low rounded-lg px-2 py-1">
              Atual: <span className="font-semibold text-on-surface-variant">{order.client_name}</span>
            </div>
            <input
              type="text"
              value={editInfoForm.client_search}
              onChange={e => setEditInfoForm(f => ({ ...f, client_search: e.target.value, client_id: '' }))}
              placeholder="Digite para buscar e trocar cliente..."
              className="w-full border border-outline-variant rounded-lg px-3 py-1 text-[11px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            />
            {editInfoForm.client_id && (
              <p className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1">
                <Check className="h-3 w-3" />
                Novo cliente: {clientResults?.find(c => c.id === editInfoForm.client_id)?.name}
              </p>
            )}
            {editInfoForm.client_search.length >= 2 && (clientResults || []).length > 0 && !editInfoForm.client_id && (
              <div className="border border-outline-variant rounded-lg mt-1 max-h-36 overflow-y-auto shadow-sm">
                {(clientResults || []).slice(0, 8).map(c => (
                  <button
                    key={c.id}
                    onClick={() => setEditInfoForm(f => ({ ...f, client_id: c.id, client_search: c.name }))}
                    className="w-full text-left px-3 py-1 hover:bg-primary/10 text-[11px] border-b border-gray-50 last:border-0"
                  >
                    <p className="font-medium text-on-surface truncate">{c.name}</p>
                    {c.trade_name && <p className="text-[11px] text-outline truncate">{c.trade_name} · {c.city}</p>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Representante (admin only) ── */}
          {isAdmin && (
            <div>
              <label className="block text-[11px] font-medium text-on-surface-variant mb-1">Representante</label>
              <select
                value={editInfoForm.rep_id}
                onChange={e => setEditInfoForm(f => ({ ...f, rep_id: e.target.value }))}
                className="w-full border border-outline-variant rounded-lg px-3 py-1 text-[11px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              >
                {(usersList || []).filter(u => u.role === 'rep' || u.role === 'admin').map(u => (
                  <option key={u.id} value={u.id}>{u.name} {u.role === 'admin' ? '(Admin)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          <div className="border-t border-outline-variant/50 pt-3 grid grid-cols-2 gap-3">
            {/* ── Desconto (admin only) ── */}
            {isAdmin && (
              <div>
                <label className="block text-[11px] font-medium text-on-surface-variant mb-1">Desconto (%)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editInfoForm.discount_pct}
                  onChange={e => setEditInfoForm(f => ({ ...f, discount_pct: e.target.value }))}
                  placeholder="0,00"
                  className="w-full border border-outline-variant rounded-lg px-3 py-1 text-[11px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                />
                <p className="text-[11px] text-outline mt-0.5">Recalcula todos os itens</p>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-on-surface-variant mb-1">Frete</label>
              <select
                value={editInfoForm.freight_type}
                onChange={e => setEditInfoForm(f => ({ ...f, freight_type: e.target.value }))}
                className="w-full border border-outline-variant rounded-lg px-3 py-1 text-[11px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              >
                <option value="CIF">CIF</option>
                <option value="FOB">FOB</option>
              </select>
            </div>
            <div className={isAdmin ? 'col-span-2' : ''}>
              <label className="block text-[11px] font-medium text-on-surface-variant mb-1">Data de Entrega</label>
              <input
                type="date"
                value={editInfoForm.delivery_date}
                onChange={e => setEditInfoForm(f => ({ ...f, delivery_date: e.target.value }))}
                className="w-full border border-outline-variant rounded-lg px-3 py-1 text-[11px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-on-surface-variant mb-1">Cond. de Pagamento</label>
            <input
              type="text"
              value={editInfoForm.payment_terms}
              onChange={e => setEditInfoForm(f => ({ ...f, payment_terms: e.target.value }))}
              placeholder="Ex: 30/60/90 DDL, À vista, 28 DDL..."
              className="w-full border border-outline-variant rounded-lg px-3 py-1 text-[11px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-on-surface-variant mb-1">Comprador</label>
              <input
                type="text"
                value={editInfoForm.buyer_name}
                onChange={e => setEditInfoForm(f => ({ ...f, buyer_name: e.target.value }))}
                placeholder="Nome do comprador..."
                className="w-full border border-outline-variant rounded-lg px-3 py-1 text-[11px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-on-surface-variant mb-1">Nº na Representada</label>
              <input
                type="text"
                value={editInfoForm.industry_order_number}
                onChange={e => setEditInfoForm(f => ({ ...f, industry_order_number: e.target.value }))}
                placeholder="Número da indústria..."
                className="w-full border border-outline-variant rounded-lg px-3 py-1 text-[11px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-on-surface-variant mb-1">Observações</label>
            <textarea
              value={editInfoForm.notes}
              onChange={e => setEditInfoForm(f => ({ ...f, notes: e.target.value }))}
              rows={3}
              placeholder="Observações do pedido..."
              className="w-full border border-outline-variant rounded-lg px-3 py-1 text-[11px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white resize-none"
            />
          </div>
          {updateInfoMut.isError && (
            <p className="text-[11px] text-red-500">
              {(updateInfoMut.error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Erro ao salvar'}
            </p>
          )}
        </div>
      </Modal>

      {/* ── Modal Confirmar Remoção de Item ── */}
      <Modal
        open={!!removeItemId}
        onClose={() => setRemoveItemId(null)}
        title="Remover item"
        size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setRemoveItemId(null)}>Cancelar</Button>
            <Button
              variant="danger"
              loading={removeItemMut.isPending}
              onClick={() => removeItemId && removeItemMut.mutate(removeItemId)}
            >
              Remover
            </Button>
          </div>
        }
      >
        <p className="text-[11px] text-on-surface-variant">
          Tem certeza que deseja remover este item do pedido?
          Os totais serão recalculados automaticamente.
        </p>
      </Modal>

      {/* ── Modal Excluir Pedido ── */}
      <Modal
        open={deleteModal}
        onClose={() => setDeleteModal(false)}
        title="Excluir pedido"
        size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setDeleteModal(false)}>
              Cancelar
            </Button>
            <button
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
              className="px-4 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              {deleteMut.isPending ? 'Excluindo…' : 'Excluir pedido'}
            </button>
          </div>
        }
      >
        <div className="text-center py-1">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Trash2 className="h-6 w-6 text-red-500" />
          </div>
          <p className="text-on-surface-variant font-medium">
            Tem certeza que deseja excluir o pedido <span className="font-bold">{order && formatOrderNumber(order.order_number)}</span>?
          </p>
          <p className="text-[11px] text-outline/70 mt-1">Esta ação não pode ser desfeita.</p>
        </div>
      </Modal>

      {/* ── Modal: Trocar Tabela de Preços ── */}
      <Modal
        open={changePtModal}
        onClose={() => { setChangePtModal(false); setNewPriceTableId(''); setNewDiscountPct('') }}
        title="Trocar Tabela de Preços"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setChangePtModal(false); setNewPriceTableId(''); setNewDiscountPct('') }}>
              Cancelar
            </Button>
            <Button
              onClick={() => changePtMut.mutate()}
              loading={changePtMut.isPending}
              disabled={!newPriceTableId || newPriceTableId === order?.price_table_id}
            >
              Recalcular e Salvar
            </Button>
          </div>
        }
      >
        <div className="space-y-1">
          {/* Aviso */}
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 leading-relaxed">
              Todos os preços dos itens serão recalculados com base na nova tabela.
              O desconto pode ser ajustado abaixo.
            </p>
          </div>

          {/* Seleção da nova tabela */}
          <div>
            <label className="block text-[11px] font-medium text-on-surface-variant mb-1.5">
              Nova Tabela de Preços
            </label>
            <select
              value={newPriceTableId}
              onChange={e => setNewPriceTableId(e.target.value)}
              className="w-full border border-outline-variant rounded-xl px-3 py-1.5 text-[11px] text-on-surface bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">Selecione uma tabela…</option>
              {(factoryPriceTables || []).map(pt => (
                <option key={pt.id} value={pt.id}>
                  {pt.name}{pt.collection ? ` — ${pt.collection}` : ''}
                  {pt.id === order?.price_table_id ? ' (atual)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Desconto */}
          <div>
            <label className="block text-[11px] font-medium text-on-surface-variant mb-1.5">
              Desconto (%)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={newDiscountPct}
              onChange={e => setNewDiscountPct(e.target.value)}
              placeholder="0"
              className="w-full border border-outline-variant rounded-xl px-3 py-1.5 text-[11px] text-on-surface bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          {/* Erro de produtos não encontrados */}
          {changePtMut.isError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-1.5">
              <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-medium text-red-700">
                  {(changePtMut.error as { response?: { data?: { error?: string; missing?: string[] } } })?.response?.data?.error || 'Erro ao trocar tabela'}
                </p>
                {(changePtMut.error as { response?: { data?: { missing?: string[] } } })?.response?.data?.missing && (
                  <p className="text-[11px] text-red-600 mt-0.5">
                    Referências não encontradas:{' '}
                    {((changePtMut.error as { response?: { data?: { missing?: string[] } } })?.response?.data?.missing || []).join(', ')}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ── Mobile sticky bottom actions ── */}
      <div className="lg:hidden fixed bottom-16 left-0 right-0 z-40 bg-white/95 border-t border-border-subtle px-4 py-2 flex gap-2" style={{ backdropFilter: 'blur(8px)' }}>
        <button
          onClick={() => setDeleteModal(true)}
          className="flex-1 h-12 flex items-center justify-center border border-status-error text-status-error rounded-xl text-[11px] font-bold uppercase tracking-wide hover:bg-red-50 active:scale-95 transition-all"
        >
          Excluir
        </button>
        <button
          onClick={() => duplicateMut.mutate()}
          disabled={duplicateMut.isPending}
          className="flex-1 h-12 flex items-center justify-center border border-primary text-primary rounded-xl text-[11px] font-bold uppercase tracking-wide gap-1.5 hover:bg-primary/5 active:scale-95 transition-all disabled:opacity-50"
        >
          <Copy className="h-4 w-4" />
          {duplicateMut.isPending ? 'Duplicando…' : 'Duplicar Pedido'}
        </button>
        <button
          onClick={() => navigate(`/orders/${id}/edit`)}
          className="flex-[2] h-12 flex items-center justify-center bg-primary text-white rounded-xl text-[11px] font-bold uppercase tracking-wide shadow-sm active:opacity-80 active:scale-95 transition-all gap-1.5"
        >
          <Pencil className="h-4 w-4" />
          Editar
        </button>
      </div>
    </div>
  )
}
