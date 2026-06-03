/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'
import PdfPrinter from 'pdfmake'

const SIZE_ORDER = [
  'RN','PP','XP','P','M','G','GG','XG','EXG','XGG','2XG','3XG','4XG',
  '34','36','38','40','42','44','46','48','50','52','54','56','58','60',
  '1','2','4','6','8','10','12','14','16','18','U',
]

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

const ORANGE = '#E07B27'
const NAVY   = '#1B2337'
const GRAY   = '#6B7A8D'
const LGRAY  = '#F3F4F6'

const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
}

export async function getOrderPdf(req: AuthRequest, res: Response) {
  try {
    // ── Buscar dados do pedido ──────────────────────────────────────────
    const { rows } = await query(
      `SELECT o.*,
        c.name as client_name, c.trade_name as client_trade_name,
        c.city as client_city, c.state as client_state,
        c.phone as client_phone, c.whatsapp as client_whatsapp,
        c.email as client_email, c.cnpj as client_cnpj,
        c.address as client_address,
        u.name as rep_name, u.email as rep_email,
        f.name as factory_name,
        pt.name as price_table_name,
        cs.company_name, cs.cnpj as company_cnpj, cs.phone as company_phone,
        cs.email as company_email, cs.address as company_address,
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
      `SELECT oi.*,
         p.product_name, p.model, p.type, p.size_range,
         json_agg(gc ORDER BY gc.sort_order) FILTER (WHERE gc.id IS NOT NULL) as grade_configs
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN grade_configs gc ON gc.product_id = oi.product_id
       WHERE oi.order_id = $1
       GROUP BY oi.id, p.product_name, p.model, p.type, p.size_range
       ORDER BY oi.created_at`,
      [req.params.id]
    )

    // ── Montar linhas de itens ──────────────────────────────────────────
    const itemRows: TableCell[][] = []

    for (const item of items) {
      const isPack = item.type === 'pack'
      const grades = item.grade_configs || []
      const descName = [item.product_name, item.model].filter(Boolean).join(' — ') || item.reference
      const unitPrice = Number(item.unit_price || 0)
      const discountedPrice = unitPrice * (1 - Number(o.discount_pct || 0) / 100)
      const subtotal = Number(item.subtotal || 0)
      const pieces = Number(item.total_pieces || 0)

      if (isPack && grades.length > 0) {
        // Cabeçalho do pack
        itemRows.push([
          { text: item.reference, style: 'itemRef', rowSpan: grades.length + 1 },
          { text: descName, style: 'itemDesc', colSpan: 3, rowSpan: 1 },
          {}, {},
          { text: `${item.boxes_count} cx`, style: 'itemVal', rowSpan: grades.length + 1 },
          { text: `${pieces} pç`, style: 'itemVal', rowSpan: grades.length + 1 },
          { text: `R$ ${fmt(discountedPrice)}/pç`, style: 'itemVal', rowSpan: grades.length + 1 },
          { text: `R$ ${fmt(subtotal)}`, style: 'itemTotal', rowSpan: grades.length + 1 },
        ])
        // Linhas de grade por cor
        for (const g of grades) {
          const allSizes = sortSizes(Object.keys(g.sizes || {}))
          const sizeStr = allSizes
            .filter(s => (g.sizes[s] || 0) > 0)
            .map(s => `${s}:${g.sizes[s]}`)
            .join('  ')
          itemRows.push([
            { text: g.color || 'ÚNICO', style: 'gradeColor' },
            { text: sizeStr || '—', style: 'gradeSizes', colSpan: 2 },
            {},
          ])
        }
      } else {
        // Produto regular
        const sizes = item.sizes || {}
        const allSizes = sortSizes(Object.keys(sizes))
        const filledSizes = allSizes.filter(s => (sizes[s] || 0) > 0)
        const sizeStr = filledSizes.map(s => `${s}:${sizes[s]}`).join('  ') || '—'

        itemRows.push([
          { text: item.reference, style: 'itemRef' },
          { text: descName, style: 'itemDesc' },
          { text: sizeStr, style: 'gradeSizes', colSpan: 2 },
          {},
          { text: '1', style: 'itemVal' },
          { text: `${pieces} pç`, style: 'itemVal' },
          { text: `R$ ${fmt(discountedPrice)}/pç`, style: 'itemVal' },
          { text: `R$ ${fmt(subtotal)}`, style: 'itemTotal' },
        ])
      }
    }

    // ── Documento PDF ───────────────────────────────────────────────────
    const companyName = o.company_name || 'Somma Gestão Comercial'
    const docDef: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [36, 36, 36, 48],
      defaultStyle: { font: 'Helvetica', fontSize: 9, color: '#1F2937' },

      header: () => ({
        columns: [
          {
            stack: [
              { text: companyName, fontSize: 16, bold: true, color: NAVY },
              { text: 'GESTÃO COMERCIAL', fontSize: 7, color: ORANGE, bold: true, letterSpacing: 2, marginTop: 1 },
            ],
            margin: [36, 18, 0, 0],
          },
          {
            stack: [
              { text: `PEDIDO #${padNum(o.order_number)}`, fontSize: 18, bold: true, color: ORANGE, alignment: 'right' },
              { text: `Emitido em ${fmtDate(o.created_at)}`, fontSize: 8, color: GRAY, alignment: 'right' },
            ],
            margin: [0, 18, 36, 0],
          },
        ],
      }),

      footer: (_page: number, pages: number) => ({
        columns: [
          { text: `${companyName}${o.company_phone ? ' · ' + o.company_phone : ''}`, fontSize: 7, color: GRAY, margin: [36, 0, 0, 0] },
          { text: `Página ${_page} de ${pages}`, fontSize: 7, color: GRAY, alignment: 'right', margin: [0, 0, 36, 0] },
        ],
        margin: [0, 8, 0, 0],
      }),

      content: [
        // ── Divisor ──
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 2, lineColor: ORANGE }], margin: [0, 0, 0, 12] },

        // ── Bloco info: cliente + rep + pedido ──
        {
          columns: [
            // Cliente
            {
              stack: [
                { text: 'CLIENTE', fontSize: 7, bold: true, color: ORANGE, letterSpacing: 1 },
                { text: o.client_name, fontSize: 11, bold: true, color: NAVY, marginTop: 2 },
                o.client_trade_name ? { text: o.client_trade_name, fontSize: 9, color: GRAY } : null,
                o.client_cnpj ? { text: `CNPJ: ${o.client_cnpj}`, fontSize: 8, color: GRAY, marginTop: 2 } : null,
                o.client_city ? { text: `${o.client_city}${o.client_state ? ' / ' + o.client_state : ''}`, fontSize: 8, color: GRAY } : null,
                o.client_phone ? { text: `Tel: ${o.client_phone}`, fontSize: 8, color: GRAY } : null,
              ].filter(Boolean) as Content[],
              width: '45%',
            },
            // Representante e fábrica
            {
              stack: [
                { text: 'REPRESENTANTE', fontSize: 7, bold: true, color: ORANGE, letterSpacing: 1 },
                { text: o.rep_name, fontSize: 10, bold: true, color: NAVY, marginTop: 2 },
                o.rep_email ? { text: o.rep_email, fontSize: 8, color: GRAY } : null,
                { text: '', marginTop: 6 },
                { text: 'MARCA / TABELA', fontSize: 7, bold: true, color: ORANGE, letterSpacing: 1 },
                { text: o.factory_name, fontSize: 10, bold: true, color: NAVY, marginTop: 2 },
                { text: o.price_table_name, fontSize: 8, color: GRAY },
              ].filter(Boolean) as Content[],
              width: '30%',
            },
            // Detalhes do pedido
            {
              stack: [
                { text: 'DETALHES', fontSize: 7, bold: true, color: ORANGE, letterSpacing: 1 },
                ...(o.payment_terms ? [{ text: `Pagamento: ${o.payment_terms}`, fontSize: 8, color: GRAY, marginTop: 2 }] : []),
                ...(o.delivery_date ? [{ text: `Entrega: ${fmtDate(o.delivery_date)}`, fontSize: 8, color: GRAY }] : []),
                ...(o.freight_type ? [{ text: `Frete: ${o.freight_type}`, fontSize: 8, color: GRAY }] : []),
                ...(o.buyer_name ? [{ text: `Comprador: ${o.buyer_name}`, fontSize: 8, color: GRAY }] : []),
                ...(o.discount_pct > 0 ? [{ text: `Desconto: ${o.discount_pct}%`, fontSize: 8, color: GRAY }] : []),
                ...(o.status_name ? [{ text: `Status: ${o.status_name}`, fontSize: 8, bold: true, color: NAVY, marginTop: 4 }] : []),
              ],
              width: '25%',
            },
          ],
          columnGap: 12,
          margin: [0, 0, 0, 14],
        },

        // ── Tabela de itens ──
        {
          table: {
            headerRows: 1,
            widths: [60, '*', 100, 30, 30, 42, 64, 56],
            body: [
              // Header
              [
                { text: 'REFERÊNCIA', style: 'tableHeader' },
                { text: 'PRODUTO', style: 'tableHeader' },
                { text: 'TAMANHOS / GRADE', style: 'tableHeader', colSpan: 2 }, {},
                { text: 'CX', style: 'tableHeader' },
                { text: 'PEÇAS', style: 'tableHeader' },
                { text: 'VL UNIT', style: 'tableHeader' },
                { text: 'SUBTOTAL', style: 'tableHeader' },
              ],
              ...itemRows,
            ],
          },
          layout: {
            hLineWidth: (i: number) => (i === 0 || i === 1) ? 0 : 0.5,
            vLineWidth: () => 0,
            hLineColor: () => '#E5E7EB',
            fillColor: (rowIndex: number) => rowIndex === 0 ? NAVY : (rowIndex % 2 === 0 ? LGRAY : null),
          },
          margin: [0, 0, 0, 12],
        },

        // ── Totais ──
        {
          columns: [
            // Observações
            o.notes ? {
              stack: [
                { text: 'OBSERVAÇÕES', fontSize: 7, bold: true, color: ORANGE, letterSpacing: 1 },
                { text: o.notes, fontSize: 8, color: GRAY, marginTop: 2, italics: true },
              ],
              width: '*',
            } : { text: '', width: '*' },
            // Valores
            {
              table: {
                widths: ['*', 80],
                body: [
                  [
                    { text: 'Total de Peças', fontSize: 8, color: GRAY, border: [false, false, false, false] },
                    { text: `${Number(o.total_pieces || 0).toLocaleString('pt-BR')} pç`, fontSize: 8, bold: true, alignment: 'right', border: [false, false, false, false] },
                  ],
                  ...(Number(o.discount_pct) > 0 ? [[
                    { text: `Desconto (${o.discount_pct}%)`, fontSize: 8, color: GRAY, border: [false, false, false, false] },
                    { text: `− R$ ${fmt(Number(o.total_value || 0) / (1 - Number(o.discount_pct) / 100) - Number(o.total_value || 0))}`, fontSize: 8, color: '#EF4444', alignment: 'right', border: [false, false, false, false] },
                  ]] : []),
                  [
                    { text: 'TOTAL GERAL', fontSize: 11, bold: true, color: NAVY, border: [false, true, false, false] },
                    { text: `R$ ${fmt(o.total_value)}`, fontSize: 13, bold: true, color: ORANGE, alignment: 'right', border: [false, true, false, false] },
                  ],
                ],
              },
              layout: { hLineColor: () => '#E5E7EB' },
              width: 200,
            },
          ],
        },
      ],

      styles: {
        tableHeader: { fontSize: 7, bold: true, color: '#FFFFFF', fillColor: NAVY, margin: [3, 4, 3, 4] },
        itemRef: { fontSize: 8, bold: true, color: NAVY, margin: [3, 3, 3, 3] },
        itemDesc: { fontSize: 8, color: '#374151', margin: [3, 3, 3, 3] },
        itemVal: { fontSize: 8, alignment: 'center', margin: [3, 3, 3, 3] },
        itemTotal: { fontSize: 9, bold: true, color: NAVY, alignment: 'right', margin: [3, 3, 3, 3] },
        gradeColor: { fontSize: 7, bold: true, color: ORANGE, margin: [3, 2, 3, 2], background: '#FFF7ED' },
        gradeSizes: { fontSize: 7, color: GRAY, margin: [3, 2, 3, 2] },
      },
    }

    const printer = new PdfPrinter(fonts)
    const doc = printer.createPdfKitDocument(docDef)

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks)
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="pedido-${padNum(o.order_number)}.pdf"`)
      res.setHeader('Content-Length', pdfBuffer.length)
      res.send(pdfBuffer)
    })
    doc.end()

  } catch (err) {
    console.error('PDF error:', err)
    res.status(500).json({ error: 'Erro ao gerar PDF' })
  }
}
