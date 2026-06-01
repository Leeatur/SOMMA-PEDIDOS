import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { publicPortalApi } from '../api/client'
import {
  ShoppingCart, Package, ChevronRight, ChevronDown, ChevronUp,
  Plus, Minus, CheckCircle, ArrowLeft, X, Search, RefreshCw,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Factory { id: string; name: string; logo_url: string | null }
interface GradeConfig { color: string | null; sizes: Record<string, number>; total_pieces: number }
interface Product {
  id: string; reference: string; product_name: string | null; model: string | null
  base_price: number; type: 'regular' | 'pack'; image_url: string | null
  size_range: string | null; grade_configs: GradeConfig[] | null; price_table_id: string
}
interface PriceTable {
  id: string; name: string; collection: string; season: string; year: number | null
  factory_id: string; factory_name: string; logo_url: string | null; products: Product[]
}
interface CartItem {
  product: Product; grade: GradeConfig; boxes: number
  unit_price: number; total_pieces: number; subtotal: number
}
interface ClientData {
  cnpj: string; razao_social: string; nome_fantasia: string | null
  address: string; city: string; state: string; zip: string
  phone: string | null; email: string | null; situacao: string
  existing_client: { id: string; name: string } | null
}

const fmtR = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)

// ─── Component ───────────────────────────────────────────────────────────────

export function CustomerPortal() {
  const { token } = useParams<{ token: string }>()

  // Steps: 'loading' | 'cnpj' | 'catalog' | 'cart' | 'success' | 'error'
  const [step, setStep] = useState<string>('loading')
  const [portalInfo, setPortalInfo] = useState<{ name: string; rep_name: string } | null>(null)
  const [factories, setFactories] = useState<Factory[]>([])
  const [errorMsg, setErrorMsg] = useState('')

  const [cnpjInput, setCnpjInput] = useState('')
  const [cnpjLoading, setCnpjLoading] = useState(false)
  const [cnpjError, setCnpjError] = useState('')
  const [clientData, setClientData] = useState<ClientData | null>(null)

  const [catalog, setCatalog] = useState<PriceTable[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [selectedFactory, setSelectedFactory] = useState<Factory | null>(null)
  const [expandedTable, setExpandedTable] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [cart, setCart] = useState<CartItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [orderResult, setOrderResult] = useState<{ order_number: number; total_value: number } | null>(null)

  // Load portal info
  useEffect(() => {
    if (!token) return
    publicPortalApi.getInfo(token)
      .then(r => {
        setPortalInfo(r.data.portal)
        setFactories(r.data.factories)
        setStep('cnpj')
      })
      .catch(() => { setErrorMsg('Link inválido ou expirado.'); setStep('error') })
  }, [token])

  // Load catalog when factory selected
  useEffect(() => {
    if (!selectedFactory || !token) return
    setCatalogLoading(true)
    publicPortalApi.getCatalog(token, { factory_id: selectedFactory.id })
      .then(r => { setCatalog(r.data.price_tables); setCatalogLoading(false) })
      .catch(() => setCatalogLoading(false))
  }, [selectedFactory, token])

  async function handleCnpj() {
    const clean = cnpjInput.replace(/\D/g, '')
    if (clean.length !== 14) { setCnpjError('Digite um CNPJ com 14 dígitos'); return }
    setCnpjLoading(true); setCnpjError('')
    try {
      const r = await publicPortalApi.lookupCnpj(token!, cnpjInput)
      const d = r.data as ClientData
      if (d.situacao && !d.situacao.toLowerCase().includes('ativa')) {
        setCnpjError(`CNPJ com situação: ${d.situacao}. Entre em contato com nosso representante.`)
        setCnpjLoading(false); return
      }
      setClientData(d)
      setStep('catalog')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setCnpjError(msg || 'CNPJ não encontrado na Receita Federal')
    } finally { setCnpjLoading(false) }
  }

  function addToCart(product: Product, grade: GradeConfig, boxes: number) {
    const existing = cart.findIndex(i => i.product.id === product.id && i.grade.color === grade.color)
    const total_pieces = grade.total_pieces * boxes
    const subtotal = product.base_price * total_pieces
    const item: CartItem = { product, grade, boxes, unit_price: product.base_price, total_pieces, subtotal }
    if (existing >= 0) {
      const updated = [...cart]; updated[existing] = item
      setCart(updated)
    } else {
      setCart([...cart, item])
    }
  }

  function removeFromCart(productId: string, color: string | null) {
    setCart(cart.filter(i => !(i.product.id === productId && i.grade.color === color)))
  }

  const cartTotal = cart.reduce((s, i) => s + i.subtotal, 0)
  const cartPieces = cart.reduce((s, i) => s + i.total_pieces, 0)

  async function handleSubmit() {
    if (!cart.length || !clientData || !selectedFactory) return
    const table = catalog[0]
    if (!table) return
    setSubmitting(true)
    try {
      const items = cart.map(i => ({
        product_id: i.product.id,
        reference: i.product.reference,
        unit_price: i.unit_price,
        boxes_count: i.boxes,
        total_pieces: i.total_pieces,
        grade: [i.grade],
      }))
      const r = await publicPortalApi.submitOrder(token!, {
        cnpj: clientData.cnpj,
        client_name: clientData.razao_social,
        trade_name: clientData.nome_fantasia,
        address: clientData.address,
        city: clientData.city,
        state: clientData.state,
        zip: clientData.zip,
        phone: clientData.phone,
        email: clientData.email,
        price_table_id: table.id,
        factory_id: selectedFactory.id,
        discount_pct: 0,
        items,
      })
      setOrderResult(r.data)
      setStep('success')
    } catch { alert('Erro ao enviar pedido. Tente novamente.') }
    finally { setSubmitting(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (step === 'loading') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <RefreshCw className="h-8 w-8 text-purple-600 animate-spin" />
    </div>
  )

  if (step === 'error') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-center">
      <div>
        <X className="h-12 w-12 text-red-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-800">Link inválido</h2>
        <p className="text-gray-500 text-sm mt-1">{errorMsg}</p>
      </div>
    </div>
  )

  if (step === 'success') return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-white flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
        <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900">Pedido enviado!</h2>
        <p className="text-gray-500 text-sm mt-2">
          Pedido <strong>#{orderResult?.order_number}</strong> recebido com sucesso.
        </p>
        <p className="text-lg font-bold text-purple-700 mt-3">{fmtR(orderResult?.total_value || 0)}</p>
        <p className="text-sm text-gray-400 mt-2">
          Nosso representante confirmará em breve.
        </p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" style={{ fontFamily: 'Inter, sans-serif' }}>

      {/* Header */}
      <header className="bg-gradient-to-r from-[#2E1065] to-[#6D28D9] text-white px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {step !== 'cnpj' && (
            <button onClick={() => setStep(step === 'cart' ? 'catalog' : step === 'catalog' && selectedFactory ? 'catalog' : 'cnpj')}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div>
            <div className="font-bold text-sm">{portalInfo?.name || 'Catálogo'}</div>
            <div className="text-white/60 text-xs">Rep: {portalInfo?.rep_name}</div>
          </div>
        </div>
        {step === 'catalog' && cart.length > 0 && (
          <button onClick={() => setStep('cart')}
            className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-xl text-xs font-semibold">
            <ShoppingCart className="h-4 w-4" />
            {cartPieces} pç · {fmtR(cartTotal)}
          </button>
        )}
      </header>

      <div className="flex-1 overflow-auto">

        {/* ── STEP: CNPJ ── */}
        {step === 'cnpj' && (
          <div className="p-6 max-w-md mx-auto mt-4">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Bem-vindo!</h2>
            <p className="text-gray-500 text-sm mb-6">Digite seu CNPJ para acessar o catálogo</p>
            <div className="space-y-3">
              <input
                type="tel" inputMode="numeric"
                placeholder="00.000.000/0001-00"
                value={cnpjInput}
                onChange={e => setCnpjInput(e.target.value.replace(/\D/g,'').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5').slice(0,18))}
                onKeyDown={e => e.key==='Enter' && handleCnpj()}
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:border-purple-500 focus:outline-none"
              />
              {cnpjError && <p className="text-red-500 text-sm">{cnpjError}</p>}
              <button onClick={handleCnpj} disabled={cnpjLoading}
                className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold text-base hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {cnpjLoading ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                {cnpjLoading ? 'Verificando...' : 'Acessar Catálogo'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: CATALOG ── */}
        {step === 'catalog' && (
          <div className="pb-24">
            {/* Client info bar */}
            {clientData && (
              <div className="bg-white border-b px-4 py-2 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-gray-800 truncate">{clientData.nome_fantasia || clientData.razao_social}</p>
                  <p className="text-xs text-gray-400">{clientData.cnpj}</p>
                </div>
              </div>
            )}

            {/* Factory selector */}
            {!selectedFactory && (
              <div className="p-4 space-y-3">
                <h3 className="font-bold text-gray-800">Escolha a coleção:</h3>
                {factories.map(f => (
                  <button key={f.id} onClick={() => setSelectedFactory(f)}
                    className="w-full bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 hover:border-purple-400 hover:bg-purple-50 transition-all">
                    {f.logo_url
                      ? <img src={f.logo_url} alt={f.name} className="h-10 w-20 object-contain" />
                      : <div className="h-10 w-20 bg-gray-100 rounded-lg flex items-center justify-center text-xs font-bold text-gray-500">{f.name.slice(0,6)}</div>
                    }
                    <span className="font-semibold text-gray-800">{f.name}</span>
                    <ChevronRight className="h-4 w-4 text-gray-400 ml-auto" />
                  </button>
                ))}
              </div>
            )}

            {selectedFactory && (
              <div>
                {/* Factory header */}
                <div className="bg-white border-b px-4 py-3 flex items-center gap-3">
                  <button onClick={() => { setSelectedFactory(null); setCatalog([]) }}
                    className="p-1 text-gray-400 hover:text-gray-600"><ArrowLeft className="h-4 w-4" /></button>
                  <span className="font-bold text-gray-800">{selectedFactory.name}</span>
                </div>

                {catalogLoading ? (
                  <div className="flex justify-center py-16"><RefreshCw className="h-7 w-7 text-purple-500 animate-spin" /></div>
                ) : (
                  <div className="p-3 space-y-2">
                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar referência..."
                        className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-purple-400" />
                    </div>

                    {catalog.map(table => {
                      const filtered = table.products.filter(p =>
                        !search || p.reference.toLowerCase().includes(search.toLowerCase()) || (p.product_name||'').toLowerCase().includes(search.toLowerCase()))
                      if (!filtered.length) return null
                      const isOpen = expandedTable === table.id

                      return (
                        <div key={table.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                          <button onClick={() => setExpandedTable(isOpen ? null : table.id)}
                            className="w-full flex items-center justify-between px-4 py-3">
                            <div className="text-left">
                              <p className="font-semibold text-gray-900 text-sm">{table.name}</p>
                              <p className="text-xs text-gray-400">{table.collection} {table.season} {table.year}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400">{filtered.length} refs</span>
                              {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                            </div>
                          </button>

                          {isOpen && (
                            <div className="border-t border-gray-100 p-3 grid grid-cols-2 gap-2">
                              {filtered.map(p => (
                                <ProductCard key={p.id} product={p} onAdd={addToCart}
                                  cartQty={cart.filter(i => i.product.id === p.id).reduce((s,i) => s+i.boxes, 0)} />
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── STEP: CART ── */}
        {step === 'cart' && (
          <div className="p-4 space-y-3 pb-32">
            <h3 className="font-bold text-gray-900">Seu pedido</h3>
            {clientData && (
              <div className="bg-purple-50 rounded-xl p-3 text-xs text-purple-800">
                <p className="font-semibold">{clientData.razao_social}</p>
                <p>{clientData.city}/{clientData.state} · {clientData.cnpj}</p>
              </div>
            )}
            {cart.map((item, idx) => (
              <div key={idx} className="bg-white rounded-xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-sm text-gray-900">{item.product.reference}</p>
                    {item.grade.color && <p className="text-xs text-gray-500">{item.grade.color}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">{item.total_pieces} peças · {item.boxes} cx</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-purple-700 text-sm">{fmtR(item.subtotal)}</p>
                    <button onClick={() => removeFromCart(item.product.id, item.grade.color)}
                      className="text-xs text-red-400 hover:text-red-600 mt-1">Remover</button>
                  </div>
                </div>
              </div>
            ))}
            <div className="bg-gray-100 rounded-xl p-3 flex items-center justify-between">
              <span className="font-semibold text-gray-700">Total ({cartPieces} peças)</span>
              <span className="font-bold text-purple-700 text-lg">{fmtR(cartTotal)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom bar ── */}
      {step === 'catalog' && selectedFactory && cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 safe-bottom">
          <button onClick={() => setStep('cart')}
            className="w-full bg-purple-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Ver pedido · {cartPieces} pç · {fmtR(cartTotal)}
          </button>
        </div>
      )}
      {step === 'cart' && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 safe-bottom">
          <button onClick={handleSubmit} disabled={submitting || !cart.length}
            className="w-full bg-green-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {submitting ? <RefreshCw className="h-5 w-5 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
            {submitting ? 'Enviando pedido...' : 'Confirmar Pedido'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── ProductCard ─────────────────────────────────────────────────────────────

function ProductCard({ product, onAdd, cartQty }: {
  product: Product
  onAdd: (p: Product, grade: GradeConfig, boxes: number) => void
  cartQty: number
}) {
  const [boxes, setBoxes] = useState(1)
  const [selectedGrade, setSelectedGrade] = useState<GradeConfig | null>(
    product.grade_configs?.[0] || null
  )

  const totalPieces = selectedGrade ? selectedGrade.total_pieces * boxes : boxes
  const totalPrice = product.base_price * totalPieces

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Image */}
      <div className="aspect-square bg-gray-50 overflow-hidden">
        {product.image_url
          ? <img src={product.image_url} alt={product.reference} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-gray-300">
              <Package className="h-8 w-8" />
            </div>
        }
      </div>
      <div className="p-2 space-y-1.5">
        <p className="font-bold text-xs text-gray-900">{product.reference}</p>
        {product.product_name && <p className="text-xs text-gray-500 truncate">{product.product_name}</p>}
        <p className="font-bold text-purple-700 text-sm">{new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(product.base_price)}/pç</p>

        {/* Grade color selector */}
        {product.grade_configs && product.grade_configs.length > 1 && (
          <select value={selectedGrade?.color || ''} onChange={e => setSelectedGrade(product.grade_configs!.find(g=>g.color===e.target.value)||null)}
            className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-purple-400">
            {product.grade_configs.map(g => (
              <option key={g.color} value={g.color||''}>{g.color || 'Padrão'} ({g.total_pieces}pç)</option>
            ))}
          </select>
        )}

        {/* Qty selector */}
        <div className="flex items-center gap-1.5">
          <button onClick={() => setBoxes(Math.max(1,boxes-1))} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center">
            <Minus className="h-3 w-3 text-gray-600" />
          </button>
          <span className="text-xs font-semibold flex-1 text-center">{boxes} cx · {totalPieces}pç</span>
          <button onClick={() => setBoxes(boxes+1)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center">
            <Plus className="h-3 w-3 text-gray-600" />
          </button>
        </div>

        <button onClick={() => selectedGrade && onAdd(product, selectedGrade, boxes)}
          className={`w-full py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            cartQty > 0 ? 'bg-green-600 text-white' : 'bg-purple-600 text-white hover:bg-purple-700'
          }`}>
          {cartQty > 0 ? `✓ ${cartQty}cx no pedido` : `+ ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(totalPrice)}`}
        </button>
      </div>
    </div>
  )
}
