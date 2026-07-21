import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { publicPortalApi } from '../api/client'
import {
  ShoppingCart, Package, ChevronDown, ChevronUp,
  CheckCircle, ArrowLeft, X, Search, RefreshCw,
} from 'lucide-react'
import { ProductPhotos } from '../components/ui/ProductPhotos'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Factory { id: string; name: string; logo_url: string | null }
interface GradeConfig { color: string | null; sizes: Record<string, number>; total_pieces: number }
interface Product {
  id: string; reference: string; product_name: string | null; model: string | null
  base_price: number; type: 'regular' | 'pack'; image_url: string | null
  images?: (string | null)[] | null
  size_range: string | null; grade_configs: GradeConfig[] | null; price_table_id: string
  blocked_sizes: string[]
  stock?: Record<string, Record<string, number>> | null
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
  // Pack multi-grade: grades escolhidas (sizes já multiplicados pelo multiplicador)
  customGrade?: GradeConfig[]
  // Regular: tamanhos escolhidos individualmente
  sizes: Record<string, number>
  unit_price: number
  total_pieces: number
  subtotal: number
}

// Pedido mínimo de R$ 2.500,00 — exigido em catálogos de Pronta Entrega (portal.is_pe)
const PE_MIN_ORDER_VALUE = 2500
const MIN_PIECES_PER_REF = 1

// Pack multi-grade (NXO): cliente escolhe multiplicador por grade e pode misturar. Default off.
const MULTI_GRADE = import.meta.env.VITE_MULTI_GRADE === 'true'

const PAYMENT_OPTIONS = [
  { label: 'À Vista (3% desconto)',         value: 'À Vista',                  discount: 3 },
  { label: '30/60/90 Dias',                  value: '30/60/90 Dias',            discount: 0 },
  { label: '30/60/90/120 Dias',              value: '30/60/90/120 Dias',        discount: 0 },
  { label: '30/45/60/75/90 Dias',            value: '30/45/60/75/90 Dias',      discount: 0 },
  { label: '30/45/60/75/90/105/120 Dias',    value: '30/45/60/75/90/105/120',   discount: 0 },
]

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
  phone: string | null; whatsapp?: string | null; email: string | null; situacao: string
  existing_client: { id: string; name: string; email?: string | null; whatsapp?: string | null } | null
}

const fmtR = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)

// ─── Component ───────────────────────────────────────────────────────────────

export function CustomerPortal() {
  const { token } = useParams<{ token: string }>()

  // Steps: 'loading' | 'cnpj' | 'catalog' | 'cart' | 'success' | 'error'
  const [step, setStep] = useState<string>('loading')
  const [portalInfo, setPortalInfo] = useState<{ name: string; rep_name: string; is_pe?: boolean; terms?: string | null; min_order_value?: number; only_in_stock?: boolean } | null>(null)
  const [factories, setFactories] = useState<Factory[]>([])
  const [errorMsg, setErrorMsg] = useState('')

  const [cnpjInput, setCnpjInput] = useState('')
  const [cnpjLoading, setCnpjLoading] = useState(false)
  const [cnpjError, setCnpjError] = useState('')
  const [clientData, setClientData] = useState<ClientData | null>(null)
  // Contato obrigatório (cliente novo): e-mail + WhatsApp
  const [contactEmail, setContactEmail] = useState('')
  const [contactWhatsapp, setContactWhatsapp] = useState('')
  const [contactError, setContactError] = useState('')

  const [catalog, setCatalog] = useState<PriceTable[]>([])
  const [catalogLoading] = useState(false)
  const [selectedFactory, setSelectedFactory] = useState<Factory | null>(null)
  const [expandedTable, setExpandedTable] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [cart, setCart] = useState<CartItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [orderResult, setOrderResult] = useState<{ order_number: number; total_value: number } | null>(null)
  const [modalProduct, setModalProduct] = useState<Product | null>(null)
  const [selectedPayment, setSelectedPayment] = useState(PAYMENT_OPTIONS[0])

  // ── Persistência no sessionStorage — sobrevive ao F5 ─────────────────────
  const SESSION_KEY = token ? `portal_session_${token}` : null

  // Salva sempre que step/clientData/cart/pagamento mudam
  useEffect(() => {
    if (!SESSION_KEY || step === 'loading' || step === 'error' || step === 'success' || !clientData) return
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      step,
      clientData,
      cart,
      selectedPaymentValue: selectedPayment.value,
    }))
  }, [step, clientData, cart, selectedPayment, SESSION_KEY])

  // Restaura assim que o catálogo ficar disponível (catalog > 0 = pronto)
  const [sessionRestored, setSessionRestored] = useState(false)
  useEffect(() => {
    if (!SESSION_KEY || catalog.length === 0 || sessionRestored) return
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return
    try {
      const s = JSON.parse(raw)
      if (s.clientData)  setClientData(s.clientData)
      if (s.cart?.length) setCart(s.cart)
      if (s.selectedPaymentValue) {
        const p = PAYMENT_OPTIONS.find(o => o.value === s.selectedPaymentValue)
        if (p) setSelectedPayment(p)
      }
      if (s.step && ['catalog', 'cart'].includes(s.step)) setStep(s.step)
    } catch { /* ignore */ }
    setSessionRestored(true)
  }, [catalog, SESSION_KEY, sessionRestored])

  // Load portal info + catálogo em UM único request (getInfo já retorna produtos)
  useEffect(() => {
    if (!token) return
    publicPortalApi.getInfo(token)
      .then(r => {
        setPortalInfo(r.data.portal)
        const pts: PriceTable[] = r.data.price_tables || []
        const facs: Factory[]   = r.data.factories   || []

        // Se getInfo já trouxe produtos, usa direto — sem segundo request
        const hasProducts = pts.some(t => Array.isArray(t.products))
        if (pts.length > 0 && hasProducts) {
          setCatalog(pts)
          setFactories([])
        } else if (facs.length > 0) {
          setFactories(facs)
        }
        setStep('cnpj')
      })
      .catch(() => { setErrorMsg('Link inválido ou expirado.'); setStep('error') })
  }, [token])

  async function handleCnpj(rawValue?: string) {
    const src = rawValue ?? cnpjInput
    const clean = src.replace(/\D/g, '')
    if (clean.length !== 14) { setCnpjError('Digite um CNPJ com 14 dígitos'); return }
    setCnpjLoading(true); setCnpjError('')
    try {
      const r = await publicPortalApi.lookupCnpj(token!, src)
      const d = r.data as ClientData
      if (d.situacao && !d.situacao.toLowerCase().includes('ativa')) {
        setCnpjError(`CNPJ com situação: ${d.situacao}. Entre em contato com nosso representante.`)
        setCnpjLoading(false); return
      }
      setClientData(d)
      // Se há apenas uma fábrica, seleciona automaticamente (sem mostrar seletor)
      if (factories.length === 1) {
        setSelectedFactory(factories[0])
      }
      // Pré-preenche contato (cliente existente > Receita) e decide se pede confirmação
      const preEmail = d.existing_client?.email || d.email || ''
      const preWhats = d.existing_client?.whatsapp || ''
      setContactEmail(preEmail)
      setContactWhatsapp(preWhats)
      // Vai direto ao catálogo; o contato (e-mail + WhatsApp) é confirmado/corrigido só ao FINALIZAR o pedido
      setClientData({ ...d, email: preEmail, whatsapp: preWhats })
      setStep('catalog')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setCnpjError(msg || 'CNPJ não encontrado na Receita Federal')
    } finally { setCnpjLoading(false) }
  }

  function addToCart(
    product: Product,
    opts: { grade: GradeConfig; boxes: number } | { sizes: Record<string, number> } | { customGrade: GradeConfig[]; total_pieces: number }
  ) {
    let total_pieces: number; let sizes: Record<string, number>; let grade: GradeConfig | null; let boxes: number
    let customGrade: GradeConfig[] | undefined

    if ('customGrade' in opts) {
      // PACK MULTI-GRADE — grades escolhidas com multiplicador (sizes já multiplicados)
      grade = null; boxes = 1; sizes = {}
      customGrade = opts.customGrade
      total_pieces = opts.total_pieces
    } else if ('grade' in opts) {
      // PACK — soma TODAS as cores para total correto
      grade = opts.grade; boxes = opts.boxes
      const allGrades: GradeConfig[] = (product.grade_configs as GradeConfig[] | null) || [grade]
      const piecesPerBox = allGrades.reduce((s, g) => s + g.total_pieces, 0) || grade.total_pieces
      total_pieces = piecesPerBox * boxes
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
    const item: CartItem = { product, grade, boxes, customGrade, sizes, unit_price: product.base_price, total_pieces, subtotal }

    if (existing >= 0) {
      const updated = [...cart]; updated[existing] = item; setCart(updated)
    } else {
      setCart([...cart, item])
    }
  }

  function removeFromCart(key: string) {
    setCart(cart.filter(i => `${i.product.id}_${i.grade?.color || 'regular'}` !== key))
  }

  const cartSubtotal = cart.reduce((s, i) => s + i.subtotal, 0)
  const cartDiscount = selectedPayment.discount  // % desconto à vista
  const cartTotal = cartSubtotal * (1 - cartDiscount / 100)
  const cartPieces = cart.reduce((s, i) => s + i.total_pieces, 0)
  // Pedido mínimo: PE usa fixo R$ 2.500; catálogo normal usa o valor configurado no link
  const minOrderValue = portalInfo?.is_pe ? PE_MIN_ORDER_VALUE : (portalInfo?.min_order_value ?? 0)

  async function handleSubmit() {
    if (!cart.length || !clientData) return
    if (cartSubtotal < minOrderValue) {
      alert(`Pedido mínimo de ${fmtR(minOrderValue)}. Seu pedido está em ${fmtR(cartSubtotal)}.`)
      return
    }
    // Contato confirmado no fechamento (e-mail + WhatsApp)
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())
    if (!emailOk) { setContactError('Confirme um e-mail válido para enviar o pedido.'); return }
    if (contactWhatsapp.replace(/\D/g, '').length < 10) { setContactError('Confirme um WhatsApp válido com DDD.'); return }
    setContactError('')
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
        // multi-grade: envia as grades escolhidas; pack normal: a grade única; regular: nada
        grade: i.customGrade ? i.customGrade : (i.grade ? [i.grade] : undefined),
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
        whatsapp: contactWhatsapp,
        email: contactEmail.trim(),
        price_table_id: table.id,
        factory_id: factoryId,
        discount_pct: selectedPayment.discount,
        payment_terms: selectedPayment.value,
        items,
      })
      setOrderResult(r.data)
      setStep('success')
      if (SESSION_KEY) sessionStorage.removeItem(SESSION_KEY)
      setCart([])
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
        <p className="text-[10px] text-gray-300 mt-6">SOMMA Technology · Erechim | RS · (54) 9.9162-5024</p>
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
                onChange={e => {
                  const masked = e.target.value.replace(/\D/g,'').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5').slice(0,18)
                  setCnpjInput(masked)
                  if (masked.replace(/\D/g,'').length === 14) handleCnpj(masked)
                }}
                onKeyDown={e => e.key==='Enter' && handleCnpj()}
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:border-purple-500 focus:outline-none"
              />
              {cnpjError && <p className="text-red-500 text-sm">{cnpjError}</p>}
              <button onClick={() => handleCnpj()} disabled={cnpjLoading}
                className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold text-base hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {cnpjLoading ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                {cnpjLoading ? 'Verificando...' : 'Acessar Catálogo'}
              </button>
            </div>
            <p className="text-center text-[10px] text-gray-300 mt-8">SOMMA Technology · Erechim | RS · (54) 9.9162-5024</p>
          </div>
        )}

        {/* ── STEP: CONTATO (cliente novo — e-mail + WhatsApp obrigatórios) ── */}
        {step === 'contact' && clientData && (
          <div className="p-6 max-w-md mx-auto mt-4">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Confirme seu contato</h2>
            <p className="text-gray-500 text-sm mb-1">{clientData.nome_fantasia || clientData.razao_social}</p>
            <p className="text-gray-400 text-xs mb-5">{clientData.cnpj}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-mail <span className="text-red-500">*</span></label>
                <input
                  type="email" inputMode="email"
                  value={contactEmail}
                  onChange={e => { setContactEmail(e.target.value); setContactError('') }}
                  placeholder="contato@empresa.com.br"
                  className="w-full border-2 border-amber-300 bg-amber-50 rounded-xl px-4 py-3 text-base focus:border-purple-500 focus:bg-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp <span className="text-red-500">*</span></label>
                <input
                  type="tel" inputMode="numeric"
                  value={contactWhatsapp}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g,'').slice(0,11)
                      .replace(/^(\d{2})(\d{5})(\d{0,4}).*/, '($1) $2-$3')
                      .replace(/^(\d{2})(\d{0,5})$/, '($1) $2')
                    setContactWhatsapp(v); setContactError('')
                  }}
                  placeholder="(00) 00000-0000"
                  className="w-full border-2 border-amber-300 bg-amber-50 rounded-xl px-4 py-3 text-base focus:border-purple-500 focus:bg-white focus:outline-none"
                />
              </div>
              {contactError && <p className="text-red-500 text-sm">{contactError}</p>}
              <button
                onClick={() => {
                  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())
                  const whatsDigits = contactWhatsapp.replace(/\D/g, '')
                  if (!emailOk) { setContactError('Informe um e-mail válido'); return }
                  if (whatsDigits.length < 10) { setContactError('Informe um WhatsApp válido com DDD'); return }
                  setClientData({ ...clientData, email: contactEmail.trim(), whatsapp: contactWhatsapp })
                  setStep('catalog')
                }}
                className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold text-base hover:bg-purple-700 transition-colors"
              >
                Continuar para o catálogo
              </button>
              <p className="text-xs text-gray-400 text-center">Usamos seu contato só para confirmar o pedido.</p>
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

            {/* Catálogo direto — sem seleção de fábrica */}
            {(
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
                            <div className="border-t border-gray-100 p-3 space-y-4">
                              {(() => {
                                const groups: Record<string, Product[]> = {}
                                for (const p of filtered) {
                                  const key = p.model || ''
                                  if (!groups[key]) groups[key] = []
                                  groups[key].push(p)
                                }
                                return Object.entries(groups).map(([modelName, prods]) => (
                                  <div key={modelName}>
                                    {modelName && (
                                      <div className="flex items-center justify-between mb-2 px-0.5">
                                        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">{modelName}</p>
                                        <span className="text-[10px] text-gray-400">{prods.length} refs</span>
                                      </div>
                                    )}
                                    <div className="grid grid-cols-2 gap-2">
                                      {prods.map(p => (
                                        <ProductCard key={p.id} product={p}
                                          cartItems={cart.filter(i => i.product.id === p.id)}
                                          onOpenModal={setModalProduct} />
                                      ))}
                                    </div>
                                  </div>
                                ))
                              })()}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Condições / Política de troca (texto institucional, fim do catálogo) */}
            {portalInfo?.terms && (
              <div className="mx-3 mt-4 mb-2 bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-[13px] font-bold text-gray-800 mb-2">Condições e Política de Troca</p>
                <p className="text-[12px] text-gray-600 whitespace-pre-line leading-relaxed">{portalInfo.terms}</p>
              </div>
            )}
          </div>
        )}

        {/* ── STEP: CART ── */}
        {step === 'cart' && (
          <div className="p-4 space-y-3 pb-32">
            {/* Botão sempre visível (sticky) pra voltar e continuar comprando */}
            <div className="sticky top-0 z-20 -mx-4 px-4 py-2 bg-gray-50/95 backdrop-blur border-b border-amber-200">
              <button
                onClick={() => setStep('catalog')}
                className="w-full flex items-center justify-center gap-2 text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-full px-4 py-2.5 shadow-md transition-colors active:scale-[0.98]"
              >
                <ArrowLeft className="h-4 w-4" /> Voltar ao catálogo
              </button>
            </div>
            <h3 className="font-bold text-gray-900">Seu pedido</h3>
            {clientData && (
              <div className="bg-purple-50 rounded-xl p-3 text-xs text-purple-800">
                <p className="font-semibold">{clientData.razao_social}</p>
                <p>{clientData.city}/{clientData.state} · {clientData.cnpj}</p>
              </div>
            )}
            {cart.map((item, idx) => (
              <div key={idx}
                onClick={() => setModalProduct(item.product)}
                className="bg-white rounded-xl border border-gray-200 p-3 cursor-pointer hover:border-purple-300 hover:bg-purple-50/30 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-gray-900">{item.product.reference}</p>
                    {item.product.product_name && (
                      <p className="text-xs text-gray-600">{item.product.product_name}{item.product.model ? ` — ${item.product.model}` : ''}</p>
                    )}
                    {item.grade?.color && <p className="text-xs text-gray-500 mt-0.5">{item.grade.color}</p>}
                    {item.customGrade && item.customGrade.length > 0 && (
                      <div className="text-xs text-gray-500 mt-0.5 space-y-0.5">
                        {item.customGrade.map(g => (
                          <p key={g.color || 'x'}>
                            <span className="font-medium">{g.color || '—'}:</span>{' '}
                            {Object.entries(g.sizes || {}).filter(([, q]) => (q || 0) > 0).map(([s, q]) => `${s}×${q}`).join(' ')}
                          </p>
                        ))}
                      </div>
                    )}
                    {!item.customGrade && item.sizes && Object.keys(item.sizes).length > 0 && (
                      <p className="text-xs text-gray-500 mt-0.5">{Object.entries(item.sizes).filter(([, q]) => (q || 0) > 0).map(([s, q]) => `${s}×${q}`).join(' ')}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">{item.total_pieces} peças{item.product.type === 'pack' && !item.customGrade ? ` · ${item.boxes} cx` : ''} · toque para editar</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-purple-700 text-sm">{fmtR(item.subtotal)}</p>
                    <button onClick={e => { e.stopPropagation(); removeFromCart(`${item.product.id}_${item.grade?.color || 'regular'}`) }}
                      className="text-xs text-red-400 hover:text-red-600 mt-1">Remover</button>
                  </div>
                </div>
              </div>
            ))}
            {/* Prazo de Pagamento */}
            <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
              <p className="font-semibold text-sm text-gray-800">💳 Condição de Pagamento</p>
              <div className="space-y-1.5">
                {PAYMENT_OPTIONS.map(opt => (
                  <label key={opt.value} className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${selectedPayment.value === opt.value ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-white'}`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${selectedPayment.value === opt.value ? 'border-purple-500 bg-purple-500' : 'border-gray-300'}`}>
                        {selectedPayment.value === opt.value && <div className="w-2 h-2 bg-white rounded-full m-auto mt-0.5" />}
                      </div>
                      <span className={`text-sm font-medium ${selectedPayment.value === opt.value ? 'text-purple-700' : 'text-gray-700'}`}>{opt.label}</span>
                    </div>
                    {opt.discount > 0 && (
                      <span className="text-[11px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">−{opt.discount}%</span>
                    )}
                    <input type="radio" className="hidden" checked={selectedPayment.value === opt.value} onChange={() => setSelectedPayment(opt)} />
                  </label>
                ))}
              </div>
            </div>

            {/* Totais */}
            <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>Subtotal ({cartPieces} peças)</span>
                <span>{fmtR(cartSubtotal)}</span>
              </div>
              {selectedPayment.discount > 0 && (
                <div className="flex items-center justify-between text-sm text-green-700">
                  <span>Desconto Comercial ({selectedPayment.discount}%)</span>
                  <span>− {fmtR(cartSubtotal * selectedPayment.discount / 100)}</span>
                </div>
              )}
              <div className="flex items-center justify-between font-bold text-base border-t border-gray-200 pt-1.5 mt-1.5">
                <span className="text-gray-800">Total</span>
                <span className="text-purple-700 text-lg">{fmtR(cartTotal)}</span>
              </div>
              {cartSubtotal < minOrderValue && (
                <p className="text-[11px] text-amber-600 text-center">⚠️ Mínimo {fmtR(minOrderValue)} · faltam {fmtR(minOrderValue - cartSubtotal)}</p>
              )}
            </div>
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
          {/* Contato — destacado em âmbar; pré-preenchido do cadastro qdo cliente existe */}
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 space-y-2">
            <p className="text-[12px] font-bold text-amber-800">
              {clientData?.existing_client
                ? '📩 Confirme seu e-mail e WhatsApp (puxados do cadastro)'
                : '📩 Seu e-mail e WhatsApp para confirmar o pedido'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-amber-800 mb-0.5">E-mail <span className="text-red-500">*</span></label>
                <input
                  type="email" inputMode="email" value={contactEmail}
                  onChange={e => { setContactEmail(e.target.value); setContactError('') }}
                  placeholder="contato@empresa.com.br"
                  className="w-full border-2 border-amber-300 bg-white rounded-xl px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-amber-800 mb-0.5">WhatsApp <span className="text-red-500">*</span></label>
                <input
                  type="tel" inputMode="numeric" value={contactWhatsapp}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g,'').slice(0,11)
                      .replace(/^(\d{2})(\d{5})(\d{0,4}).*/, '($1) $2-$3')
                      .replace(/^(\d{2})(\d{0,5})$/, '($1) $2')
                    setContactWhatsapp(v); setContactError('')
                  }}
                  placeholder="(00) 00000-0000"
                  className="w-full border-2 border-amber-300 bg-white rounded-xl px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                />
              </div>
            </div>
            {contactError && <p className="text-red-500 text-xs">{contactError}</p>}
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || !cart.length || cartSubtotal < minOrderValue}
            className="w-full text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: cartSubtotal < minOrderValue ? '#9ca3af' : 'linear-gradient(135deg, #059669, #047857)',
              boxShadow: cartSubtotal >= minOrderValue ? '0 4px 20px rgba(5,150,105,0.4)' : 'none'
            }}
          >
            {submitting
              ? <><RefreshCw className="h-5 w-5 animate-spin" /> Enviando pedido...</>
              : cartSubtotal < minOrderValue
                ? `⚠️ Mínimo ${fmtR(minOrderValue)}`
                : <><CheckCircle className="h-5 w-5" /> Finalizar e Enviar Pedido</>
            }
          </button>
          <button
            onClick={() => setStep('catalog')}
            className="w-full py-2.5 rounded-2xl font-semibold text-sm text-amber-600 border border-amber-200 hover:bg-amber-50 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar ao Catálogo
          </button>
        </div>
      )}

      {/* Modal de produto */}
      {modalProduct && (
        <ProductModal
          product={modalProduct}
          onAdd={addToCart}
          cartItems={cart.filter(i => i.product.id === modalProduct.id)}
          onClose={() => setModalProduct(null)}
        />
      )}
    </div>
  )
}

// ─── ProductCard ─────────────────────────────────────────────────────────────

// ─── ProductModal — abre ao clicar na referência ────────────────────────────

function ProductModal({ product, onAdd, cartItems, onClose }: {
  product: Product
  onAdd: (p: Product, opts: { grade: GradeConfig; boxes: number } | { sizes: Record<string, number> } | { customGrade: GradeConfig[]; total_pieces: number }) => void
  cartItems: CartItem[]
  onClose: () => void
}) {
  const isPack = product.type === 'pack' && product.grade_configs && product.grade_configs.length > 0
  const multiGradePack = !!isPack && MULTI_GRADE
  const fmtCur = (v: number) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v)
  const grades: GradeConfig[] = product.grade_configs || []
  const blockedSet = new Set((product.blocked_sizes || []).map(s => s.toUpperCase()))
  // Remove tamanhos bloqueados da lista de disponíveis
  const allSizes = isPack ? [] : parseSizeRange(product.size_range || '')
  const availableSizes = allSizes.filter(s => !blockedSet.has(s.toUpperCase()))

  const [boxes, setBoxes] = useState(1)
  const [sizes, setSizes] = useState<Record<string, number>>(() =>
    Object.fromEntries(availableSizes.map(s => [s, 0]))
  )
  // Pack multi-grade: multiplicador por grade
  const [gradeMult, setGradeMult] = useState<number[]>(() => grades.map(() => 0))
  const mgCustomGrade: GradeConfig[] = grades
    .map((g, i) => ({
      color: g.color || `Grade ${i + 1}`,
      sizes: Object.fromEntries(Object.entries(g.sizes).map(([s, q]) => [s, q * (gradeMult[i] || 0)])),
      total_pieces: g.total_pieces * (gradeMult[i] || 0),
    }))
    .filter(e => e.total_pieces > 0)
  const mgTotal = mgCustomGrade.reduce((s, e) => s + e.total_pieces, 0)

  // ── Estoque (grade fechada): valida no NÍVEL DE TAMANHO (soma cores) ──
  const norm = (s: string) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const availBySize: Record<string, number> = {}
  for (const sizes of Object.values(product.stock || {})) {
    for (const [sz, q] of Object.entries(sizes || {})) {
      const k = norm(sz); availBySize[k] = (availBySize[k] || 0) + (Number(q) || 0)
    }
  }
  const hasStock = Object.keys(availBySize).length > 0
  // Quanto cada tamanho é exigido pelas grades escolhidas
  const neededBySize: Record<string, number> = {}
  for (const e of mgCustomGrade) {
    for (const [sz, q] of Object.entries(e.sizes)) {
      const k = norm(sz); neededBySize[k] = (neededBySize[k] || 0) + (Number(q) || 0)
    }
  }
  // Tamanhos que estouram o estoque
  const stockShort = hasStock
    ? Object.entries(neededBySize).filter(([sz, need]) => need > (availBySize[sz] ?? 0)).map(([sz]) => sz)
    : []
  const stockBlocked = multiGradePack && stockShort.length > 0

  const totalPiecesPerPack = grades.reduce((s: number, g: GradeConfig) => s + g.total_pieces, 0)
  const packPieces = isPack ? totalPiecesPerPack * boxes : 0
  const regularPieces = Object.values(sizes).reduce((s, v) => s + v, 0)
  const totalPieces = multiGradePack ? mgTotal : isPack ? packPieces : regularPieces
  const totalPrice = product.base_price * totalPieces
  const inCart = cartItems.reduce((s, i) => s + i.total_pieces, 0)

  function handleConfirm() {
    if (multiGradePack && grades.length > 0) {
      onAdd(product, { customGrade: mgCustomGrade, total_pieces: mgTotal })
    } else if (isPack && grades.length > 0) {
      onAdd(product, { grade: grades[0], boxes })
    } else {
      onAdd(product, { sizes })
    }
    onClose()
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">

        {/* Imagem full-width + botão fechar */}
        <div className="relative bg-gray-50 flex-shrink-0">
          <button onClick={onClose} className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/25 backdrop-blur-sm text-white flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
          {(product.images?.length || product.image_url) ? (
            <div className="relative w-full" style={{ height: '260px' }}>
              <ProductPhotos
                images={product.images?.length ? product.images : [product.image_url]}
                alt={product.reference}
                className="w-full h-full"
                imgClassName="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-full h-40 flex items-center justify-center">
              <Package className="h-16 w-16 text-gray-200" />
            </div>
          )}
        </div>

        {/* Info do produto */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <p className="font-black text-lg text-gray-900 leading-none">{product.reference}</p>
            {product.product_name && <p className="text-[13px] text-gray-500 mt-0.5">{product.product_name}</p>}
            <p className="font-bold text-purple-700 text-base mt-1">{fmtCur(product.base_price)}<span className="text-xs font-normal text-gray-400"> /peça</span></p>
          </div>
          {inCart > 0 && <span className="text-[11px] bg-green-100 text-green-700 font-bold px-2.5 py-1 rounded-full">✓ {inCart} pç</span>}
        </div>

        {/* Conteúdo com scroll */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* PACK MULTI-GRADE — escolhe quantas de cada grade (pode misturar) */}
          {multiGradePack && grades.length > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Grades — escolha a quantidade de cada (pode misturar)</p>
              {grades.map((g, i) => {
                const gSizes = Object.keys(g.sizes).filter(s => !blockedSet.has(s.toUpperCase()))
                const mult = gradeMult[i] || 0
                const setMult = (v: number) => setGradeMult(prev => prev.map((m, idx) => idx === i ? Math.max(0, v) : m))
                return (
                  <div key={i} className={`rounded-2xl border p-3 ${mult > 0 ? 'border-purple-300 bg-purple-50/50' : 'border-gray-200'}`}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="font-bold text-gray-800">{g.color || `Grade ${i + 1}`} <span className="text-[11px] font-normal text-gray-400">({g.total_pieces} pç/grade)</span></span>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setMult(mult - 1)}
                          className="w-10 h-10 rounded-full bg-white border-2 border-purple-300 flex items-center justify-center shadow active:scale-95 text-purple-700 font-black text-lg">−</button>
                        <span className="font-black text-2xl text-purple-700 min-w-[32px] text-center">{mult}</span>
                        <button onClick={() => setMult(mult + 1)}
                          className="w-10 h-10 rounded-full bg-white border-2 border-purple-300 flex items-center justify-center shadow active:scale-95 text-purple-700 font-black text-lg">+</button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-max text-[12px] border border-purple-100 rounded-lg overflow-hidden">
                        <thead className="bg-purple-100/50">
                          <tr>
                            {gSizes.map(s => <th key={s} className="px-2 py-1 text-center text-purple-800 font-bold min-w-[30px]">{s}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="bg-white">
                            {gSizes.map(s => <td key={s} className="px-2 py-1 text-center text-gray-700">{(g.sizes[s] || 0) * Math.max(1, mult)}</td>)}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
              {mgTotal > 0 && (
                <div className="flex items-center justify-between bg-purple-50 rounded-xl px-4 py-3 border border-purple-100">
                  <span className="font-bold text-purple-700">{mgTotal} peças no total</span>
                  <span className="font-black text-purple-800 text-lg">{fmtCur(product.base_price * mgTotal)}</span>
                </div>
              )}
              {stockBlocked && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">
                  ⚠️ <b>Estoque insuficiente</b> para esta combinação de grades nos tamanhos: <b>{stockShort.join(', ').toUpperCase()}</b>. Reduza a quantidade de grades.
                </div>
              )}
            </div>
          )}

          {/* PACK */}
          {isPack && !multiGradePack && grades.length > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Grade do Pack (fechada por caixa)</p>
              <div className="overflow-x-auto rounded-xl border border-purple-100 bg-purple-50/30">
                <table className="min-w-full text-[12px]">
                  <thead className="bg-surface-container-lowest sticky top-0 z-10">
                    <tr className="bg-purple-100/60">
                      <th className="px-3 py-2 text-left text-purple-800 font-bold">Cor</th>
                      {Object.keys(grades[0]?.sizes || {})
                        .filter(s => !blockedSet.has(s.toUpperCase()))
                        .map(s => (
                          <th key={s} className="px-2 py-2 text-center text-purple-800 font-bold">{s}</th>
                        ))}
                      <th className="px-3 py-2 text-center text-purple-900 font-black">Tot/cx</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-100">
                    {grades.map(g => {
                      const filteredSizes = Object.entries(g.sizes).filter(([s]) => !blockedSet.has(s.toUpperCase()))
                      const filteredTotal = filteredSizes.reduce((sum, [, v]) => sum + Number(v || 0), 0)
                      return (
                      <tr key={g.color || 'default'} className="bg-white">
                        <td className="px-3 py-2 font-bold text-gray-800 whitespace-nowrap">{g.color || '—'}</td>
                        {filteredSizes.map(([s, v]) => (
                          <td key={s} className="px-2 py-2 text-center text-gray-700 font-medium">
                            {Number(v) > 0 ? v : <span className="text-gray-200">—</span>}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-center font-black text-purple-700 text-[13px]">{filteredTotal}</td>
                      </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="bg-purple-50 border-t-2 border-purple-200">
                    <tr>
                      <td className="px-3 py-2 font-bold text-purple-900 text-[13px]">TOTAL / cx</td>
                      <td colSpan={Object.keys(grades[0]?.sizes || {}).length} />
                      <td className="px-3 py-2 text-center font-black text-purple-900 text-[15px]">{totalPiecesPerPack}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Seletor de caixas */}
              <div>
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Quantidade de caixas</p>
                <div className="flex items-center justify-center gap-4 bg-purple-50 rounded-2xl p-4 border border-purple-100">
                  <button onClick={() => setBoxes(Math.max(1, boxes - 1))}
                    className="w-12 h-12 rounded-full bg-white border-2 border-purple-300 flex items-center justify-center shadow active:scale-95 text-purple-700 font-black text-xl">−</button>
                  <div className="text-center min-w-[80px]">
                    <p className="font-black text-4xl text-purple-700 leading-none">{boxes}</p>
                    <p className="text-[11px] text-purple-500 mt-1">{packPieces} peças total</p>
                  </div>
                  <button onClick={() => setBoxes(boxes + 1)}
                    className="w-12 h-12 rounded-full bg-white border-2 border-purple-300 flex items-center justify-center shadow active:scale-95 text-purple-700 font-black text-xl">+</button>
                </div>
              </div>
            </div>
          )}

          {/* REGULAR — grade em uma única linha horizontal */}
          {!isPack && availableSizes.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Quantidade por tamanho</p>
              <div className="overflow-x-auto">
                <div className="flex gap-2 pb-1" style={{ minWidth: availableSizes.length * 58 }}>
                  {availableSizes.map(s => {
                    const qty = sizes[s] || 0
                    return (
                      <div key={s} className="flex flex-col items-center flex-shrink-0" style={{ width: 52 }}>
                        {/* Tamanho */}
                        <span className={`text-[11px] font-bold mb-1 ${qty > 0 ? 'text-purple-600' : 'text-gray-400'}`}>{s}</span>
                        {/* Botão + */}
                        <button
                          onClick={() => setSizes(prev => ({...prev, [s]: (prev[s]||0)+1}))}
                          className={`w-full h-9 rounded-t-xl text-lg font-black border transition-colors active:scale-95 ${qty > 0 ? 'border-purple-300 bg-purple-50 text-purple-600' : 'border-gray-200 bg-white text-purple-400'}`}>+</button>
                        {/* Quantidade */}
                        <div className={`w-full h-10 border-x flex items-center justify-center text-xl font-black transition-colors ${qty > 0 ? 'border-purple-300 bg-purple-100 text-purple-700' : 'border-gray-200 bg-gray-50 text-gray-300'}`}>
                          {qty}
                        </div>
                        {/* Botão − */}
                        <button
                          onClick={() => setSizes(prev => ({...prev, [s]: Math.max(0, (prev[s]||0)-1)}))}
                          className={`w-full h-9 rounded-b-xl text-lg font-black border border-t-0 transition-colors active:scale-95 ${qty > 0 ? 'border-purple-300 bg-purple-50 text-purple-400' : 'border-gray-200 bg-white text-gray-300'}`}>−</button>
                      </div>
                    )
                  })}
                </div>
              </div>
              {regularPieces > 0 && (
                <div className="flex items-center justify-between bg-purple-50 rounded-xl px-4 py-3 border border-purple-100">
                  <span className="font-bold text-purple-700">{regularPieces} peças selecionadas</span>
                  <span className="font-black text-purple-800 text-lg">{fmtCur(totalPrice)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — botão confirmar */}
        <div className="p-4 border-t border-gray-100 space-y-2">
          {totalPieces > 0 && (
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500">{totalPieces} peças selecionadas</span>
              <span className="font-black text-purple-700 text-lg">{fmtCur(totalPrice)}</span>
            </div>
          )}
          <button
            onClick={handleConfirm}
            disabled={totalPieces === 0 || stockBlocked}
            className="w-full py-4 rounded-2xl font-black text-base transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: (totalPieces > 0 && !stockBlocked) ? 'linear-gradient(135deg,#f59e0b,#d97706)' : '#9ca3af', color: '#fff', boxShadow: (totalPieces > 0 && !stockBlocked) ? '0 4px 20px rgba(217,119,6,0.4)' : 'none' }}
          >
            {stockBlocked ? '⚠️ Estoque insuficiente' : '✅ CONFIRMAR E VOLTAR AO CATÁLOGO'}
          </button>
          <button onClick={onClose} className="w-full py-2 text-sm text-gray-400 hover:text-gray-600">
            Cancelar
          </button>
        </div>
      </div>
    </div>
    </>
  )
}

// ─── ProductCard — card com duas imagens (produto + modelo) ──────────────────

function ProductCard({ product, cartItems, onOpenModal }: {
  product: Product
  cartItems: CartItem[]
  onOpenModal: (p: Product) => void
}) {
  const isPack = product.type === 'pack' && product.grade_configs && product.grade_configs.length > 0
  const fmtCur = (v: number) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v)
  const inCart = cartItems.reduce((s, i) => s + i.total_pieces, 0)
  const inCartBoxes = cartItems.reduce((s, i) => s + i.boxes, 0)
  const images = (product.images?.filter(Boolean) as string[]) || (product.image_url ? [product.image_url] : [])
  const frontImg = images[0] ?? null
  const modelImg = images[1] ?? null

  return (
    <div
      className={`rounded-xl overflow-hidden active:scale-[0.98] transition-transform cursor-pointer ${
        inCart > 0
          ? 'border-2 border-green-500 shadow-md shadow-green-100'
          : 'border border-gray-200 shadow-sm hover:shadow-md hover:border-purple-200'
      }`}
      onClick={() => onOpenModal(product)}
    >
      {/* Duas imagens lado a lado */}
      <div className="flex">
        {/* Esquerda: foto do produto */}
        <div className="w-1/2 aspect-[3/4] bg-gray-100 overflow-hidden relative flex items-center justify-center">
          {frontImg
            ? <img src={frontImg} alt={product.reference} className="w-full h-full object-contain" loading="lazy" />
            : <Package className="h-10 w-10 text-gray-300" />
          }
          {inCart > 0 && (
            <div className="absolute top-1.5 left-1.5 bg-green-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow">
              {isPack ? `${inCartBoxes}cx` : `${inCart}pç`}
            </div>
          )}
        </div>
        {/* Direita: foto do modelo/lookbook */}
        <div className="w-1/2 aspect-[3/4] bg-gray-50 border-l border-gray-100 overflow-hidden relative flex items-center justify-center">
          {modelImg
            ? <img src={modelImg} alt={`${product.reference} modelo`} className="w-full h-full object-cover" loading="lazy" />
            : <Package className="h-10 w-10 text-gray-200" />
          }
        </div>
      </div>

      {/* Info do produto */}
      <div className={`px-3 py-2 ${inCart > 0 ? 'bg-green-50' : 'bg-white'}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="font-bold text-sm text-gray-900 truncate">{product.reference}</p>
          <p className="font-bold text-purple-700 text-sm whitespace-nowrap">{fmtCur(product.base_price)}<span className="text-[10px] font-normal text-gray-400">/pç</span></p>
        </div>
        {product.product_name && <p className="text-xs text-gray-500 truncate">{product.product_name}</p>}
        {inCart > 0 && (
          <p className="text-[10px] text-green-700 font-bold mt-0.5">✓ No carrinho</p>
        )}
      </div>
    </div>
  )
}
