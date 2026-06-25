import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ordersApi, companyApi } from '../api/client'

// Ordem lógica de tamanhos
const SIZE_ORDER = [
  'RN','PP','XP','P','M','G','GG','XG','EXG','XGG','2XG','3XG','4XG',
  '34','36','38','40','42','44','46','48','50','52','54','56','58','60',
  '1','2','4','6','8','10','12','14','16','18','U',
]

function sortSizes(sizes: string[]) {
  const isNum = (s: string) => /^\d+$/.test(s.trim())
  return [...sizes].sort((a, b) => {
    if (isNum(a) && isNum(b)) return parseInt(a, 10) - parseInt(b, 10)
    const ai = SIZE_ORDER.indexOf(a.trim().toUpperCase())
    const bi = SIZE_ORDER.indexOf(b.trim().toUpperCase())
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

function fmt(n: number | string | null | undefined) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  const s = String(d).trim()
  // Timestamp completo: usar Date() → converte para tz local
  if (s.includes('T') || s.includes('Z')) {
    try { return new Date(s).toLocaleDateString('pt-BR') } catch { return s }
  }
  // Data sem hora "YYYY-MM-DD": string split — evita UTC→local (-1 dia no Brasil)
  const [y, m, day] = s.substring(0, 10).split('-')
  if (!y || !m || !day) return s
  return `${day}/${m}/${y}`
}

interface GradeConfig {
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
  type: string
  boxes_count: number
  unit_price: number
  original_unit_price: number | null  // preço da tabela (nunca muda mesmo com ajuste manual)
  total_pieces: number
  subtotal: number
  sizes: Record<string, number> | null
  custom_grade: GradeConfig[] | null
  grade_configs: GradeConfig[] | null
}

interface Order {
  id: string
  order_number: number
  client_name: string
  client_trade_name: string | null
  client_city: string | null
  client_state: string | null
  client_phone: string | null
  client_whatsapp: string | null
  client_email: string | null
  client_cnpj: string | null
  client_state_registration: string | null
  client_address: string | null
  client_zip: string | null
  rep_name: string
  factory_name: string
  factory_contact: string | null
  price_table_name: string
  discount_pct: number
  cash_discount_pct: number
  total_pieces: number
  total_value: number
  notes: string | null
  status_name: string | null
  created_at: string
  payment_terms: string | null
  freight_type: string | null
  delivery_date: string | null
  industry_order_number: string | null
  buyer_name: string | null
  items: OrderItem[]
}

export function OrderPrint() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const autoprint = searchParams.get('autoprint') === '1'

  const { data: order } = useQuery<Order>({
    queryKey: ['order', id],
    queryFn: () => ordersApi.get(id!).then(r => r.data),
    enabled: !!id,
  })

  const { data: company } = useQuery<Record<string, string>>({
    queryKey: ['company'],
    queryFn: () => companyApi.get().then(r => r.data),
  })

  useEffect(() => {
    if (order && company) {
      document.title = `Pedido #${order.order_number} - ${order.client_name}`
      // Se veio com ?autoprint=1, dispara o diálogo automaticamente
      if (autoprint) {
        const timer = setTimeout(() => window.print(), 800)
        return () => clearTimeout(timer)
      }
    }
  }, [order, company, autoprint])

  if (!order || !company) {
    return (
      <div className="flex items-center justify-center min-h-screen text-outline text-sm">
        Preparando pedido para impressão…
      </div>
    )
  }

  // Coleta todos os tamanhos únicos de todos os itens
  const allSizes = new Set<string>()
  for (const item of order.items) {
    // Produto regular: usa item.sizes
    if (item.sizes && Object.keys(item.sizes).length > 0) {
      Object.keys(item.sizes).forEach(s => allSizes.add(s.trim()))
    } else if (item.custom_grade && item.custom_grade.length > 0) {
      // Pack com grade personalizada (escolhida pelo cliente, ex.: portal/PE)
      for (const gc of item.custom_grade) {
        Object.keys(gc.sizes).forEach(s => allSizes.add(s.trim()))
      }
    } else if (item.grade_configs) {
      // Pack: usa grade_configs (template do produto)
      for (const gc of item.grade_configs) {
        Object.keys(gc.sizes).forEach(s => allSizes.add(s.trim()))
      }
    }
  }
  const sizes = sortSizes(Array.from(allSizes))
  // Paisagem: sempre no modo distribuidora (Cusco) ou quando a tabela é larga
  const wide = import.meta.env.VITE_SINGLE_COMMISSION === 'true' || sizes.length > 12

  // Monta linhas da tabela
  interface PrintRow {
    seq: number
    reference: string
    product_name: string
    color: string
    gradeLabel: string
    sizeCols: Record<string, number>
    qtde: number
    unitPriceBase: number
    unitPriceDisc: number
    discPct: number
    total: number
  }

  const rows: PrintRow[] = []
  let seq = 0

  const cashDiscPct = Number(order.cash_discount_pct || 0)
  const commercialDiscPct = Math.max(0, Number(order.discount_pct || 0) - cashDiscPct)

  for (const item of order.items) {
    const hasCustomSizes = item.sizes && Object.keys(item.sizes).length > 0
      && Object.values(item.sizes).some(v => (v || 0) > 0)
    const hasCustomGrade = !!item.custom_grade && item.custom_grade.length > 0
      && item.custom_grade.some(gc => Object.values(gc.sizes || {}).some(v => (v || 0) > 0))

    if (hasCustomSizes && item.sizes && !hasCustomGrade) {
      // Produto regular SEM variantes: uma linha com as quantidades reais por tamanho
      seq++
      const qtde = Object.values(item.sizes).reduce((s, v) => s + (v || 0), 0)
      const sizeCols: Record<string, number> = {}
      for (const s of sizes) {
        sizeCols[s] = item.sizes[s] || 0
      }
      const gradeLabel = sortSizes(Object.keys(item.sizes).filter(s => (item.sizes![s] || 0) > 0)).join('/')
      const tabPrice = item.original_unit_price ?? item.unit_price
      const adjPrice = item.unit_price * (1 - commercialDiscPct / 100)
      rows.push({
        seq,
        reference: item.reference,
        product_name: item.product_name || '',
        color: '',
        gradeLabel,
        sizeCols,
        qtde,
        unitPriceBase: tabPrice,
        unitPriceDisc: adjPrice,
        discPct: commercialDiscPct,
        total: adjPrice * qtde,
      })
    } else if (hasCustomGrade && item.custom_grade) {
      // Pack com grade personalizada escolhida pelo cliente (ex.: pedidos via portal/PE)
      const tabPriceCustom = item.original_unit_price ?? item.unit_price
      const adjPriceCustom = item.unit_price * (1 - commercialDiscPct / 100)

      for (const gc of item.custom_grade) {
        seq++
        const qtde = (gc.total_pieces || Object.values(gc.sizes || {}).reduce((s, v) => s + (v || 0), 0)) * item.boxes_count
        const sizeCols: Record<string, number> = {}
        for (const s of sizes) {
          const rawVal = gc.sizes[s] ?? gc.sizes[s + ' '] ?? gc.sizes[' ' + s] ?? 0
          sizeCols[s] = rawVal * item.boxes_count
        }
        const gradeLabel = sortSizes(Object.keys(gc.sizes)).join('/')
        rows.push({
          seq,
          reference: item.reference,
          product_name: item.product_name || '',
          color: gc.color || '',
          gradeLabel,
          sizeCols,
          qtde,
          unitPriceBase: tabPriceCustom,
          unitPriceDisc: adjPriceCustom,
          discPct: commercialDiscPct,
          total: adjPriceCustom * qtde,
        })
      }
    } else if (
      item.grade_configs && item.grade_configs.length > 0 &&
      item.grade_configs.reduce((s, gc) => s + (gc.total_pieces || 0), 0) * item.boxes_count === item.total_pieces
    ) {
      // Pack: unit_price é preço POR PEÇA — usa o template padrão de grade do produto.
      const tabPricePack = item.original_unit_price ?? item.unit_price
      const adjPricePack = item.unit_price * (1 - commercialDiscPct / 100)

      for (const gc of item.grade_configs) {
        seq++
        const qtde = gc.total_pieces * item.boxes_count
        const sizeCols: Record<string, number> = {}
        for (const s of sizes) {
          const rawVal = gc.sizes[s] ?? gc.sizes[s + ' '] ?? gc.sizes[' ' + s] ?? 0
          sizeCols[s] = rawVal * item.boxes_count
        }
        const gradeLabel = sortSizes(Object.keys(gc.sizes)).join('/')
        rows.push({
          seq,
          reference: item.reference,
          product_name: item.product_name || '',
          color: gc.color || '',
          gradeLabel,
          sizeCols,
          qtde,
          unitPriceBase: tabPricePack,
          unitPriceDisc: adjPricePack,
          discPct: commercialDiscPct,
          total: adjPricePack * qtde,
        })
      }
    } else {
      // Sem grade configurada
      seq++
      const qtde = item.total_pieces || item.boxes_count
      const sizeCols: Record<string, number> = {}
      const tabP2 = item.original_unit_price ?? item.unit_price
      const adjP2 = item.unit_price * (1 - commercialDiscPct / 100)
      rows.push({
        seq,
        reference: item.reference,
        product_name: item.product_name || '',
        color: '',
        gradeLabel: '',
        sizeCols,
        qtde,
        unitPriceBase: tabP2,
        unitPriceDisc: adjP2,
        discPct: commercialDiscPct,
        total: adjP2 * qtde,
      })
    }
  }

  // Totais por tamanho
  const sizeTotals: Record<string, number> = {}
  for (const s of sizes) {
    sizeTotals[s] = rows.reduce((sum, r) => sum + (r.sizeCols[s] || 0), 0)
  }
  const totalQtde = rows.reduce((s, r) => s + r.qtde, 0)
  const totalGross = rows.reduce((s, r) => s + r.unitPriceBase * r.qtde, 0)
  const totalAfterCommercial = rows.reduce((s, r) => s + r.total, 0)  // = adjPrice × qtde (sem à vista)
  const totalCommercialDiscount = totalGross - totalAfterCommercial
  const totalCashDiscount = cashDiscPct > 0 ? Math.round(totalAfterCommercial * cashDiscPct / 100 * 100) / 100 : 0
  const totalFinal = totalAfterCommercial - totalCashDiscount  // valor líquido total (após todos descontos)

  const companyName    = company.name || 'SOMMA FORÇA DE VENDAS'
  const companyAddress = [company.address, company.city, company.state].filter(Boolean).join(' — ')
  const companyZip     = company.zip || ''
  const companyPhone   = company.phone || ''
  const companyWhats   = company.whatsapp || ''
  // Normaliza a URL do logo: se for relativa (/uploads/...), torna absoluta
  const rawLogoUrl = company.logo_url || ''
  const logoUrl = rawLogoUrl
    ? rawLogoUrl.startsWith('http')
      ? rawLogoUrl
      : `${window.location.origin}${rawLogoUrl}`
    : null

  const clientAddress  = [
    order.client_address,
    order.client_city && order.client_state
      ? `${order.client_city}-${order.client_state}`
      : (order.client_city || order.client_state || ''),
    order.client_zip ? `CEP ${order.client_zip}` : '',
  ].filter(Boolean).join(', ')

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #000; background: #fff; }
        .page { width: ${wide ? '297mm' : '210mm'}; min-height: ${wide ? '210mm' : '297mm'}; padding: 8mm 8mm; margin: 0 auto; background: #fff; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 2px 4px; }
        th { background: #f0f0f0; font-weight: bold; text-align: center; }
        td { vertical-align: middle; }
        .no-border td, .no-border th { border: none; }
        .section-title { font-weight: bold; font-size: 10px; background: #e0e0e0; padding: 3px 6px; margin: 6px 0 3px; border-left: 3px solid #333; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; margin-bottom: 4px; }
        .info-row { display: flex; gap: 4px; font-size: 9.5px; }
        .info-label { font-weight: bold; white-space: nowrap; }
        .header-box { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; border-bottom: 2px solid #333; padding-bottom: 8px; }
        .company-info { flex: 1; }
        .company-name { font-size: 18px; font-weight: bold; margin-bottom: 2px; }
        .logo-area { width: 160px; text-align: right; flex-shrink: 0; }
        .logo-area img { max-width: 80px; max-height: 60px; object-fit: contain; }
        .items-table { table-layout: auto; width: 100%; }
        .items-table th { font-size: 9px; padding: 1px 2px; white-space: nowrap; }
        .items-table td { font-size: 9px; padding: 1px 2px; white-space: nowrap; }
        .items-table .ref { font-weight: bold; }
        .items-table .num { text-align: right; }
        .items-table .ctr { text-align: center; }
        .totals-row td { font-weight: bold; background: #f5f5f5; }
        .grand-total { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #ccc; margin-top: 6px; }
        .grand-total-cell { padding: 5px 8px; border-right: 1px solid #ccc; text-align: center; }
        .grand-total-cell:last-child { border-right: none; }
        .grand-total-cell .label { font-size: 9px; color: #555; }
        .grand-total-cell .value { font-size: 12px; font-weight: bold; }
        .obs-box { border: 1px solid #ccc; padding: 5px 8px; margin-top: 6px; min-height: 30px; font-size: 9px; }
        .signatures { display: flex; justify-content: space-between; margin-top: 20mm; gap: 20mm; }
        .sig-line { flex: 1; text-align: center; }
        .sig-line .line { border-top: 1px solid #333; margin-bottom: 4px; }
        .sig-line .name { font-size: 9px; }
        .print-btn { position: fixed; top: 8px; right: 12px; background: #1d4ed8; color: #fff; border: none; padding: 6px 16px; border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer; z-index: 999; }
        .footer-msg { margin-top: 12px; padding: 6px 10px; border-top: 1px solid #ccc; text-align: center; font-size: 10px; color: #555; font-style: italic; }
        @media print {
          body { margin: 0; }
          .page { padding: 8mm 10mm; width: 100%; }
          .print-btn { display: none; }
          @page { size: A4 ${wide ? 'landscape' : 'portrait'}; margin: 0; }
        }
      `}</style>

      {/* Botões flutuantes — somem ao imprimir */}
      <button className="print-btn" onClick={() => window.print()}>
        🖨️ Imprimir / PDF
      </button>
      <button
        className="print-btn"
        style={{ right: 'auto', left: 12, background: '#6b7280' }}
        onClick={() => navigate(`/orders/${id}`)}
      >
        ← Voltar
      </button>

      <div className="page">
        {/* ── CABEÇALHO ── */}
        <div className="header-box">
          <div className="company-info">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Logo"
                style={{ height: 224, marginBottom: 2, objectFit: 'contain', display: 'block', maxWidth: 500 }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
            ) : null}
            <div className="company-name">{companyName}</div>
            <div style={{ fontSize: 12 }}>{companyAddress}{companyZip ? ` — CEP ${companyZip}` : ''}</div>
            {(companyPhone || companyWhats) && (
              <div style={{ fontSize: 12, marginTop: 2 }}>
                {companyPhone && <span>Tel: {companyPhone}</span>}
                {companyPhone && companyWhats && ' · '}
                {companyWhats && <span>WhatsApp: {companyWhats}</span>}
              </div>
            )}
            {company.email && <div style={{ fontSize: 12 }}>{company.email}</div>}
          </div>
          <div className="logo-area" style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'flex-end', alignSelf: 'stretch' }}>
            <span style={{ fontSize: 48, fontWeight: 900, color: '#111', lineHeight: 1, letterSpacing: '-1px' }}>
              {order.factory_name}
            </span>
          </div>
        </div>

        {/* ── CLIENTE ── */}
        <div className="section-title">Informações sobre o Cliente</div>
        <div className="info-grid" style={{ marginBottom: 6 }}>
          <div>
            <div className="info-row"><span className="info-label">Razão Social:</span> {order.client_name}</div>
            <div className="info-row"><span className="info-label">Nome Fantasia:</span> {order.client_trade_name || '—'}</div>
            <div className="info-row"><span className="info-label">CNPJ/CPF:</span> {order.client_cnpj || '—'}</div>
            <div className="info-row"><span className="info-label">Inscrição Estadual:</span> {order.client_state_registration || '—'}</div>
            <div className="info-row"><span className="info-label">E-mail:</span> {order.client_email || '—'}</div>
            <div className="info-row"><span className="info-label">WhatsApp:</span> {order.client_whatsapp || '—'}</div>
            <div className="info-row" style={{ marginTop: 2 }}><span className="info-label">Endereço:</span> {clientAddress || '—'}</div>
          </div>
          <div>
            <div className="info-row"><span className="info-label">Comprador:</span> {order.buyer_name || '—'}</div>
            <div className="info-row"><span className="info-label">Telefone:</span> {order.client_phone || '—'}</div>
          </div>
        </div>

        {/* ── PEDIDO ── */}
        <div className="section-title">Informações sobre o PEDIDO — Nº <strong>{order.order_number}</strong></div>
        <div className="info-grid" style={{ marginBottom: 6 }}>
          <div>
            <div className="info-row"><span className="info-label">Indústria:</span> {order.factory_name}</div>
            {order.factory_contact && <div className="info-row"><span className="info-label">Contato Indústria:</span> {order.factory_contact}</div>}
            <div className="info-row"><span className="info-label">Data da Venda:</span> {fmtDate(order.created_at)}</div>
            <div className="info-row"><span className="info-label">Condição de Pagto:</span> {order.payment_terms || '—'}</div>
            <div className="info-row"><span className="info-label">Nº na Indústria:</span> {order.industry_order_number || '—'}</div>
          </div>
          <div>
            <div className="info-row"><span className="info-label">Tabela de Preço:</span> {order.price_table_name}</div>
            <div className="info-row"><span className="info-label">Previsão de Entrega:</span> {fmtDate(order.delivery_date)}</div>
            <div className="info-row"><span className="info-label">Tipo de Frete:</span> {order.freight_type || 'CIF'}</div>
            <div className="info-row"><span className="info-label">Representante:</span> {order.rep_name}</div>
          </div>
        </div>

        {/* ── TABELA DE ITENS ── */}
        <table className="items-table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th style={{ width: '2%' }}>#</th>
              <th style={{ width: '8%' }}>Cód.</th>
              <th style={{ width: '15%' }}>Produto</th>
              <th style={{ width: '10%' }}>Cor</th>
              {sizes.map(s => <th key={s}>{s}</th>)}
              <th style={{ width: '4%' }}>Qtde</th>
              <th style={{ width: '6%' }}>R$ Tab.</th>
              <th style={{ width: '4%' }}>%Desc. Coml.</th>
              <th style={{ width: '7%' }}>R$ c/Desc.</th>
              <th style={{ width: '7%' }}>R$ Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.seq}>
                <td className="ctr">{row.seq}</td>
                <td className="ref">{row.reference}</td>
                <td>{row.product_name}</td>
                <td>{row.color}</td>
                {sizes.map(s => (
                  <td key={s} className="ctr">{row.sizeCols[s] > 0 ? row.sizeCols[s] : ''}</td>
                ))}
                <td className="ctr" style={{ fontWeight: 'bold' }}>{row.qtde}</td>
                <td className="num">{fmt(row.unitPriceBase)}</td>
                <td className="ctr">{fmt(row.discPct)}</td>
                <td className="num">{fmt(row.unitPriceDisc)}</td>
                <td className="num" style={{ fontWeight: 'bold' }}>{fmt(row.total)}</td>
              </tr>
            ))}
            {/* Linha de totais por tamanho */}
            <tr className="totals-row">
              <td colSpan={4} className="ctr" style={{ fontStyle: 'italic' }}>Itens:</td>
              {sizes.map(s => (
                <td key={s} className="ctr">{sizeTotals[s] > 0 ? sizeTotals[s] : ''}</td>
              ))}
              <td className="ctr" style={{ fontWeight: 'bold' }}>{totalQtde}</td>
              <td colSpan={4}></td>
            </tr>
          </tbody>
        </table>

        {/* ── RESUMO FINANCEIRO ── */}
        <div className="grand-total">
          <div className="grand-total-cell">
            <div className="label">Total Tabela (R$)</div>
            <div className="value">{fmt(totalGross)}</div>
          </div>
          <div className="grand-total-cell">
            <div className="label">Total c/ Desc. Comercial (R$)</div>
            <div className="value">{fmt(totalAfterCommercial)}</div>
          </div>
          <div className="grand-total-cell">
            <div className="label">Desc. Comercial R$ Total</div>
            <div className="value">{fmt(totalCommercialDiscount)}</div>
          </div>
          <div className="grand-total-cell">
            <div className="label">Total Qtde Itens</div>
            <div className="value">{totalQtde}</div>
          </div>
        </div>

        {/* ── VALOR LÍQUIDO TOTAL (com desconto à vista) ── */}
        <div style={{ border: '1px solid #ccc', marginTop: 4, padding: '5px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f9f9f9' }}>
          {cashDiscPct > 0 ? (
            <div style={{ fontSize: 10, color: '#555' }}>
              Desconto À Vista ({cashDiscPct.toFixed(1)}%)
              <span style={{ marginLeft: 6, fontWeight: 'bold', color: '#c00' }}>
                -{fmt(totalCashDiscount)}
              </span>
            </div>
          ) : (
            <div />
          )}
          <div style={{ fontSize: 12, fontWeight: 'bold' }}>
            VALOR LÍQUIDO TOTAL:&nbsp;
            <span style={{ fontSize: 14 }}>{fmt(totalFinal)}</span>
          </div>
        </div>

        {/* ── OBSERVAÇÕES ── */}
        <div style={{ marginTop: 6, fontSize: 9, fontWeight: 'bold' }}>Observação</div>
        <div className="obs-box">{order.notes || ''}</div>

        {/* ── ASSINATURAS ── */}
        <div className="signatures">
          <div className="sig-line">
            <div className="line" />
            <div className="name">{order.buyer_name || 'Comprador'}</div>
          </div>
          <div className="sig-line">
            <div className="line" />
            <div className="name">{order.rep_name} — Vendedor</div>
          </div>
        </div>

        {/* ── MENSAGEM DE RODAPÉ ── */}
        {company.order_footer && (
          <div className="footer-msg">
            {company.order_footer}
          </div>
        )}

        {/* ── ASSINATURA SOMMA ── */}
        <div style={{ marginTop: 16, paddingTop: 8, borderTop: '1px solid #e5e7eb', textAlign: 'center', fontSize: 10, color: '#9ca3af' }}>
          SOMMA Technology · Erechim | RS · (54) 9.9162-5024
        </div>
      </div>
    </>
  )
}
