import { Response } from 'express'
import { AuthRequest } from '../middleware/auth'
import { query } from '../config/database'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

const SIZES = ['34', '36', '38', '40', '42', '44', '46', '48', '50', '52']

// Matches a TEEZZ item line:
// TE22311 BALLON CALCA JE FEM 34 1 36 1 38 1 40 1 42 1 44 1 46 1 48 0 50 0 52 0 7 62,90 ...
const ITEM_RE =
  /^(TE\d+)\s+(.+?)\s+34\s+(\d+)\s+36\s+(\d+)\s+38\s+(\d+)\s+40\s+(\d+)\s+42\s+(\d+)\s+44\s+(\d+)\s+46\s+(\d+)\s+48\s+(\d+)\s+50\s+(\d+)\s+52\s+(\d+)\s+\d+\s+([\d,]+)/

function parsePrice(s: string): number {
  return parseFloat(s.replace(',', '.')) || 0
}

function parseDateBR(s: string): string | null {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

interface ParsedItem {
  reference: string
  product_name_pdf: string
  sizes: Record<string, number>
  total_pieces: number
  unit_price: number
  subtotal: number
}

interface ParsedHeader {
  factory_name: string
  client_name: string
  client_trade_name: string | null
  client_cnpj: string | null
  order_date: string | null
  delivery_date: string | null
  payment_terms: string | null
  freight_type: string | null
  rep_name: string | null
}

function parseTeezzPdf(text: string): { header: ParsedHeader; items: ParsedItem[] } {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const items: ParsedItem[] = []

  for (const line of lines) {
    const m = ITEM_RE.exec(line)
    if (!m) continue

    const reference = m[1]
    const product_name_pdf = m[2].trim()
    const qtys = [m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12]].map(Number)
    const unit_price = parsePrice(m[13])

    const sizes: Record<string, number> = {}
    let total_pieces = 0
    SIZES.forEach((sz, i) => {
      if (qtys[i] > 0) {
        sizes[sz] = qtys[i]
        total_pieces += qtys[i]
      }
    })

    if (total_pieces === 0) continue

    items.push({
      reference,
      product_name_pdf,
      sizes,
      total_pieces,
      unit_price,
      subtotal: Math.round(unit_price * total_pieces * 100) / 100,
    })
  }

  // Factory: standalone TEEZZ line
  const factoryMatch = /\n(TEEZZ)\n/i.exec(text) || /^(TEEZZ)$/m.exec(text)
  const factory_name = factoryMatch ? factoryMatch[1] : ''

  // Client name + trade name: "FMV Confeccoes Ltda Fantasia : Ponto Econômico"
  const clientMatch = /([A-Za-zÀ-ú0-9\s]+?(?:Ltda|ME|EPP|SA|S\/A|EIRELI|Comercial|Ind\.|Ind |Comercio)[^\n]*?)\s+Fantasia\s*:\s*([^\n]+)/i.exec(text)
  const client_name = clientMatch ? clientMatch[1].trim() : ''
  const client_trade_name = clientMatch ? clientMatch[2].trim() : null

  const cnpjMatch = /CNPJ:\s*([\d.\/\-]+)/i.exec(text)
  const client_cnpj = cnpjMatch ? cnpjMatch[1].trim() : null

  const dateMatch = /Data\s*:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text)
  const order_date = dateMatch ? parseDateBR(dateMatch[1]) : null

  const delivMatch = /Entrega\s*:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text)
  const delivery_date = delivMatch ? parseDateBR(delivMatch[1]) : null

  const payMatch = /Cond\.\s*Pagt\.\s*:\s*([^\n0-9]+?)(?:\s+0)?\s*$/m.exec(text)
  const payment_terms = payMatch ? payMatch[1].trim() : null

  const freteMatch = /Frete\s*:\s*(\w+)/i.exec(text)
  const freight_type = freteMatch ? freteMatch[1].trim() : null

  const vendMatch = /Vendedor:\s*([A-Za-zÀ-ú\s]+?)(?=\s+Entrega|\s*$)/m.exec(text)
  const rep_name = vendMatch ? vendMatch[1].trim() : null

  return {
    header: { factory_name, client_name, client_trade_name, client_cnpj, order_date, delivery_date, payment_terms, freight_type, rep_name },
    items,
  }
}

export async function parseOrderFile(req: AuthRequest, res: Response) {
  const file = req.file
  if (!file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }

  const isPdf = /\.pdf$/i.test(file.originalname) || file.mimetype === 'application/pdf'

  if (!isPdf) {
    res.status(400).json({ error: 'Formato não suportado. Envie um arquivo PDF.' })
    return
  }

  let parsed: { header: ParsedHeader; items: ParsedItem[] }
  try {
    const { text } = await pdfParse(file.buffer)
    parsed = parseTeezzPdf(text)
  } catch {
    res.status(400).json({ error: 'Erro ao ler o PDF. Certifique-se de que o arquivo é válido.' })
    return
  }

  if (parsed.items.length === 0) {
    res.status(422).json({ error: 'Nenhum item encontrado. Verifique se o arquivo segue o formato TEEZZ.' })
    return
  }

  // Batch lookup: products by reference
  const references = [...new Set(parsed.items.map(i => i.reference))]
  const { rows: products } = await query(
    `SELECT id, reference, product_name, type, size_range, price_table_id
     FROM products WHERE reference = ANY($1)`,
    [references]
  )
  const productMap = new Map(products.map(p => [p.reference, p]))

  // Price table from first matched product
  let price_table_id: string | null = null
  for (const ref of references) {
    const p = productMap.get(ref)
    if (p?.price_table_id) { price_table_id = p.price_table_id; break }
  }

  // Factory lookup
  let factory_id: string | null = null
  if (parsed.header.factory_name) {
    const { rows } = await query(
      `SELECT id FROM factories WHERE name ILIKE $1 LIMIT 1`,
      [parsed.header.factory_name]
    )
    factory_id = rows[0]?.id || null
  }

  // Client lookup: CNPJ first, then name
  let client_id: string | null = null
  if (parsed.header.client_cnpj) {
    const cnpjClean = parsed.header.client_cnpj.replace(/[^\d]/g, '')
    const { rows } = await query(
      `SELECT id FROM clients WHERE regexp_replace(COALESCE(cnpj,''), '[^0-9]', '', 'g') = $1 LIMIT 1`,
      [cnpjClean]
    )
    client_id = rows[0]?.id || null
  }
  if (!client_id && parsed.header.client_name) {
    const { rows } = await query(
      `SELECT id FROM clients WHERE name ILIKE $1 LIMIT 1`,
      [parsed.header.client_name]
    )
    client_id = rows[0]?.id || null
  }

  // Enrich items with product info
  const enrichedItems = parsed.items.map(item => {
    const product = productMap.get(item.reference)
    return {
      ...item,
      product_id: product?.id || null,
      product_name_db: product?.product_name || null,
      product_type: (product?.type || 'regular') as 'regular' | 'pack',
      size_range: product?.size_range || null,
      matched: !!product,
    }
  })

  const unmatchedRefs = enrichedItems.filter(i => !i.matched).map(i => i.reference)

  res.json({
    header: parsed.header,
    factory_id,
    client_id,
    price_table_id,
    items: enrichedItems,
    summary: {
      total_items: enrichedItems.length,
      matched_items: enrichedItems.filter(i => i.matched).length,
      unmatched_items: unmatchedRefs.length,
      unmatched_refs: unmatchedRefs,
      total_pieces: enrichedItems.reduce((s, i) => s + i.total_pieces, 0),
      total_value: enrichedItems.reduce((s, i) => s + i.subtotal, 0),
    },
  })
}
