/**
 * Importação histórica do SuasVendas para o SOMMA-PEDIDOS.
 *
 * Uso:
 *   npx ts-node src/scripts/importSuasVendas.ts /caminho/para/arquivo.xlsx
 *
 * O Excel deve ter a estrutura padrão do relatório de pedidos do SuasVendas:
 *   Linha 1: título (ignorada)
 *   Linha 2: cabeçalho
 *   Linhas 3+: dados
 *   Última linha: totais (ignorada se Dt. Venda for nula)
 *
 * Colunas esperadas:
 *   Dt. Venda | Indústria | Representante | Doc. Original | CNPJ/CPF |
 *   Razão Social | Cliente | Cidade | Itens | Valor | Previsão Entrega |
 *   Condição de Pagamento | Comissão Escrit. | Comissão Vendedor |
 *   Status | Observação Privada
 */

import * as XLSX from 'xlsx'
import { Pool } from 'pg'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.join(__dirname, '../../.env') })

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'somma_pedidos',
  user: process.env.DB_USER || 'uliano',
  password: process.env.DB_PASSWORD || '',
})

// ── Mapeamentos fixos ────────────────────────────────────────────────────────

const FACTORY_MAP: Record<string, string> = {
  'TEEZZ':   '13a0f746-f637-42a6-856e-01f9a495a537',
  'OUZZARE': 'b09bfdee-37ab-40ef-8a4d-9e5c8eec573f',
}

const REP_MAP: Record<string, string> = {
  'SOMMA - Alex':         '4d4fde47-aeb0-4fa1-aed4-a579a023e0e0', // Alex Beneduzi
  'SOMMA - Érico':        'ef133bbe-5950-4908-922e-1ceef37b0af6', // Erico da Silveira
  'SOMMA - Erico':        'ef133bbe-5950-4908-922e-1ceef37b0af6', // sem acento
  'SOMMA - Leonardo':     '9e96f00b-ca77-4642-ae76-dcecdf5e8c2b', // Leonardo
  'SOMMA - Fabrício H.':  'ec7755ba-2aef-4628-b8ec-da28263d2381', // Fabricio Hunecke
  'SOMMA - Fabricio H.':  'ec7755ba-2aef-4628-b8ec-da28263d2381', // sem acento
}

// Status "Confirmado" para pedidos históricos
const STATUS_CONFIRMADO = '5f46281d-9750-4dc3-8cf3-731a59fc045b'

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  // XLSX serial number
  if (typeof val === 'number') {
    return new Date(Math.round((val - 25569) * 86400 * 1000))
  }
  const d = new Date(String(val))
  return isNaN(d.getTime()) ? null : d
}

async function findOrCreateClient(
  cnpj: string,
  razaoSocial: string,
  nomeFantasia: string | null,
  cidade: string | null,
): Promise<string> {
  const cnpjNorm = normalizeCnpj(cnpj)

  if (cnpjNorm) {
    const r = await pool.query('SELECT id FROM clients WHERE cnpj = $1 LIMIT 1', [cnpjNorm])
    if (r.rows.length) return r.rows[0].id
  } else {
    const r = await pool.query('SELECT id FROM clients WHERE name ILIKE $1 LIMIT 1', [razaoSocial])
    if (r.rows.length) return r.rows[0].id
  }

  const ins = await pool.query(
    `INSERT INTO clients (name, trade_name, cnpj, city, active)
     VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [razaoSocial, nomeFantasia || razaoSocial, cnpjNorm || null, cidade],
  )
  console.log(`  + cliente criado: ${razaoSocial}`)
  return ins.rows[0].id
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    console.error('Uso: npx ts-node src/scripts/importSuasVendas.ts <arquivo.xlsx>')
    process.exit(1)
  }

  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })

  // Linha 0 = título, Linha 1 = cabeçalho, demais = dados
  const dataRows = (rows as unknown[][]).slice(2).filter(r => r[0] != null && r[3] != null)

  console.log(`\nArquivo: ${path.basename(filePath)}`)
  console.log(`Pedidos encontrados: ${dataRows.length}\n`)

  let ok = 0, skipped = 0, errors = 0
  const unmappedReps = new Set<string>()
  const unmappedFactories = new Set<string>()

  for (const row of dataRows) {
    const [
      dtVenda, industria, representante, docOriginal,
      cnpj, razaoSocial, nomeFantasia, cidade,
      itens, valor, previsaoEntrega, condicaoPagamento,
      comissaoEscrit, comissaoVendedor, statusSV, obsPrivada,
    ] = row as [
      unknown, string, string, unknown,
      string, string, string, string,
      number, number, unknown, string,
      number, number, string, string,
    ]

    const factoryId = FACTORY_MAP[industria]
    const repId = REP_MAP[representante]

    if (!factoryId) { unmappedFactories.add(industria); skipped++; continue }
    if (!repId)     { unmappedReps.add(representante);  skipped++; continue }

    const docStr = String(docOriginal ?? '').trim()
    if (!docStr) { skipped++; continue }

    try {
      // Idempotência: pula se já foi importado
      const exists = await pool.query(
        'SELECT id FROM orders WHERE industry_order_number = $1 AND factory_id = $2 LIMIT 1',
        [docStr, factoryId],
      )
      if (exists.rows.length) { skipped++; continue }

      const clientId = await findOrCreateClient(cnpj, razaoSocial, nomeFantasia, cidade)
      const { repPct, officePct } = parseCamp(obsPrivada as string)
      const totalCommPct = repPct + officePct

      const orderDate  = toDate(dtVenda)  || new Date()
      const delivDate  = toDate(previsaoEntrega)

      await pool.query(
        `INSERT INTO orders (
           client_id, rep_id, factory_id, status_id,
           total_value, total_pieces,
           rep_commission_pct, office_commission_pct, total_commission_pct,
           rep_commission_value, office_commission_value,
           commission_manual_override,
           industry_order_number, payment_terms, delivery_date,
           notes, created_at, updated_at, synced_at
         ) VALUES (
           $1,$2,$3,$4,
           $5,$6,
           $7,$8,$9,
           $10,$11,
           true,
           $12,$13,$14,
           $15,$16,$16,$16
         )`,
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

      ok++
      process.stdout.write('.')
    } catch (e: unknown) {
      errors++
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`\n  ERRO [Doc. ${docStr}]: ${msg}`)
    }
  }

  console.log(`\n\n────────────────────────────────`)
  console.log(`✓ Importados : ${ok}`)
  console.log(`⊘ Pulados    : ${skipped}`)
  console.log(`✗ Erros      : ${errors}`)
  if (unmappedReps.size)     console.log(`\nReps sem mapeamento:`, [...unmappedReps])
  if (unmappedFactories.size) console.log(`Fábricas sem mapeamento:`, [...unmappedFactories])
  console.log()

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
