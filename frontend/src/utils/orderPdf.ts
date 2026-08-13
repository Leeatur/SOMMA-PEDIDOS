import { jsPDF } from 'jspdf'
import { autoTable, type RowInput, type CellInput } from 'jspdf-autotable'

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
    if (ai === -1) return 1; if (bi === -1) return -1
    return ai - bi
  })
}

function fmtBRL(n: number | null | undefined) {
  return `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('pt-BR') } catch { return String(d) }
}

function padNum(n: number) { return String(n).padStart(4, '0') }

interface GradeEntry { color: string | null; sizes: Record<string, number>; total_pieces?: number }
interface OrderItem {
  reference: string
  product_name?: string | null
  model?: string | null
  type?: string
  boxes_count?: number
  unit_price: number
  total_pieces: number
  subtotal: number
  sizes?: Record<string, number> | null
  custom_grade?: GradeEntry[] | null
  grade_configs?: GradeEntry[] | null
  item_obs?: string | null
}
interface Order {
  order_number: number
  created_at: string
  status_name?: string | null
  client_name: string
  client_trade_name?: string | null
  client_cnpj?: string | null
  client_city?: string | null
  client_state?: string | null
  rep_name: string
  rep_email?: string | null
  factory_name: string
  price_table_name: string
  discount_pct?: number
  total_pieces: number
  total_value: number
  payment_terms?: string | null
  delivery_date?: string | null
  freight_type?: string | null
  buyer_name?: string | null
  industry_order_number?: string | null
  notes?: string | null
  items: OrderItem[]
  [key: string]: unknown
}

const ORANGE: [number, number, number] = [224, 123, 39]
const NAVY: [number, number, number] = [27, 35, 55]
const GRAY: [number, number, number] = [107, 114, 128]
const WHITE: [number, number, number] = [255, 255, 255]
const LIGHT: [number, number, number] = [249, 250, 251]
const BORDER: [number, number, number] = [229, 231, 235]
const PURPLE: [number, number, number] = [79, 70, 229]

function gradeText(grades: GradeEntry[]): string {
  const lines: string[] = []
  for (const g of grades) {
    const sizeEntries = sortSizes(
      Object.entries(g.sizes || {})
        .filter(([, v]) => Number(v) > 0)
        .map(([k]) => k)
    )
    if (!sizeEntries.length) continue
    const parts = sizeEntries.map(s => `${s}:${g.sizes[s]}`).join(' ')
    lines.push(`${g.color || '—'} › ${parts}`)
  }
  return lines.join('   ')
}

export function generateOrderPdf(order: Order): void {
  const doc = new jsPDF({ format: 'a4', unit: 'mm' })
  const W = doc.internal.pageSize.getWidth()
  const num = padNum(order.order_number)
  const discountPct = Number(order.discount_pct || 0)

  // ── HEADER ────────────────────────────────────────────────────────
  let y = 14
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...NAVY)
  doc.text('FORÇA DE VENDAS', 14, y)

  doc.setFontSize(24)
  doc.setTextColor(...ORANGE)
  doc.text(`#${num}`, W - 14, y, { align: 'right' })

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GRAY)
  doc.text(`Emitido: ${fmtDate(order.created_at)}`, W - 14, y + 5, { align: 'right' })
  if (order.status_name) {
    doc.setFont('helvetica', 'bold')
    doc.text(order.status_name, W - 14, y + 10, { align: 'right' })
  }

  y += 7
  doc.setDrawColor(...ORANGE)
  doc.setLineWidth(0.8)
  doc.line(14, y, W - 14, y)
  y += 5

  // ── INFO GRID (3 colunas via autoTable) ───────────────────────────
  const clientLines = [
    order.client_name,
    order.client_trade_name,
    order.client_cnpj ? `CNPJ: ${order.client_cnpj}` : null,
    order.client_city ? `${order.client_city}${order.client_state ? '/' + order.client_state : ''}` : null,
  ].filter(Boolean).join('\n')

  const repLines = [
    order.rep_name,
    order.rep_email || null,
    '',
    order.factory_name,
    order.price_table_name,
  ].filter(v => v !== null).join('\n')

  const detailLines = [
    order.payment_terms ? `Pagamento: ${order.payment_terms}` : null,
    order.delivery_date ? `Entrega: ${fmtDate(order.delivery_date)}` : null,
    order.freight_type ? `Frete: ${order.freight_type}` : null,
    order.buyer_name ? `Comprador: ${order.buyer_name}` : null,
    discountPct > 0 ? `Desconto à Vista: ${discountPct.toFixed(1)}%` : null,
    order.industry_order_number ? `Nº Fábrica: ${order.industry_order_number}` : null,
  ].filter(Boolean).join('\n')

  autoTable(doc, {
    startY: y,
    margin: { left: 14, right: 14 },
    head: [['CLIENTE', 'REPRESENTANTE / MARCA', 'CONDIÇÕES']],
    body: [[clientLines, repLines, detailLines || '—']],
    headStyles: {
      fillColor: NAVY,
      textColor: WHITE,
      fontSize: 7,
      fontStyle: 'bold',
      cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
    },
    bodyStyles: {
      fontSize: 9,
      textColor: NAVY,
      cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
      lineColor: BORDER,
      lineWidth: 0.3,
    },
    columnStyles: {
      0: { cellWidth: 62 },
      1: { cellWidth: 62 },
      2: { cellWidth: 58 },
    },
    theme: 'grid',
  })

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6

  // ── ITEMS TABLE ────────────────────────────────────────────────────
  const tableBody: RowInput[] = []

  for (const item of order.items) {
    const isPack = item.type === 'pack'
    const descName = [item.product_name, item.model].filter(Boolean).join(' — ') || item.reference
    const discountedPrice = item.unit_price * (1 - discountPct / 100)
    const piecesStr = isPack
      ? `${item.boxes_count ?? 1}cx · ${item.total_pieces}pç`
      : `${item.total_pieces}pç`

    tableBody.push([
      { content: item.reference, styles: { textColor: PURPLE, fontStyle: 'bold', font: 'courier' } } as CellInput,
      descName as CellInput,
      { content: piecesStr, styles: { halign: 'center' } } as CellInput,
      { content: fmtBRL(discountedPrice), styles: { halign: 'right' } } as CellInput,
      { content: fmtBRL(item.subtotal), styles: { halign: 'right', fontStyle: 'bold' } } as CellInput,
    ])

    // Grade breakdown
    const grades = isPack
      ? (item.grade_configs || [])
      : (item.custom_grade || [])

    if (grades.length > 0) {
      const text = gradeText(grades)
      if (text) {
        tableBody.push([{
          content: text,
          colSpan: 5,
          styles: {
            fontSize: 8,
            textColor: GRAY,
            cellPadding: { top: 1, bottom: 3, left: 10, right: 4 },
            fontStyle: 'normal',
          },
        }])
      }
    } else if (item.sizes) {
      const sizeEntries = sortSizes(
        Object.entries(item.sizes).filter(([, v]) => Number(v) > 0).map(([k]) => k)
      )
      if (sizeEntries.length > 0) {
        const text = sizeEntries.map(s => `${s}:${item.sizes![s]}`).join(' · ')
        tableBody.push([{
          content: text,
          colSpan: 5,
          styles: {
            fontSize: 8,
            textColor: GRAY,
            cellPadding: { top: 1, bottom: 3, left: 10, right: 4 },
          },
        }])
      }
    }

    if (item.item_obs) {
      tableBody.push([{
        content: `⚠ ${item.item_obs}`,
        colSpan: 5,
        styles: {
          fontSize: 8,
          textColor: [220, 38, 38] as [number, number, number],
          fontStyle: 'italic',
          cellPadding: { top: 1, bottom: 3, left: 10, right: 4 },
        },
      }])
    }
  }

  autoTable(doc, {
    startY: y,
    margin: { left: 14, right: 14 },
    head: [['Referência', 'Produto', 'Qtd', 'Vl. Unit.', 'Subtotal']],
    body: tableBody,
    headStyles: {
      fillColor: NAVY,
      textColor: WHITE,
      fontSize: 9,
      fontStyle: 'bold',
      cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
    },
    bodyStyles: {
      fontSize: 9,
      textColor: NAVY,
      cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
      lineColor: BORDER,
      lineWidth: 0.2,
    },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      0: { cellWidth: 28, fontStyle: 'bold' },
      1: { cellWidth: 74 },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 28, halign: 'right' },
      4: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
    },
    theme: 'grid',
  })

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4

  // ── TOTALS ─────────────────────────────────────────────────────────
  const totalsRows: Array<[string, string]> = [
    ['Total de Peças', `${Number(order.total_pieces).toLocaleString('pt-BR')} pç`],
  ]
  if (discountPct > 0) totalsRows.push(['Desconto à Vista', `${discountPct.toFixed(1)}%`])

  const totalTableX = W - 14 - 80
  autoTable(doc, {
    startY: y,
    margin: { left: totalTableX, right: 14 },
    body: totalsRows,
    bodyStyles: {
      fontSize: 9,
      textColor: NAVY,
      cellPadding: { top: 2, bottom: 2, left: 4, right: 4 },
    },
    theme: 'plain',
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 35, halign: 'right', fontStyle: 'bold' },
    },
  })

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 1

  // Grand total row
  autoTable(doc, {
    startY: y,
    margin: { left: totalTableX, right: 14 },
    body: [['TOTAL GERAL', fmtBRL(order.total_value)]],
    bodyStyles: {
      fontSize: 13,
      fontStyle: 'bold',
      textColor: ORANGE,
      cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
      lineColor: BORDER,
      lineWidth: { top: 0.6, bottom: 0, left: 0, right: 0 },
    },
    theme: 'plain',
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 35, halign: 'right' },
    },
  })

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4

  // ── NOTES ──────────────────────────────────────────────────────────
  if (order.notes) {
    doc.setDrawColor(...BORDER)
    doc.setLineWidth(0.3)
    doc.roundedRect(14, y, W - 28, 8, 2, 2, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...ORANGE)
    doc.text('OBSERVAÇÕES', 18, y + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...NAVY)
    const lines = doc.splitTextToSize(String(order.notes), W - 36)
    doc.text(lines, 18, y + 9)
    y += 10 + lines.length * 5
  }

  // ── FOOTER ─────────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    const pageH = doc.internal.pageSize.getHeight()
    doc.setDrawColor(...BORDER)
    doc.setLineWidth(0.3)
    doc.line(14, pageH - 12, W - 14, pageH - 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRAY)
    doc.text('Somma Negócios e Tecnologia · Erechim | RS · (54) 9.9162-5024', W / 2, pageH - 7, { align: 'center' })
    if (pageCount > 1) {
      doc.text(`Página ${i}/${pageCount}`, W - 14, pageH - 7, { align: 'right' })
    }
  }

  // ── SAVE / SHARE ───────────────────────────────────────────────────
  const filename = `pedido-${num}.pdf`
  const blob = doc.output('blob')
  const file = new File([blob], filename, { type: 'application/pdf' })

  if (
    navigator.share &&
    navigator.canShare?.({ files: [file] }) &&
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  ) {
    navigator.share({ files: [file], title: `Pedido #${num}` }).catch(() => {
      doc.save(filename)
    })
  } else {
    doc.save(filename)
  }
}
