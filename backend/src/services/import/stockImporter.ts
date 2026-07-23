import * as XLSX from 'xlsx'

export interface StockResult {
  // referência base → { cor → { tamanho → quantidade } }
  byRef: Record<string, Record<string, Record<string, number>>>
  // referência base → { cor → { tamanho → código ERP do cliente } }
  byRefSkus: Record<string, Record<string, Record<string, string>>>
  totalRefs: number
  totalRows: number
}

const clean = (v: unknown) => (v == null ? '' : String(v).trim())
const toInt = (v: unknown) => {
  if (typeof v === 'number') return Math.max(0, Math.round(v))
  const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10)
  return isNaN(n) ? 0 : n
}

// O ESTOQUE do Cusco usa referência COMPOSTA na coluna Referência:
//   "H39-Vermelho-U"  → base "H39",  cor "Vermelho", tam "U"
//   "L34-Verde Musgo" → base "L34",  cor "Verde Musgo", sem tamanho
//   "5091"            → base "5091", sem cor/tamanho (item simples)
// Extraímos a referência BASE para bater com products.reference no SOMMA.
function extractBaseRef(rawRef: string, rawCor: string, rawTam: string): string {
  if (!rawCor) return rawRef  // sem cor → ref já é a base
  const suffixFull = `-${rawCor}-${rawTam}`
  if (rawTam && rawRef.endsWith(suffixFull)) return rawRef.slice(0, -suffixFull.length)
  const suffixCor = `-${rawCor}`
  if (rawRef.endsWith(suffixCor)) return rawRef.slice(0, -suffixCor.length)
  return rawRef  // fallback: usa ref como está
}

export function parseStock(input: string | Buffer): StockResult {
  const wb = typeof input === 'string' ? XLSX.readFile(input) : XLSX.read(input, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })

  // Detecta a linha de cabeçalho (procura "REFERÊNCIA") e os índices das colunas
  let headerRow = 0
  let cRef = 0, cCor = 2, cTam = 3, cEst = 5, cCod = -1
  for (let r = 0; r < Math.min(8, rows.length); r++) {
    const up = (rows[r] || []).map(c => clean(c).toUpperCase())
    const refIdx = up.findIndex(c => c.includes('REFER'))
    if (refIdx >= 0) {
      headerRow = r
      cRef = refIdx
      cCor = up.findIndex(c => c.startsWith('COR'))
      cTam = up.findIndex(c => c.includes('TAMANHO'))
      cEst = up.findIndex(c => c.includes('ESTOQUE') || c.includes('SALDO') || c.includes('QUANT'))
      cCod = up.findIndex(c => c.includes('CÓDIGO') || c.includes('CODIGO') || c === 'CÓD' || c === 'COD')
      if (cCor < 0) cCor = refIdx + 2
      if (cTam < 0) cTam = refIdx + 3
      if (cEst < 0) cEst = refIdx + 5
      break
    }
  }

  const byRef: Record<string, Record<string, Record<string, number>>> = {}
  const byRefSkus: Record<string, Record<string, Record<string, string>>> = {}
  let totalRows = 0

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] as unknown[]
    if (!row) continue
    const rawRef = clean(row[cRef])
    if (!rawRef) continue
    const rawCor = clean(row[cCor])
    const rawTam = clean(row[cTam])

    // Normaliza cor e tamanho para exibição/armazenamento
    const cor = rawCor || '—'
    const tam = rawTam || 'UN'

    // Extrai referência base (sem o sufixo cor/tamanho)
    const baseRef = extractBaseRef(rawRef, rawCor, rawTam)

    const qtd = toInt(row[cEst])
    totalRows++

    byRef[baseRef] ??= {}
    byRef[baseRef][cor] ??= {}
    byRef[baseRef][cor][tam] = (byRef[baseRef][cor][tam] || 0) + qtd

    // Captura código ERP do cliente (não sobrescreve se já existe para essa variante)
    if (cCod >= 0) {
      const cod = clean(row[cCod])
      if (cod) {
        byRefSkus[baseRef] ??= {}
        byRefSkus[baseRef][cor] ??= {}
        byRefSkus[baseRef][cor][tam] ??= cod
      }
    }
  }

  return { byRef, byRefSkus, totalRefs: Object.keys(byRef).length, totalRows }
}
