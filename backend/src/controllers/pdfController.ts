import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

const SIZE_ORDER = ['RN','PP','XP','P','M','G','GG','XG','EXG','XGG','2XG','3XG','4XG',
  '34','36','38','40','42','44','46','48','50','52','54','56','58','60','1','2','4','6','8','10','12','14','16','18','U']

function sortSizes(sizes: string[]) {
  return [...sizes].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a.trim().toUpperCase())
    const bi = SIZE_ORDER.indexOf(b.trim().toUpperCase())
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1; if (bi === -1) return -1
    return ai - bi
  })
}

function fmt(n: number | string | null | undefined) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('pt-BR') } catch { return String(d) }
}

function padNum(n: number) { return String(n).padStart(4, '0') }

export async function getOrderPdf(req: AuthRequest, res: Response) {
  try {
    const { rows } = await query(
      `SELECT o.*,
        c.name as client_name, c.trade_name as client_trade_name,
        c.city as client_city, c.state as client_state,
        c.phone as client_phone, c.cnpj as client_cnpj,
        c.address as client_address,
        u.name as rep_name, u.email as rep_email,
        f.name as factory_name,
        pt.name as price_table_name,
        cs.company_name, cs.phone as company_phone, cs.email as company_email,
        s.name as status_name
       FROM orders o
       JOIN clients c ON c.id = o.client_id
       JOIN users u ON u.id = o.rep_id
       JOIN factories f ON f.id = o.factory_id
       JOIN price_tables pt ON pt.id = o.price_table_id
       LEFT JOIN order_statuses s ON s.id = o.status_id
       LEFT JOIN company_settings cs ON cs.id = (SELECT id FROM company_settings LIMIT 1)
       WHERE o.id = $1`,
      [req.params.id]
    )
    if (!rows[0]) { res.status(404).json({ error: 'Pedido não encontrado' }); return }

    const isAdmin = req.user!.role === 'admin'
    if (!isAdmin && rows[0].rep_id !== req.user!.id) {
      res.status(403).json({ error: 'Acesso negado' }); return
    }

    const o = rows[0]
    const { rows: items } = await query(
      `SELECT oi.*, p.product_name, p.model, p.type, p.size_range,
         json_agg(gc ORDER BY gc.sort_order) FILTER (WHERE gc.id IS NOT NULL) as grade_configs
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN grade_configs gc ON gc.product_id = oi.product_id
       WHERE oi.order_id = $1
       GROUP BY oi.id, p.product_name, p.model, p.type, p.size_range
       ORDER BY oi.created_at`,
      [req.params.id]
    )

    // Gera HTML do pedido para converter em PDF no browser
    const companyName = o.company_name || 'SOMMA Força de Vendas'
    const num = padNum(o.order_number)

    let itemsHtml = ''
    for (const item of items) {
      const isPack = item.type === 'pack'
      const grades = item.grade_configs || []
      const descName = [item.product_name, item.model].filter(Boolean).join(' — ') || item.reference
      const unitPrice = Number(item.unit_price || 0)
      const discountedPrice = unitPrice * (1 - Number(o.discount_pct || 0) / 100)
      const subtotal = Number(item.subtotal || 0)
      const pieces = Number(item.total_pieces || 0)

      itemsHtml += `<tr class="item-row">
        <td class="ref">${item.reference}</td>
        <td>${descName}</td>
        <td class="center">${isPack ? `${item.boxes_count}cx · ${pieces}pç` : `${pieces}pç`}</td>
        <td class="right">R$ ${fmt(discountedPrice)}/pç</td>
        <td class="right total">R$ ${fmt(subtotal)}</td>
      </tr>`

      if (isPack && grades.length > 0) {
        const allSizes = sortSizes([...new Set(grades.flatMap((g: {sizes: Record<string,number>}) => Object.keys(g.sizes)))] as string[])
        let gradeHtml = `<tr class="grade-row"><td colspan="5"><div class="grade-table"><table><thead><tr><th>Cor</th>${allSizes.map(s => `<th>${s}</th>`).join('')}<th>Tot/cx</th></tr></thead><tbody>`
        for (const g of grades) {
          gradeHtml += `<tr><td class="color">${g.color || '—'}</td>${allSizes.map((s: string) => `<td>${Number(g.sizes[s] || 0) > 0 ? g.sizes[s] : '—'}</td>`).join('')}<td class="total">${g.total_pieces}</td></tr>`
        }
        gradeHtml += `</tbody></table></div></td></tr>`
        itemsHtml += gradeHtml
      } else if (!isPack && item.sizes) {
        const sizeEntries = sortSizes(Object.keys(item.sizes)).filter(s => Number(item.sizes[s]) > 0)
        if (sizeEntries.length > 0) {
          itemsHtml += `<tr class="grade-row"><td colspan="5"><div class="sizes-inline">${sizeEntries.map(s => `<span><b>${s}</b>: ${item.sizes[s]}</span>`).join(' · ')}</div></td></tr>`
        }
      }
    }

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pedido #${num}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1f2937; background: #fff; }
  .page { max-width: 900px; margin: 0 auto; padding: 20px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #E07B27; padding-bottom: 12px; margin-bottom: 16px; }
  .company-name { font-size: 20px; font-weight: 900; color: #1B2337; }
  .company-sub { font-size: 9px; color: #E07B27; font-weight: bold; letter-spacing: 2px; margin-top: 2px; }
  .order-num { font-size: 28px; font-weight: 900; color: #E07B27; text-align: right; }
  .order-date { font-size: 11px; color: #6b7280; text-align: right; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px; padding: 12px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; }
  .info-section label { font-size: 9px; font-weight: bold; color: #E07B27; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px; }
  .info-section .val { font-size: 13px; font-weight: bold; color: #1B2337; }
  .info-section .sub { font-size: 11px; color: #6b7280; margin-top: 1px; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  table.items thead th { background: #1B2337; color: #fff; padding: 6px 8px; text-align: left; font-size: 11px; }
  table.items thead th.center { text-align: center; }
  table.items thead th.right { text-align: right; }
  tr.item-row { border-bottom: 1px solid #f3f4f6; }
  tr.item-row:nth-child(even) { background: #f9fafb; }
  tr.item-row td { padding: 6px 8px; }
  td.ref { font-weight: bold; color: #4f46e5; font-family: monospace; }
  td.center { text-align: center; }
  td.right { text-align: right; }
  td.total { font-weight: bold; }
  tr.grade-row td { padding: 0 8px 8px; }
  .grade-table table { border-collapse: collapse; font-size: 10px; }
  .grade-table th, .grade-table td { border: 1px solid #e5e7eb; padding: 3px 6px; text-align: center; }
  .grade-table th { background: #f3f4f6; font-weight: bold; }
  .grade-table .color { text-align: left; font-weight: bold; }
  .grade-table .total { font-weight: bold; color: #4f46e5; }
  .sizes-inline { font-size: 11px; color: #6b7280; padding: 4px 0; }
  .totals { display: flex; justify-content: flex-end; margin-top: 8px; }
  .totals-box { border: 2px solid #e5e7eb; border-radius: 8px; padding: 12px 20px; min-width: 260px; }
  .totals-box .row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 12px; }
  .totals-box .grand { font-size: 18px; font-weight: 900; color: #E07B27; border-top: 2px solid #e5e7eb; padding-top: 8px; margin-top: 8px; display: flex; justify-content: space-between; }
  .obs { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; margin-top: 12px; }
  .obs label { font-size: 9px; font-weight: bold; color: #E07B27; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px; }
  .footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 10px; color: #9ca3af; }
  .print-bar { position: fixed; top: 0; left: 0; right: 0; background: #1B2337; padding: 10px 20px; display: flex; gap: 12px; align-items: center; z-index: 999; }
  .print-bar h2 { color: #fff; font-size: 14px; flex: 1; }
  .btn { padding: 8px 18px; border-radius: 8px; font-weight: bold; font-size: 13px; cursor: pointer; border: none; }
  .btn-orange { background: #E07B27; color: #fff; }
  .btn-gray { background: #6b7280; color: #fff; }
  @media print {
    .print-bar { display: none; }
    .page { padding: 10mm; }
    @page { size: A4; margin: 0; }
  }
  @media screen { .page { margin-top: 56px; } }
</style>
</head>
<body>
<div class="print-bar">
  <h2>Pedido #${num} — ${o.client_name}</h2>
  <button class="btn btn-orange" onclick="window.print()">⬇️ Salvar como PDF</button>
  <button class="btn btn-gray" onclick="window.close()">✕ Fechar</button>
</div>
<div class="page">
  <div class="header">
    <div>
      <div class="company-name">${companyName}</div>
      <div class="company-sub">FORÇA DE VENDAS</div>
    </div>
    <div>
      <div class="order-num">PEDIDO #${num}</div>
      <div class="order-date">Emitido em ${fmtDate(o.created_at)}</div>
      ${o.status_name ? `<div class="order-date" style="margin-top:4px;font-weight:bold;">${o.status_name}</div>` : ''}
    </div>
  </div>

  <div class="info-grid">
    <div class="info-section">
      <label>Cliente</label>
      <div class="val">${o.client_name}</div>
      ${o.client_trade_name ? `<div class="sub">${o.client_trade_name}</div>` : ''}
      ${o.client_cnpj ? `<div class="sub">CNPJ: ${o.client_cnpj}</div>` : ''}
      ${o.client_city ? `<div class="sub">${o.client_city}${o.client_state ? '/' + o.client_state : ''}</div>` : ''}
    </div>
    <div class="info-section">
      <label>Representante</label>
      <div class="val">${o.rep_name}</div>
      ${o.rep_email ? `<div class="sub">${o.rep_email}</div>` : ''}
      <br>
      <label>Marca / Tabela</label>
      <div class="val">${o.factory_name}</div>
      <div class="sub">${o.price_table_name}</div>
    </div>
    <div class="info-section">
      <label>Detalhes</label>
      ${o.payment_terms ? `<div class="sub">Pagamento: ${o.payment_terms}</div>` : ''}
      ${o.delivery_date ? `<div class="sub">Entrega: ${fmtDate(o.delivery_date)}</div>` : ''}
      ${o.freight_type ? `<div class="sub">Frete: ${o.freight_type}</div>` : ''}
      ${o.buyer_name ? `<div class="sub">Comprador: ${o.buyer_name}</div>` : ''}
      ${Number(o.discount_pct) > 0 ? `<div class="sub">Desconto à Vista: ${Number(o.discount_pct).toFixed(1)}%</div>` : ''}
      ${o.industry_order_number ? `<div class="sub">Nº Fábrica: ${o.industry_order_number}</div>` : ''}
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>Referência</th>
        <th>Produto</th>
        <th class="center">Qtd</th>
        <th class="right">Vl. Unit</th>
        <th class="right">Subtotal</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  <div class="totals">
    <div class="totals-box">
      <div class="row"><span>Total de Peças</span><span><b>${Number(o.total_pieces || 0).toLocaleString('pt-BR')} pç</b></span></div>
      ${Number(o.discount_pct) > 0 ? `<div class="row"><span>Desconto à Vista</span><span>${Number(o.discount_pct).toFixed(1)}%</span></div>` : ''}
      <div class="grand"><span>TOTAL GERAL</span><span>R$ ${fmt(o.total_value)}</span></div>
    </div>
  </div>

  ${o.notes ? `<div class="obs"><label>Observações</label>${o.notes}</div>` : ''}

  <div class="footer">
    ${companyName}${o.company_phone ? ' · ' + o.company_phone : ''}${o.company_email ? ' · ' + o.company_email : ''}
    <div style="margin-top:4px;font-size:9px;color:#d1d5db;">SOMMA Technology · Erechim | RS · (54) 9.9162-5024</div>
  </div>
</div>
</body>
</html>`

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch (err) {
    console.error('PDF error:', err)
    res.status(500).json({ error: 'Erro ao gerar PDF' })
  }
}
