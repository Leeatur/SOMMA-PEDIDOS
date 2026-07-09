import { Response } from 'express'
import { AuthRequest } from '../middleware/auth'
import { query } from '../config/database'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

const SIZES = ['34', '36', '38', '40', '42', '44', '46', '48', '50', '52']

// pdf-parse v1 may produce two formats depending on the PDF generator:
//
// FORMAT A (spaces preserved):
//   "TE22311 BALLON CALCA JE FEM  3413613814014214414614805005207  62,90 440,30 ..."
//   → LINE_RE_A captures reference, name, sizes+total block, unit price
//
// FORMAT B (everything concatenated — this PDF):
//   "TE22311 BALLONCALCA JE FEM341361381401421441461480500520762,90440,3062,9062,90"
//   → no spaces at all; parseLineFallback() handles it
//
// parseSizesBlock handles variable-width qtys via backtracking + sum validation.
const LINE_RE =
  /^([A-Z]+\d+)\s*(.+?)\s+(34[\d]+)\s+([\d]+,[\d]{2})/

// Fallback parser for FORMAT B: everything concatenated.
// Strategy: locate where sizes start (first "34\d" after the reference),
// then find the first comma (marks boundary between sizes+total and price).
// Price is always "NN,NN" so priceStart = commaPos - 2.
function parseLineFallback(line: string): { reference: string; product_name: string; sizesAndTotal: string; priceStr: string } | null {
  const refMatch = /^([A-Z]+\d+)\s*/.exec(line)
  if (!refMatch) return null
  const reference = refMatch[1]
  const afterRefPos = refMatch[0].length

  // Find sizes block start: "34" immediately followed by a digit, after the reference
  const sizeRelPos = line.substring(afterRefPos).search(/34\d/)
  if (sizeRelPos < 0) return null
  const sizeStart = afterRefPos + sizeRelPos

  const product_name = line.substring(afterRefPos, sizeStart).trim()

  // First comma after sizeStart is the decimal separator of the unit price
  const commaPos = line.indexOf(',', sizeStart)
  if (commaPos < 2) return null

  // Price format "NN,NN": 2 digits before comma (handles 52,51 / 56,89 / 62,90 etc.)
  const priceStart = commaPos - 2
  if (priceStart <= sizeStart) return null

  const sizesAndTotal = line.substring(sizeStart, priceStart)
  const priceStr = line.substring(priceStart, commaPos + 3) // e.g. "62,90"

  return { reference, product_name, sizesAndTotal, priceStr }
}

// Parse a concatenated sizes block like "3403603884084284484610481050052052"
// Each size label is 2 chars; each qty is 1 or 2 digits; trailing digits are the PDF total.
// Uses recursive backtracking and validates that sum(qtys) === PDF total.
function parseSizesBlock(block: string): Record<string, number> | null {
  function recurse(pos: number, idx: number, acc: number[]): number[] | null {
    if (idx === SIZES.length) {
      const rest = block.substring(pos)
      if (!rest || !/^\d+$/.test(rest)) return null
      const total = parseInt(rest, 10)
      return acc.reduce((s, v) => s + v, 0) === total ? acc : null
    }
    if (block.substring(pos, pos + 2) !== SIZES[idx]) return null
    pos += 2
    for (const len of [1, 2]) {
      if (pos + len > block.length) continue
      const qty = parseInt(block.substring(pos, pos + len), 10)
      const result = recurse(pos + len, idx + 1, [...acc, qty])
      if (result !== null) return result
    }
    return null
  }

  const qtys = recurse(0, 0, [])
  if (!qtys) return null
  const sizes: Record<string, number> = {}
  SIZES.forEach((sz, i) => { if (qtys[i] > 0) sizes[sz] = qtys[i] })
  return sizes
}

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
    let reference: string, product_name_pdf: string, sizesBlock: string, unit_price: number

    const m = LINE_RE.exec(line)
    if (m) {
      reference = m[1]
      product_name_pdf = m[2].trim()
      sizesBlock = m[3]
      unit_price = parsePrice(m[4])
    } else {
      const fb = parseLineFallback(line)
      if (!fb) continue
      reference = fb.reference
      product_name_pdf = fb.product_name
      sizesBlock = fb.sizesAndTotal
      unit_price = parsePrice(fb.priceStr)
    }

    const sizes = parseSizesBlock(sizesBlock)
    if (!sizes) continue

    const total_pieces = Object.values(sizes).reduce((s, v) => s + v, 0)
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

  // Factory: prefer known brands (appear anywhere in text), fallback to first standalone uppercase word
  const KNOWN_BRANDS = ['TEEZZ', 'OUZZARE']
  const factory_name = KNOWN_BRANDS.find(b => text.includes(b))
    ?? (/^([A-Z]{4,})$/m.exec(text)?.[1] ?? '')

  // pdf-parse v1 concatenates adjacent fields without spaces, e.g.:
  // "FMV Confeccoes LtdaFantasia : Ponto Econômico"
  const clientMatch = /(.+?(?:Ltda|ME|EPP|SA|S\/A|EIRELI|Comercial)[^\n]*?)Fantasia\s*:\s*([^\n]+)/i.exec(text)
  const client_name = clientMatch ? clientMatch[1].trim() : ''
  const client_trade_name = clientMatch ? clientMatch[2].trim() : null

  // "CNPJ: 20.354.516/0001-41I. E.: ..."
  const cnpjMatch = /CNPJ:\s*([\d.\/\-]+)/i.exec(text)
  const client_cnpj = cnpjMatch ? cnpjMatch[1].trim() : null

  // "Data :07/07/2026Vendedor:ULIANO"
  const dateMatch = /Data\s*:(\d{2}\/\d{2}\/\d{4})/i.exec(text)
  const order_date = dateMatch ? parseDateBR(dateMatch[1]) : null

  // "Entrega :15/07/2026"
  const delivMatch = /Entrega\s*:(\d{2}\/\d{2}\/\d{4})/i.exec(text)
  const delivery_date = delivMatch ? parseDateBR(delivMatch[1]) : null

  // "Cond. Pagt. :30/60/90/1200" — match only 2-3 digit segments to avoid trailing Transp "0"
  const payMatch = /Cond\.\s*Pagt\.\s*:((?:\d{2,3}\/)*\d{2,3})/i.exec(text)
  const payment_terms = payMatch ? payMatch[1].trim() : null

  // "Frete :CIFTransp.:0" — take exactly 3 uppercase chars (CIF/FOB)
  const freteMatch = /Frete\s*:([A-Z]{3})/i.exec(text)
  const freight_type = freteMatch ? freteMatch[1].trim() : null

  // "Data :07/07/2026Vendedor:ULIANO"
  const vendMatch = /Vendedor:([A-Za-zÀ-ú\s]+?)(?:\n|$)/m.exec(text)
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
