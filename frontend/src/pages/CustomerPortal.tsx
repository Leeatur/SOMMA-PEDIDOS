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
  product: Product
  // Pack: grade com cor + boxes
  grade: GradeConfig | null
  boxes: number
  // Regular: tamanhos escolhidos individualmente
  sizes: Record<string, number>
  unit_price: number
  total_pieces: number
  subtotal: number
}

const MIN_ORDER_VALUE = 2500
const MIN_PIECES_PER_REF = 3

const SIZE_ORDER = ['RN','PP','XP','P','M','G','GG','XG','EXG','2XG','3XG','4XG',
  '34','36','38','40','42','44','46','48','50','52','54','56','58','60','U']

function parseSizeRange(range: string): string[] {
  if (!range || range === 'PACK' || range === 'UN') return []
  // Formato "36-52" → expande de 2 em 2
  const numRange = range.match(/^(\d+)-(\d+)$/)
  if (numRange) {
    const start = parseInt(numRange[1]); const end = parseInt(numRange[2])
    const sizes: string[] = []
    for (let s = start; s <= end; s += 2) sizes.push(String(s))
    return sizes
  }
  // Formato "P,M,G,GG" ou "P-GG"
  if (range.includes(',')) return range.split(',').map(s => s.trim())
  // Formato "P-GG" (range de letras)
  const letterRange = range.match(/^([A-Z]+)-([A-Z]+)$/)
  if (letterRange) {
    const si = SIZE_ORDER.indexOf(letterRange[1]); const ei = SIZE_ORDER.indexOf(letterRange[2])
    if (si >= 0 && ei >= 0) return SIZE_ORDER.slice(si, ei + 1)
  }
  return [range]
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

  // Load portal info — se tem price_tables, carrega catálogo direto
  useEffect(() => {
    if (!token) return
    publicPortalApi.getInfo(token)
      .then(r => {
        setPortalInfo(r.data.portal)
        const pts = r.data.price_tables || []
        const facs = r.data.factories || []
        if (pts.length > 0) {
          // Novo fluxo: tabelas específicas → carrega catálogo direto
          setCatalogLoading(true)
          publicPortalApi.getCatalog(token).then(cat => {
            setCatalog(cat.data.price_tables || [])
            setCatalogLoading(false)
          }).catch(() => setCatalogLoading(false))
          setFactories([])
          setStep('cnpj')
        } else {
          // Fluxo legado: seleciona fábrica
          setFactories(facs)
          setStep('cnpj')
        }
      })
      .catch(() => { setErrorMsg('Link inválido ou expirado.'); setStep('error') })
  }, [token])

  // Load catalog when factory selected (fluxo legado)
  useEffect(() => {
    if (!selectedFactory || !token) return
    setCatalogLoading(true)
    publicPortalApi.getCatalog(token, { factory_id: selectedFactory.id })
      .then(r => { setCatalog(r.data.price_tables || []); setCatalogLoading(false) })
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

  function addToCart(
    product: Product,
    opts: { grade: GradeConfig; boxes: number } | { sizes: Record<string, number> }
  ) {
    let total_pieces: number; let sizes: Record<string, number>; let grade: GradeConfig | null; let boxes: number

    if ('grade' in opts) {
      // PACK
      grade = opts.grade; boxes = opts.boxes
      total_pieces = grade.total_pieces * boxes
      sizes = {}
    } else {
      // REGULAR
      grade = null; boxes = 1
      sizes = opts.sizes
      total_pieces = Object.values(sizes).reduce((s, v) => s + v, 0)
    }

    if (total_pieces < MIN_PIECES_PER_REF) {
      alert(`Mínimo de ${MIN_PIECES_PER_REF} peças por referência.`)
      return
    }

    const subtotal = product.base_price * total_pieces
    const key = `${product.id}_${grade?.color || 'regular'}`
    const existing = cart.findIndex(i => `${i.product.id}_${i.grade?.color || 'regular'}` === key)
    const item: CartItem = { product, grade, boxes, sizes, unit_price: product.base_price, total_pieces, subtotal }

    if (existing >= 0) {
      const updated = [...cart]; updated[existing] = item; setCart(updated)
    } else {
      setCart([...cart, item])
    }
  }

  function removeFromCart(key: string) {
    setCart(cart.filter(i => `${i.product.id}_${i.grade?.color || 'regular'}` !== key))
  }

  const cartTotal = cart.reduce((s, i) => s + i.subtotal, 0)
  const cartPieces = cart.reduce((s, i) => s + i.total_pieces, 0)

  async function handleSubmit() {
    if (!cart.length || !clientData) return
    if (cartTotal < MIN_ORDER_VALUE) {
      alert(`Pedido mínimo de ${fmtR(MIN_ORDER_VALUE)}. Seu pedido está em ${fmtR(cartTotal)}.`)
      return
    }
    // Pega a tabela de preço do primeiro item do carrinho
    const table = catalog.find(t => cart.some(i => i.product.price_table_id === t.id)) || catalog[0]
    if (!table) { alert('Erro: tabela de preço não encontrada.'); return }
    // factory_id vem da tabela de preço
    const factoryId = (table as PriceTable & { factory_id?: string }).factory_id || selectedFactory?.id
    if (!factoryId) { alert('Erro: fábrica não identificada.'); return }

    setSubmitting(true)
    try {
      const items = cart.map(i => ({
        product_id: i.product.id,
        reference: i.product.reference,
        unit_price: i.unit_price,
        boxes_count: i.boxes,
        total_pieces: i.total_pieces,
        sizes: i.product.type === 'regular' ? i.sizes : undefined,
        grade: i.grade ? [i.grade] : undefined,
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
        factory_id: factoryId,
        discount_pct: 0,
        items,
      })
      setOrderResult(r.data)
      setStep('success')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(msg || 'Erro ao enviar pedido. Tente novamente.')
    }
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
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-white flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full text-center" style={{ boxShadow: '0 20px 60px rgba(5,150,105,0.15)' }}>
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <CheckCircle className="h-10 w-10 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-black text-gray-900">Pedido enviado! 🎉</h2>
        <div className="bg-gray-50 rounded-2xl p-4 mt-4 space-y-1">
          <p className="text-[12px] text-gray-500">Número do pedido</p>
          <p className="text-2xl font-black text-purple-700">#{String(orderResult?.order_number || 0).padStart(4, '0')}</p>
          <p className="text-lg font-bold text-gray-800 mt-1">{fmtR(orderResult?.total_value || 0)}</p>
        </div>
        <div className="mt-4 bg-blue-50 rounded-xl p-3 text-[12px] text-blue-700 text-left">
          <p className="font-semibold mb-1">📋 O que acontece agora?</p>
          <p>Seu pedido foi recebido e está em análise. Nosso representante entrará em contato para confirmar os detalhes e prazo de entrega.</p>
        </div>
        <p className="text-[11px] text-gray-400 mt-4">
          Guarde o número do pedido para referência
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

            {/* Fluxo legado: seleção de fábrica (só quando não há price_table_ids) */}
            {!selectedFactory && factories.length > 0 && (
              <div className="p-4 space-y-3">
                <h3 className="font-bold text-gray-800">Escolha a marca:</h3>
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

            {/* Catálogo direto (price_table_ids) OU após selecionar fábrica */}
            {(selectedFactory || factories.length === 0) && (
              <div>
                {/* Header com voltar (só no fluxo com fábrica selecionada) */}
                {selectedFactory && (
                  <div className="bg-white border-b px-4 py-3 flex items-center gap-3">
                    <button onClick={() => { setSelectedFactory(null); setCatalog([]) }}
                      className="p-1 text-gray-400 hover:text-gray-600"><ArrowLeft className="h-4 w-4" /></button>
                    <span className="font-bold text-gray-800">{selectedFactory.name}</span>
                  </div>
                )}

                {catalogLoading ? (
                  <div className="flex justify-center py-16"><RefreshCw className="h-7 w-7 text-purple-500 animate-spin" /></div>
                ) : catalog.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                    <p className="text-gray-500 font-medium">Nenhum produto disponível</p>
                    <p className="text-gray-400 text-sm mt-1">Entre em contato com o representante</p>
                  </div>
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
                                  cartItems={cart.filter(i => i.product.id === p.id)} />
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
                    {item.grade?.color && <p className="text-xs text-gray-500">{item.grade.color}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">{item.total_pieces} peças{item.product.type === 'pack' ? ` · ${item.boxes} cx` : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-purple-700 text-sm">{fmtR(item.subtotal)}</p>
                    <button onClick={() => removeFromCart(`${item.product.id}_${item.grade?.color || 'regular'}`)}
                      className="text-xs text-red-400 hover:text-red-600 mt-1">Remover</button>
                  </div>
                </div>
              </div>
            ))}
            <div className="bg-gray-100 rounded-xl p-3 flex items-center justify-between">
              <span className="font-semibold text-gray-700">Total ({cartPieces} peças)</span>
              <span className="font-bold text-purple-700 text-lg">{fmtR(cartTotal)}</span>
            </div>
            {cartTotal < MIN_ORDER_VALUE && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                ⚠️ Pedido mínimo de <strong>{fmtR(MIN_ORDER_VALUE)}</strong>. Faltam {fmtR(MIN_ORDER_VALUE - cartTotal)} para atingir o mínimo.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom bar ── */}
      {/* Barra flutuante — catálogo com itens */}
      {step === 'catalog' && cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 safe-bottom">
          <div className="bg-white border-t border-gray-200 px-4 pt-3 pb-1 flex items-center justify-between">
            <div className="text-[12px] text-gray-500">
              <span className="font-bold text-gray-800">{cart.length} referência{cart.length !== 1 ? 's' : ''}</span>
              {' · '}{cartPieces} peças
            </div>
            <span className="font-bold text-[16px] text-purple-700">{fmtR(cartTotal)}</span>
          </div>
          <div className="bg-white px-4 pb-4">
            <button onClick={() => setStep('cart')}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all"
              style={{ boxShadow: '0 4px 20px rgba(109,40,217,0.4)' }}>
              <ShoppingCart className="h-5 w-5" />
              Ver Carrinho e Finalizar
            </button>
          </div>
        </div>
      )}

      {/* Confirmar Pedido */}
      {step === 'cart' && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-3 pb-4 safe-bottom space-y-2">
          {cartTotal < MIN_ORDER_VALUE && (
            <p className="text-center text-[12px] text-amber-600 font-medium">
              ⚠️ Mínimo {fmtR(MIN_ORDER_VALUE)} · faltam {fmtR(MIN_ORDER_VALUE - cartTotal)}
            </p>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting || !cart.length || cartTotal < MIN_ORDER_VALUE}
            className="w-full text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, #059669, #047857)',
              boxShadow: '0 4px 20px rgba(5,150,105,0.4)'
            }}
          >
            {submitting
              ? <><RefreshCw className="h-5 w-5 animate-spin" /> Enviando pedido...</>
              : <><CheckCircle className="h-5 w-5" /> Finalizar e Enviar Pedido</>
            }
          </button>
          <p className="text-center text-[11px] text-gray-400">
            Após confirmar, o pedido vai para análise do representante
          </p>
        </div>
      )}
    </div>
  )
}

// ─── ProductCard ─────────────────────────────────────────────────────────────

function ProductCard({ product, onAdd, cartItems }: {
  product: Product
  onAdd: (p: Product, opts: { grade: GradeConfig; boxes: number } | { sizes: Record<string, number> }) => void
  cartItems: CartItem[]
}) {
  const isPack = product.type === 'pack' && product.grade_configs && product.grade_configs.length > 0
  const fmtCur = (v: number) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v)

  // ── PACK state ──
  const [boxes, setBoxes] = useState(1)
  const [selectedGrade] = useState<GradeConfig | null>(product.grade_configs?.[0] || null)

  // ── REGULAR state ──
  const availableSizes = isPack ? [] : parseSizeRange(product.size_range || '')
  const [sizes, setSizes] = useState<Record<string, number>>(() =>
    Object.fromEntries(availableSizes.map(s => [s, 0]))
  )

  const packPieces = isPack && selectedGrade ? selectedGrade.total_pieces * boxes : 0
  const regularPieces = Object.values(sizes).reduce((s, v) => s + v, 0)
  const totalPieces = isPack ? packPieces : regularPieces
  const totalPrice = product.base_price * totalPieces

  const inCart = cartItems.reduce((s, i) => s + i.total_pieces, 0)
  const inCartBoxes = cartItems.reduce((s, i) => s + i.boxes, 0)

  function handleAdd() {
    if (isPack && selectedGrade) {
      onAdd(product, { grade: selectedGrade, boxes })
    } else {
      onAdd(product, { sizes })
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Imagem */}
      <div className="aspect-square bg-gray-50 overflow-hidden relative">
        {product.image_url
          ? <img src={product.image_url} alt={product.reference} className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center text-gray-200"><Package className="h-10 w-10" /></div>
        }
        {inCart > 0 && (
          <div className="absolute top-1.5 right-1.5 bg-green-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            {isPack ? `${inCartBoxes}cx` : `${inCart}pç`}
          </div>
        )}
      </div>

      <div className="p-2.5 space-y-2">
        <div>
          <p className="font-bold text-sm text-gray-900">{product.reference}</p>
          {product.product_name && <p className="text-xs text-gray-500">{product.product_name}</p>}
          <p className="font-bold text-purple-700 mt-0.5">{fmtCur(product.base_price)}/pç</p>
        </div>

        {/* ── PACK: grade completa fechada + caixas ── */}
        {isPack && product.grade_configs && (
          <div className="space-y-1.5">
            {/* Tabela de cores e tamanhos (somente leitura) */}
            <div className="overflow-x-auto rounded-lg border border-gray-100 bg-gray-50">
              <table className="min-w-full text-[10px]">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-2 py-1 text-left text-gray-500 font-semibold">Cor</th>
                    {Object.keys(product.grade_configs[0]?.sizes || {}).map(s => (
                      <th key={s} className="px-1.5 py-1 text-center text-gray-500 font-semibold">{s}</th>
                    ))}
                    <th className="px-2 py-1 text-center text-purple-600 font-bold">Tot/cx</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {product.grade_configs.map(g => (
                    <tr key={g.color || 'default'} className="bg-white">
                      <td className="px-2 py-1 font-semibold text-gray-700 whitespace-nowrap">{g.color || '—'}</td>
                      {Object.entries(g.sizes).map(([s, v]) => (
                        <td key={s} className="px-1.5 py-1 text-center text-gray-600">
                          {Number(v) > 0 ? v : <span className="text-gray-200">—</span>}
                        </td>
                      ))}
                      <td className="px-2 py-1 text-center font-bold text-purple-600">{g.total_pieces}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td className="px-2 py-1 font-bold text-gray-600 text-[11px]">Total/cx</td>
                    <td colSpan={Object.keys(product.grade_configs[0]?.sizes || {}).length} />
                    <td className="px-2 py-1 text-center font-black text-purple-700 text-[12px]">{packPieces}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {/* Seletor de caixas — centralizado e prominente */}
            <div className="flex items-center gap-3 bg-purple-50 rounded-xl p-2 border border-purple-100">
              <button onClick={() => setBoxes(Math.max(1, boxes - 1))}
                className="w-9 h-9 rounded-full bg-white border border-purple-200 flex items-center justify-center shadow-sm active:scale-95">
                <Minus className="h-4 w-4 text-purple-600" />
              </button>
              <div className="flex-1 text-center">
                <p className="font-black text-lg text-purple-700 leading-none">{boxes}</p>
                <p className="text-[10px] text-purple-500">caixa{boxes > 1 ? 's' : ''} · {packPieces * boxes} peças</p>
              </div>
              <button onClick={() => setBoxes(boxes + 1)}
                className="w-9 h-9 rounded-full bg-white border border-purple-200 flex items-center justify-center shadow-sm active:scale-95">
                <Plus className="h-4 w-4 text-purple-600" />
              </button>
            </div>
          </div>
        )}

        {/* ── REGULAR: grade de tamanhos — tabela horizontal com scroll ── */}
        {!isPack && availableSizes.length > 0 && (
          <div className="space-y-1.5">
            {/* Cabeçalho dos tamanhos */}
            <div className="overflow-x-auto -mx-1">
              <table className="w-full" style={{ minWidth: availableSizes.length * 52 }}>
                <thead>
                  <tr>
                    {availableSizes.map(s => (
                      <th key={s} className="text-center text-[11px] font-bold text-gray-500 pb-1 px-0.5"
                          style={{ minWidth: 48 }}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {availableSizes.map(s => {
                      const qty = sizes[s] || 0
                      return (
                        <td key={s} className="px-0.5 pb-0.5">
                          <div className={`flex flex-col items-center gap-0.5 rounded-xl border-2 overflow-hidden transition-colors ${qty > 0 ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white'}`}>
                            <button
                              onClick={() => setSizes(prev => ({...prev, [s]: Math.max(0, (prev[s]||0)-1)}))}
                              className="w-full py-1.5 text-gray-400 active:bg-gray-100 text-sm font-bold leading-none">−</button>
                            <div className={`text-sm font-black leading-none py-0.5 ${qty > 0 ? 'text-purple-700' : 'text-gray-300'}`}>
                              {qty}
                            </div>
                            <button
                              onClick={() => setSizes(prev => ({...prev, [s]: (prev[s]||0)+1}))}
                              className="w-full py-1.5 text-purple-500 active:bg-purple-100 text-sm font-bold leading-none">+</button>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            {regularPieces > 0 && (
              <div className="flex items-center justify-between bg-purple-50 rounded-lg px-3 py-1.5">
                <span className="text-[12px] font-semibold text-purple-700">{regularPieces} peças</span>
                <span className="text-[12px] font-bold text-purple-700">{fmtCur(totalPrice)}</span>
              </div>
            )}
            {regularPieces > 0 && regularPieces < MIN_PIECES_PER_REF && (
              <p className="text-[10px] text-amber-600 text-center">Mínimo {MIN_PIECES_PER_REF} peças por referência</p>
            )}
          </div>
        )}

        {/* Botão adicionar */}
        {totalPieces > 0 && (
          <button onClick={handleAdd}
            className={`w-full py-2 rounded-lg text-sm font-bold transition-all active:scale-95 ${
              inCart > 0 ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-purple-600 hover:bg-purple-700 text-white'
            }`}>
            {inCart > 0 ? '✓ Atualizar' : `+ ${fmtCur(totalPrice)}`}
          </button>
        )}
      </div>
    </div>
  )
}
