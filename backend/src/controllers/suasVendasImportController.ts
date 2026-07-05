import { Response } from 'express'
import * as XLSX from 'xlsx'
import bcrypt from 'bcryptjs'
import { AuthRequest } from '../middleware/auth'
import { query } from '../config/database'

// Mapa nome SuasVendas → nome no banco (lookup por name ILIKE)
const REP_NAME_MAP: Record<string, string> = {
  'SOMMA - Alex':        'Alex',
  'SOMMA - Érico':       'Erico',
  'SOMMA - Erico':       'Erico',
  'SOMMA - Leonardo':    'Leonardo',
  'SOMMA - Fabrício H.': 'Fabricio',
  'SOMMA - Fabricio H.': 'Fabricio',
}

// Dados dos reps para criação automática caso não existam em produção
const REP_CREATE_DATA: Record<string, { name: string; email: string }> = {
  'Erico':    { name: 'Erico da Silveira',  email: 'erico@somma.com.br' },
  'Leonardo': { name: 'Leonardo',           email: 'leonardo@somma.com.br' },
  'Fabricio': { name: 'Fabricio Hunecke',   email: 'fabricio@somma.com.br' },
  'Alex':     { name: 'Alex Beneduzi',      email: 'somma.alex@hotmail.com' },
}

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

// Cache de lookups para não bater no banco a cada linha
const cache = {
  factories: new Map<string, string>(),
  reps: new Map<string, string>(),
  statusConfirmado: null as string | null,
}

async function getFactoryId(name: string): Promise<string | null> {
  const key = name.toUpperCase()
  if (cache.factories.has(key)) return cache.factories.get(key)!
  // fallback: consulta DB se não veio no pré-carregamento
  const r = await query('SELECT id FROM factories WHERE name ILIKE $1 LIMIT 1', [name])
  if (!r.rows.length) return null
  cache.factories.set(key, r.rows[0].id)
  return r.rows[0].id
}

async function getOrCreateRepId(svName: string): Promise<string | null> {
  if (cache.reps.has(svName)) return cache.reps.get(svName)!

  const nameKey = REP_NAME_MAP[svName]
  if (!nameKey) return null

  // Tenta achar pelo name parcial
  const r = await query(
    `SELECT id FROM users WHERE name ILIKE $1 LIMIT 1`,
    [`%${nameKey}%`],
  )
  if (r.rows.length) {
    cache.reps.set(svName, r.rows[0].id)
    return r.rows[0].id
  }

  // Não existe: cria automaticamente
  const data = REP_CREATE_DATA[nameKey]
  if (!data) return null

  const hash = await bcrypt.hash('Somma@2026', 10)
  const ins = await query(
    `INSERT INTO users (name, email, password_hash, role, active)
     VALUES ($1, $2, $3, 'representante', true)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [data.name, data.email, hash],
  )
  cache.reps.set(svName, ins.rows[0].id)
  return ins.rows[0].id
}

async function getStatusConfirmado(): Promise<string> {
  if (cache.statusConfirmado) return cache.statusConfirmado
  const r = await query(
    `SELECT id FROM order_statuses WHERE name ILIKE '%confirmado%' LIMIT 1`,
  )
  if (r.rows.length) {
    cache.statusConfirmado = r.rows[0].id
    return r.rows[0].id
  }
  // fallback: primeiro status não-inicial não-final
  const r2 = await query(
    `SELECT id FROM order_statuses WHERE is_final = false ORDER BY sort_order LIMIT 1`,
  )
  cache.statusConfirmado = r2.rows[0].id
  return r2.rows[0].id
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

  // Limpa cache entre requisições
  cache.factories.clear()
  cache.reps.clear()
  cache.statusConfirmado = null

  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(req.file.buffer, { type: 'buffer' })
  } catch {
    res.status(400).json({ error: 'Arquivo inválido ou corrompido' })
    return
  }

  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null }) as unknown[][]

  // Linha 0 = título, Linha 1 = cabeçalho, demais = dados
  const dataRows = rows.slice(2).filter(r => r[0] != null && r[3] != null)

  // Pré-carrega fábricas, reps e status em bloco (evita N+1 queries via rede)
  const [factoriesRes, usersRes] = await Promise.all([
    query('SELECT id, name FROM factories'),
    query('SELECT id, name FROM users'),
  ])
  factoriesRes.rows.forEach((f: { id: string; name: string }) => cache.factories.set(f.name.toUpperCase(), f.id))
  usersRes.rows.forEach((u: { id: string; name: string }) => {
    // Mapeia cada entrada REP_NAME_MAP para o id do usuário encontrado
    for (const [svKey, nameKey] of Object.entries(REP_NAME_MAP)) {
      if (u.name.toLowerCase().includes(nameKey.toLowerCase())) {
        cache.reps.set(svKey, u.id)
      }
    }
  })

  const statusId = await getStatusConfirmado()

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

    const factoryId = await getFactoryId(String(industria ?? ''))
    const repId     = await getOrCreateRepId(String(representante ?? ''))

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
          clientId, repId, factoryId, statusId,
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
