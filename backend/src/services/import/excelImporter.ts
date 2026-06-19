import * as XLSX from 'xlsx'
import path from 'path'

// Importação flexível (distribuidora): aceita qualquer código de referência e
// mapeia colunas pelo nome do cabeçalho. Ligado por instância via FLEXIBLE_IMPORT=true.
// Default off — mantém o parser legado (confecção LEEATUR: refs TE/PKTE, colunas fixas).
const FLEXIBLE_IMPORT = process.env.FLEXIBLE_IMPORT === 'true'

export interface ImportedProduct {
  reference: string
  type: 'regular' | 'pack'
  product_name: string
  model: string
  size_range: string
  base_price: number
  category: string
  observation: string
  // Para packs: grade completa
  grade?: PackGradeEntry[]
}

export interface PackGradeEntry {
  color: string
  sizes: Record<string, number>
  total_pieces: number
}

export interface ImportResult {
  products: ImportedProduct[]
  tableName: string
  discountColumns: DiscountColumn[]
}

export interface DiscountColumn {
  label: string
  estimatedPct: number // percentual aproximado de desconto
}

function isReference(val: unknown): boolean {
  if (typeof val !== 'string') return false
  const s = val.trim()
  if (!s) return false
  if (FLEXIBLE_IMPORT) return true // distribuidora: qualquer código não-vazio é referência
  return /^(TE|PKTE)\d+/i.test(s)
}

function toNumber(val: unknown): number {
  if (typeof val === 'number') return Math.abs(val)
  if (typeof val === 'string') return parseFloat(val.replace(',', '.')) || 0
  return 0
}

// Quebra "MODELO: 01, 02, 03" / "BÚFALO, PRETA, AMARELO" / "80, 85, 90" em lista
// de variantes (remove prefixo MODELO:, ponto final tipo "UN.", duplicatas; mantém ordem).
function splitVariants(raw: string): string[] {
  if (!raw) return []
  const cleaned = raw.replace(/^\s*MODELO\s*:?/i, '')
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of cleaned.split(/[,;/]/)) {
    const v = part.trim().replace(/\.+$/, '')
    if (v && !seen.has(v.toUpperCase())) { seen.add(v.toUpperCase()); out.push(v) }
  }
  return out
}

function parseRegularSheet(ws: XLSX.WorkSheet): { products: ImportedProduct[]; discountCols: number[] } {
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })
  const products: ImportedProduct[] = []
  const discountCols: number[] = []

  // Detecta a linha de cabeçalho (onde está REFERÊNCIA / VALOR)
  let headerRow = -1
  let colRef = 0, colName = 1, colModel = 2, colGrade = 3, colPrice = 4, colObs = -1

  for (let r = 0; r < Math.min(10, data.length); r++) {
    const row = data[r] as unknown[]
    if (!row) continue
    const rowStr = row.map(c => String(c || '').toUpperCase())
    const refIdx = rowStr.findIndex(c => c.includes('REFERÊNCIA') || c.includes('REFERENCIA'))
    if (refIdx >= 0) {
      headerRow = r
      colRef = refIdx
      if (FLEXIBLE_IMPORT) {
        // Mapeia colunas pelo NOME do cabeçalho (ordem livre)
        const find = (...keys: string[]) => rowStr.findIndex(c => keys.some(k => c.includes(k)))
        colName  = find('PRODUTO', 'NOME', 'DESCRI')
        colGrade = find('TAMANHO', 'GRADE')
        colModel = find('COR', 'MODELO')
        colPrice = find('VALOR', 'PREÇO', 'PRECO')
        colObs   = find('OBSERV', 'OBS')
        if (colName < 0)  colName = refIdx + 1
        if (colModel < 0) colModel = refIdx + 2
        if (colGrade < 0) colGrade = refIdx + 3
        if (colPrice < 0) colPrice = refIdx + 4
      } else {
        colName = refIdx + 1
        colModel = refIdx + 2
        colGrade = refIdx + 3
        colPrice = refIdx + 4
        // Colunas de desconto = colPrice+1 até colPrice+3 (ou mais)
        for (let dc = colPrice + 1; dc < colPrice + 5 && dc < row.length; dc++) {
          const hdr = String(row[dc] || '')
          if (hdr && !hdr.toUpperCase().includes('OBS')) discountCols.push(dc)
        }
      }
      break
    }
  }

  for (let r = (headerRow >= 0 ? headerRow + 1 : 3); r < data.length; r++) {
    const row = data[r] as unknown[]
    if (!row) continue
    const ref = String(row[colRef] || '').trim()
    if (!isReference(ref)) continue

    const basePrice = toNumber(row[colPrice])
    if (basePrice <= 0) continue

    // Modo flexível: gera grade cor/modelo × tamanho a partir das colunas de texto
    let grade: PackGradeEntry[] | undefined
    if (FLEXIBLE_IMPORT) {
      const colors = splitVariants(String(row[colModel] || ''))  // COR / MODELO
      const sizes  = splitVariants(String(row[colGrade] || ''))  // TAMANHO
      // só gera grade quando há o que escolher (várias cores/modelos ou vários tamanhos)
      if (colors.length > 0 || sizes.length > 1) {
        const rowsV = colors.length > 0 ? colors : ['']
        const colsV = sizes.length > 0 ? sizes : ['UN']
        grade = rowsV.map(c => ({
          color: c,
          sizes: Object.fromEntries(colsV.map(s => [s, 0])),
          total_pieces: 0,
        }))
      }
    }

    products.push({
      reference: ref,
      type: 'regular',
      product_name: String(row[colName] || '').trim(),
      model: String(row[colModel] || '').trim(),
      size_range: String(row[colGrade] || '').trim(),
      base_price: basePrice,
      category: '',
      observation: String(row[(FLEXIBLE_IMPORT && colObs >= 0) ? colObs : (colPrice + discountCols.length + 1)] || '').trim(),
      grade,
    })
  }

  return { products, discountCols }
}

function parsePacksSheet(ws: XLSX.WorkSheet): ImportedProduct[] {
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })
  const products: ImportedProduct[] = []

  let i = 0
  while (i < data.length) {
    const row = data[i] as unknown[]
    if (!row) { i++; continue }

    // Procura linha com referência de pack (PKTE...)
    const flat = row.map(c => String(c || '').trim())
    const refMatch = flat.find(c => /^PKTE\d+/i.test(c))
    if (!refMatch) { i++; continue }

    const reference = refMatch
    // Nome do produto pode estar em linha anterior
    let productName = ''
    if (i > 0) {
      const prevRow = data[i - 1] as unknown[]
      if (prevRow) {
        const prevFlat = prevRow.map(c => String(c || '').trim()).filter(Boolean)
        if (prevFlat.length === 1 && !isReference(prevFlat[0])) productName = prevFlat[0]
      }
    }

    // Próxima linha = header de tamanhos (cor, T1, T2, T3...)
    i++
    const headerRow = data[i] as unknown[]
    if (!headerRow) continue
    const sizeHeaders = headerRow.map(c => String(c || '').trim())
    // Col 0 = 'cor', resto = tamanhos
    const sizeStartCol = 1
    const sizes = sizeHeaders.slice(sizeStartCol).filter(s => s && s !== 'NaN' && s !== 'null')

    // Linhas de cor
    i++
    const gradeEntries: PackGradeEntry[] = []
    let packTotalPieces = 0

    while (i < data.length) {
      const colorRow = data[i] as unknown[]
      if (!colorRow) { i++; break }
      const color = String(colorRow[0] || '').trim()
      if (!color || color.toLowerCase() === 'nan') { i++; break }
      // Se a cor for só um número (linha de total), pula
      if (/^\d+$/.test(color)) { i++; break }

      const sizeMap: Record<string, number> = {}
      let rowTotal = 0
      for (let s = 0; s < sizes.length; s++) {
        const qty = toNumber(colorRow[sizeStartCol + s])
        if (qty > 0) {
          sizeMap[sizes[s]] = qty
          rowTotal += qty
        }
      }

      if (rowTotal > 0) {
        gradeEntries.push({ color, sizes: sizeMap, total_pieces: rowTotal })
        packTotalPieces += rowTotal
      }
      i++
    }

    if (gradeEntries.length > 0) {
      products.push({
        reference,
        type: 'pack',
        product_name: productName,
        model: '',
        size_range: sizes.join(', '),
        base_price: 0, // preço do pack vem da tabela principal
        category: 'PACKS',
        observation: '',
        grade: gradeEntries,
      })
    }
  }

  return products
}

export function estimateDiscount(basePrice: number, discountPrice: number): number {
  if (basePrice <= 0) return 0
  return Math.round(((basePrice - discountPrice) / basePrice) * 10000) / 100
}

export function importExcel(input: string | Buffer): ImportResult {
  // Aceita caminho de arquivo (disco) ou buffer (multer memoryStorage)
  const workbook = typeof input === 'string'
    ? XLSX.readFile(input)
    : XLSX.read(input, { type: 'buffer' })
  const allProducts: ImportedProduct[] = []
  let tableName = typeof input === 'string' ? path.basename(input, path.extname(input)) : ''
  let discountColumns: DiscountColumn[] = []

  // Percorre abas exceto Packs
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName]
    if (!ws) continue

    if (sheetName.toLowerCase() === 'packs') {
      const packProducts = parsePacksSheet(ws)
      allProducts.push(...packProducts)
      continue
    }

    const { products, discountCols } = parseRegularSheet(ws)
    allProducts.push(...products)

    // Detecta percentuais de desconto das colunas (usa 1º produto como amostra)
    if (products.length > 0 && discountCols.length > 0 && discountColumns.length === 0) {
      const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })
      const firstProduct = products[0]
      for (let r = 3; r < data.length; r++) {
        const row = data[r] as unknown[]
        if (!row) continue
        const ref = String(row[0] || '').trim()
        if (!isReference(ref)) continue
        for (let ci = 0; ci < discountCols.length; ci++) {
          const dcPrice = toNumber(row[discountCols[ci]])
          if (dcPrice > 0 && dcPrice < firstProduct.base_price) {
            const pct = estimateDiscount(firstProduct.base_price, dcPrice)
            discountColumns.push({ label: `${pct}%`, estimatedPct: pct })
          }
        }
        break
      }
    }
  }

  // Detecta nome da tabela na célula B2 (padrão TEEZZ). No modo flexível não há
  // linha de título — mantém o nome do arquivo como default (usuário ajusta na importação).
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!FLEXIBLE_IMPORT && firstSheet) {
    const data = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: null })
    for (let r = 0; r < 5; r++) {
      const row = data[r] as unknown[]
      if (!row) continue
      const text = row.map(c => String(c || '')).join(' ').trim()
      if (text.length > 5 && !text.startsWith('REFERÊNCIA')) {
        tableName = text
        break
      }
    }
  }

  return { products: allProducts, tableName, discountColumns }
}

// Ordem lógica de tamanhos alfanuméricos (moda brasileira)
const ALPHA_SIZE_ORDER = ['PP', 'XP', 'P', 'M', 'G', 'GG', 'EXG', 'XGG', '2XG', '3XG', '4XG']

export function buildDefaultGrade(sizeRange: string): Record<string, number> {
  // "34-52"    → {34:1, 36:1, 38:1, 40:1, 42:1, 44:1, 46:1, 48:1, 50:1, 52:1}
  // "P-GG"     → {P:1, M:1, G:1, GG:1}
  // "P-EXG"    → {P:1, M:1, G:1, GG:1, EXG:1}
  // "P/M/G/GG" → {P:1, M:1, G:1, GG:1}
  const grade: Record<string, number> = {}
  if (!sizeRange) return grade

  // Faixa numérica: "34-52"
  const dashMatch = sizeRange.match(/^(\d+)[^\d]+(\d+)$/)
  if (dashMatch) {
    const start = parseInt(dashMatch[1])
    const end = parseInt(dashMatch[2])
    for (let s = start; s <= end; s += 2) grade[String(s)] = 1
    return grade
  }

  // Faixa alfa com hífen: "P-GG", "P-EXG"
  const alphaDashMatch = sizeRange.match(/^([A-Za-z]+)-([A-Za-z]+)$/)
  if (alphaDashMatch) {
    const startKey = alphaDashMatch[1].toUpperCase()
    const endKey = alphaDashMatch[2].toUpperCase()
    const startIdx = ALPHA_SIZE_ORDER.indexOf(startKey)
    const endIdx = ALPHA_SIZE_ORDER.indexOf(endKey)
    if (startIdx >= 0 && endIdx >= startIdx) {
      for (let i = startIdx; i <= endIdx; i++) grade[ALPHA_SIZE_ORDER[i]] = 1
      return grade
    }
  }

  // Lista separada por espaço, vírgula ou barra: "P/M/G/GG" ou "P M G GG"
  const letters = sizeRange.split(/[\s,/]+/).map(s => s.trim()).filter(Boolean)
  for (const l of letters) grade[l] = 1
  return grade
}
