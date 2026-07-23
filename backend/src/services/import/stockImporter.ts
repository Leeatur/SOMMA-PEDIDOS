import * as XLSX from 'xlsx'

export interface StockResult {
  // referência → { cor → { tamanho → quantidade } }
  byRef: Record<string, Record<string, Record<string, number>>>
  // referência → { cor → { tamanho → código ERP do cliente } }
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

// Planilha de estoque do Cusco:
// Referência | Código | (Nome) | Cor | Tamanho | Estoque | Preço
// Itens sem variante vêm sem cor/tamanho → cor "—", tamanho "UN".
export function parseStock(input: string | Buffer): StockResult {
  const wb = typeof input === 'string' ? XLSX.readFile(input) : XLSX.read(input, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })

  // Detecta a linha de cabeçalho (procura "REFERÊNCIA") e os índices das colunas
  let headerRow = 0
  let cRef = 0, cCor = 3, cTam = 4, cEst = 5, cCod = -1
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
      if (cCor < 0) cCor = refIdx + 3
      if (cTam < 0) cTam = refIdx + 4
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
    const ref = clean(row[cRef])
    if (!ref) continue
    const cor = clean(row[cCor]) || '—'
    const tam = clean(row[cTam]) || 'UN'
    const qtd = toInt(row[cEst])
    totalRows++
    byRef[ref] ??= {}
    byRef[ref][cor] ??= {}
    // soma caso a mesma combinação apareça em linhas repetidas
    byRef[ref][cor][tam] = (byRef[ref][cor][tam] || 0) + qtd
    // captura código ERP do cliente (não sobrescreve se já existe)
    if (cCod >= 0) {
      const cod = clean(row[cCod])
      if (cod) {
        byRefSkus[ref] ??= {}
        byRefSkus[ref][cor] ??= {}
        byRefSkus[ref][cor][tam] ??= cod
      }
    }
  }

  return { byRef, byRefSkus, totalRefs: Object.keys(byRef).length, totalRows }
}
