import { Response } from 'express'
import * as XLSX from 'xlsx'
import { AuthRequest } from '../middleware/auth'
import { query } from '../config/database'

const FACTORY_MAP: Record<string, string> = {
  'TEEZZ':   '13a0f746-f637-42a6-856e-01f9a495a537',
  'OUZZARE': 'b09bfdee-37ab-40ef-8a4d-9e5c8eec573f',
}

const REP_MAP: Record<string, string> = {
  'SOMMA - Alex':         '4d4fde47-aeb0-4fa1-aed4-a579a023e0e0',
  'SOMMA - Érico':        'ef133bbe-5950-4908-922e-1ceef37b0af6',
  'SOMMA - Erico':        'ef133bbe-5950-4908-922e-1ceef37b0af6',
  'SOMMA - Leonardo':     '9e96f00b-ca77-4642-ae76-dcecdf5e8c2b',
  'SOMMA - Fabrício H.':  'ec7755ba-2aef-4628-b8ec-da28263d2381',
  'SOMMA - Fabricio H.':  'ec7755ba-2aef-4628-b8ec-da28263d2381',
}

const STATUS_CONFIRMADO = '5f46281d-9750-4dc3-8cf3-731a59fc045b'

function normalizeCnpj(raw: string | null): string {
  return raw ? raw.replace(/[^\d]/g, '') : ''
}

function parseCamp(obs: string | null): { repPct: number; officePct: number } {
  if (!obs) return { repPct: 0, officePct: 10 }
  const m = obs.match(/CAMP\s+([\d.]+)\/([\d.]+)/)
  if (!m) return { repPct: 0, officePct: 10 }
  return { repPct: parseFloat(m[1]), officePct: parseFloat(m[2]) }
}

function toDate(val: unknown): Date | null {
  if (!val) return null
  if (val instanceof Date) return val
  if (typeof val === 'number') return new Date(Math.round((val - 25569) * 86400 * 1000))
  const d = new Date(String(val))
  return isNaN(d.getTime()) ? null : d
}

async function findOrCreateClient(
  cnpj: string, razaoSocial: string, nomeFantasia: string | null, cidade: string | null,
): Promise<string> {
  const cnpjNorm = normalizeCnpj(cnpj)
  if (cnpjNorm) {
    const r = await query('SELECT id FROM clients WHERE cnpj = $1 LIMIT 1', [cnpjNorm])
    if (r.rows.length) return r.rows[0].id
  } else {
    const r = await query('SELECT id FROM clients WHERE name ILIKE $1 LIMIT 1', [razaoSocial])
    if (r.rows.length) return r.rows[0].id
  }
  const ins = await query(
    `INSERT INTO clients (name, trade_name, cnpj, city, active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
    [razaoSocial, nomeFantasia || razaoSocial, cnpjNorm || null, cidade],
  )
  return ins.rows[0].id
}

export async function importSuasVendas(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }

  const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null }) as unknown[][]

  // Linha 0 = título, Linha 1 = cabeçalho, demais = dados
  const dataRows = rows.slice(2).filter(r => r[0] != null && r[3] != null)

  let imported = 0, skipped = 0, errors = 0
  const unmappedReps = new Set<string>()
  const unmappedFactories = new Set<string>()
  const errorDetails: string[] = []

  for (const row of dataRows) {
    const [
      dtVenda, industria, representante, docOriginal,
      cnpj, razaoSocial, nomeFantasia, cidade,
      itens, valor, previsaoEntrega, condicaoPagamento,
      comissaoEscrit, comissaoVendedor, statusSV, obsPrivada,
    ] = row as [unknown, string, string, unknown, string, string, string, string,
                 number, number, unknown, string, number, number, string, string]

    const factoryId = FACTORY_MAP[industria]
    const repId = REP_MAP[representante]

    if (!factoryId) { unmappedFactories.add(String(industria ?? '')); skipped++; continue }
    if (!repId)     { unmappedReps.add(String(representante ?? ''));  skipped++; continue }

    const docStr = String(docOriginal ?? '').trim()
    if (!docStr) { skipped++; continue }

    try {
      const exists = await query(
        'SELECT id FROM orders WHERE industry_order_number = $1 AND factory_id = $2 LIMIT 1',
        [docStr, factoryId],
      )
      if (exists.rows.length) { skipped++; continue }

      const clientId = await findOrCreateClient(cnpj, razaoSocial, nomeFantasia, cidade)
      const { repPct, officePct } = parseCamp(obsPrivada)
      const totalCommPct = repPct + officePct
      const orderDate = toDate(dtVenda) || new Date()
      const delivDate = toDate(previsaoEntrega)

      await query(
        `INSERT INTO orders (
           client_id, rep_id, factory_id, status_id,
           total_value, total_pieces,
           rep_commission_pct, office_commission_pct, total_commission_pct,
           rep_commission_value, office_commission_value,
           commission_manual_override,
           industry_order_number, payment_terms, delivery_date,
           notes, created_at, updated_at, synced_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,$14,$15,$16,$16,$16)`,
        [
          clientId, repId, factoryId, STATUS_CONFIRMADO,
          valor ?? 0, itens ?? 0,
          repPct, officePct, totalCommPct,
          comissaoVendedor ?? 0, comissaoEscrit ?? 0,
          docStr, condicaoPagamento, delivDate,
          `Importado SuasVendas. ${statusSV ?? ''}`.trim(),
          orderDate,
        ],
      )
      imported++
    } catch (e: unknown) {
      errors++
      errorDetails.push(`Doc. ${docStr}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  res.json({
    imported,
    skipped,
    errors,
    unmappedReps: [...unmappedReps],
    unmappedFactories: [...unmappedFactories],
    errorDetails,
  })
}
