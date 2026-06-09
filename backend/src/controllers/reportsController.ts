import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

function dateRange(req: AuthRequest): [string, string] {
  // Usa horário de Brasília para comparação de datas
  const toSP = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(d)
  const today = toSP(new Date())
  const thirtyAgo = toSP(new Date(Date.now() - 30 * 86400000))
  return [
    String(req.query.date_from || thirtyAgo),
    String(req.query.date_to || today),
  ]
}

function buildCond(
  params: unknown[],
  repId: string | undefined,
  factoryId: string | undefined,
  startIdx: number
): { cond: string; idx: number } {
  let cond = ''
  let idx = startIdx
  if (repId) { cond += ` AND o.rep_id = $${idx++}`; params.push(repId) }
  if (factoryId) { cond += ` AND o.factory_id = $${idx++}`; params.push(factoryId) }
  return { cond, idx }
}

export async function ordersReport(req: AuthRequest, res: Response) {
  const [from, to] = dateRange(req)
  const isAdmin = req.user?.role === 'admin'
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id
  const factoryId = req.query.factory_id as string | undefined

  const params: unknown[] = [from, to]
  const { cond } = buildCond(params, repId || undefined, factoryId || undefined, 3)

  const [summaryRes, byDayRes] = await Promise.all([
    query(`
      SELECT
        COUNT(o.id)::int                                        AS order_count,
        COALESCE(SUM(o.total_pieces), 0)::int                  AS total_pieces,
        COALESCE(SUM(o.total_value), 0)::numeric               AS total_value,
        COALESCE(SUM(o.rep_commission_value), 0)::numeric      AS rep_commission_value,
        COALESCE(SUM(o.office_commission_value), 0)::numeric   AS office_commission_value
      FROM orders o
      WHERE o.deleted_at IS NULL AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1::date AND $2::date ${cond}
    `, [...params]),
    query(`
      SELECT
        DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo')   AS date,
        COUNT(o.id)::int                                       AS order_count,
        COALESCE(SUM(o.total_pieces), 0)::int                 AS total_pieces,
        COALESCE(SUM(o.total_value), 0)::numeric              AS total_value
      FROM orders o
      WHERE o.deleted_at IS NULL AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1::date AND $2::date ${cond}
      GROUP BY DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo')
      ORDER BY date
    `, [...params]),
  ])

  res.json({ summary: summaryRes.rows[0], byDay: byDayRes.rows })
}

export async function commissionsReport(req: AuthRequest, res: Response) {
  const [from, to] = dateRange(req)
  const isAdmin = req.user?.role === 'admin'
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id
  const factoryId = req.query.factory_id as string | undefined

  const params: unknown[] = [from, to]
  const { cond } = buildCond(params, repId || undefined, factoryId || undefined, 3)

  const { rows } = await query(`
    SELECT
      o.id,
      o.order_number,
      DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo')          AS data_venda,
      f.name                                                         AS industria,
      u.name                                                         AS vendedor,
      o.industry_order_number                                        AS nr_ped_fabrica,
      c.name                                                         AS razao_social,
      c.trade_name                                                   AS cliente,
      c.city                                                         AS cidade,
      c.state                                                        AS uf,
      (SELECT STRING_AGG(DISTINCT oi.reference, ', '
         ORDER BY oi.reference)
       FROM order_items oi WHERE oi.order_id = o.id)                AS items_refs,
      (SELECT COUNT(*)::int
       FROM order_items oi WHERE oi.order_id = o.id)                AS items_count,
      o.total_pieces,
      o.total_value::numeric,
      o.discount_pct::numeric,
      o.rep_commission_value::numeric,
      o.rep_commission_pct::numeric,
      o.office_commission_value::numeric,
      o.office_commission_pct::numeric,
      o.commission_manual_override,
      CASE WHEN COALESCE(s.is_final, false) = true
           THEN o.total_value ELSE 0 END::numeric                   AS valor_faturado,
      CASE WHEN COALESCE(s.is_final, false) = false
           THEN o.total_value ELSE 0 END::numeric                   AS falta_faturar,
      s.name                                                         AS status_name,
      s.color                                                        AS status_color
    FROM orders o
    JOIN clients c   ON c.id = o.client_id
    JOIN users u     ON u.id = o.rep_id
    JOIN factories f ON f.id = o.factory_id
    LEFT JOIN order_statuses s ON s.id = o.status_id
    WHERE o.deleted_at IS NULL
      AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1::date AND $2::date ${cond}
    ORDER BY o.created_at DESC
  `, params)

  res.json(rows)
}

export async function clientsReport(req: AuthRequest, res: Response) {
  const [from, to] = dateRange(req)
  const isAdmin = req.user?.role === 'admin'
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id
  const factoryId = req.query.factory_id as string | undefined

  const params: unknown[] = [from, to]
  const { cond } = buildCond(params, repId || undefined, factoryId || undefined, 3)

  const { rows } = await query(`
    SELECT
      c.id,
      c.name,
      c.trade_name,
      c.city,
      c.state,
      COUNT(o.id)::int                           AS order_count,
      COALESCE(SUM(o.total_pieces), 0)::int      AS total_pieces,
      COALESCE(SUM(o.total_value), 0)::numeric   AS total_value
    FROM orders o
    JOIN clients c ON c.id = o.client_id
    WHERE o.deleted_at IS NULL AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1::date AND $2::date ${cond}
    GROUP BY c.id, c.name, c.trade_name, c.city, c.state
    ORDER BY total_value DESC
  `, params)

  res.json(rows)
}

export async function collectionsReport(req: AuthRequest, res: Response) {
  const [from, to] = dateRange(req)
  const factoryId = req.query.factory_id as string | undefined
  const isAdmin = req.user?.role === 'admin'
  // Admins can filter by rep; reps see only their own factories and sales
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id

  // Constrói parâmetros e cláusulas em um único array sequencial
  const params: unknown[] = [from, to]
  let salesCond = ''  // filtros dentro do subquery de vendas
  let ptWhere   = ''  // filtro na tabela de preços

  if (repId)      { salesCond += ` AND o.rep_id = $${params.length + 1}`;      params.push(repId) }
  if (factoryId)  { salesCond += ` AND o.factory_id = $${params.length + 1}`;  params.push(factoryId)
                    ptWhere    =  ` AND pt.factory_id = $${params.length}` }

  // Reps only see factories where they have at least one order
  if (!isAdmin && !factoryId) {
    const repIdx = params.length + 1
    params.push(req.user!.id)
    ptWhere += ` AND pt.factory_id IN (SELECT DISTINCT factory_id FROM orders WHERE rep_id = $${repIdx} AND deleted_at IS NULL)`
  }

  const { rows } = await query(`
    SELECT
      pt.id                                             AS price_table_id,
      f.name                                            AS factory_name,
      pt.name                                           AS table_name,
      COALESCE(pt.collection, pt.name)                  AS collection,
      COALESCE(pt.season, '')                           AS season,
      pt.year,
      p.id                                              AS product_id,
      p.reference,
      p.product_name,
      p.type,
      COALESCE(sales.order_count, 0)::int               AS order_count,
      COALESCE(sales.total_pieces, 0)::int              AS total_pieces,
      COALESCE(sales.total_value, 0)::numeric           AS total_value
    FROM price_tables pt
    JOIN factories f ON f.id = pt.factory_id
    JOIN products p ON p.price_table_id = pt.id AND p.active = true
    LEFT JOIN (
      SELECT oi.product_id,
        COUNT(DISTINCT o.id)           AS order_count,
        SUM(oi.total_pieces)           AS total_pieces,
        SUM(oi.subtotal)               AS total_value
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
        AND o.deleted_at IS NULL
        AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1::date AND $2::date
        ${salesCond}
      GROUP BY oi.product_id
    ) sales ON sales.product_id = p.id
    WHERE pt.active = true ${ptWhere}
    ORDER BY f.name, pt.name, COALESCE(sales.total_pieces, 0) DESC, p.reference
  `, params)

  // Agrupa por tabela de preço
  const tableMap = new Map<string, {
    price_table_id: string
    factory_name: string
    table_name: string
    collection: string
    season: string
    year: number | null
    products: typeof rows
  }>()

  for (const row of rows) {
    if (!tableMap.has(row.price_table_id)) {
      tableMap.set(row.price_table_id, {
        price_table_id: row.price_table_id,
        factory_name: row.factory_name,
        table_name: row.table_name,
        collection: row.collection,
        season: row.season,
        year: row.year,
        products: [],
      })
    }
    tableMap.get(row.price_table_id)!.products.push({
      product_id: row.product_id,
      reference: row.reference,
      product_name: row.product_name,
      type: row.type,
      order_count: row.order_count,
      total_pieces: row.total_pieces,
      total_value: row.total_value,
    })
  }

  res.json(Array.from(tableMap.values()))
}

export async function productsReport(req: AuthRequest, res: Response) {
  const [from, to] = dateRange(req)
  const isAdmin = req.user?.role === 'admin'
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id
  const factoryId = req.query.factory_id as string | undefined

  const params: unknown[] = [from, to]
  const { cond } = buildCond(params, repId || undefined, factoryId || undefined, 3)

  const { rows } = await query(`
    SELECT
      oi.reference,
      COUNT(DISTINCT o.id)::int                        AS order_count,
      COALESCE(SUM(oi.total_pieces), 0)::int           AS total_pieces,
      COALESCE(SUM(oi.subtotal), 0)::numeric           AS total_value
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.deleted_at IS NULL AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1::date AND $2::date ${cond}
    GROUP BY oi.reference
    ORDER BY total_pieces DESC
    LIMIT 100
  `, params)

  res.json(rows)
}

export async function catalogReport(req: AuthRequest, res: Response) {
  const priceTableId = req.query.price_table_id as string | undefined
  const factoryId    = req.query.factory_id    as string | undefined
  const isAdmin      = req.user?.role === 'admin'

  // Busca tabelas de preço disponíveis para montar o select
  const ptParams: unknown[] = []
  let ptWhere = ''
  if (priceTableId) { ptWhere += ` AND pt.id = $${ptParams.length + 1}`; ptParams.push(priceTableId) }
  else if (factoryId) { ptWhere += ` AND f.id = $${ptParams.length + 1}`; ptParams.push(factoryId) }

  // Non-admins only see catalogs of factories where they have orders
  if (!isAdmin) {
    ptWhere += ` AND f.id IN (SELECT DISTINCT factory_id FROM orders WHERE rep_id = $${ptParams.length + 1} AND deleted_at IS NULL)`
    ptParams.push(req.user!.id)
  }

  const { rows } = await query(`
    SELECT
      p.id            AS product_id,
      p.reference,
      p.product_name,
      p.model,
      p.size_range,
      p.base_price,
      p.type,
      p.observation,
      p.image_url,
      pt.id           AS price_table_id,
      pt.name         AS table_name,
      pt.collection,
      pt.season,
      pt.year,
      f.name          AS factory_name,
      (
        SELECT json_agg(
          json_build_object('color', gc.color, 'sizes', gc.sizes, 'total_pieces', gc.total_pieces)
          ORDER BY gc.sort_order
        )
        FROM grade_configs gc WHERE gc.product_id = p.id
      ) AS grade_configs
    FROM price_tables pt
    JOIN factories f ON f.id = pt.factory_id
    JOIN products p ON p.price_table_id = pt.id AND p.active = true
    WHERE pt.active = true ${ptWhere}
    ORDER BY f.name, pt.name, p.reference
  `, ptParams)

  // Agrupa por tabela de preço
  const tableMap = new Map<string, {
    price_table_id: string
    factory_name: string
    table_name: string
    collection: string
    season: string
    year: number | null
    products: unknown[]
  }>()

  for (const row of rows) {
    if (!tableMap.has(row.price_table_id)) {
      tableMap.set(row.price_table_id, {
        price_table_id: row.price_table_id,
        factory_name: row.factory_name,
        table_name: row.table_name,
        collection: row.collection,
        season: row.season,
        year: row.year,
        products: [],
      })
    }
    tableMap.get(row.price_table_id)!.products.push({
      product_id: row.product_id,
      reference: row.reference,
      product_name: row.product_name,
      model: row.model,
      size_range: row.size_range,
      base_price: row.base_price,
      type: row.type,
      observation: row.observation,
      grade_configs: row.grade_configs || [],
    })
  }

  res.json(Array.from(tableMap.values()))
}

// ─── Evolução de Vendas (mensal) ─────────────────────────────────────────────
export async function salesEvolutionReport(req: AuthRequest, res: Response) {
  const isAdmin = req.user?.role === 'admin'
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id
  const factoryId = req.query.factory_id as string | undefined
  const months = parseInt(String(req.query.months || '12'))

  const params: unknown[] = [months]
  let cond = ''
  let idx = 2
  if (repId && isAdmin) { cond += ` AND o.rep_id = $${idx++}`; params.push(repId) }
  if (!isAdmin) { cond += ` AND o.rep_id = $${idx++}`; params.push(req.user!.id) }
  if (factoryId) { cond += ` AND o.factory_id = $${idx++}`; params.push(factoryId) }

  const { rows } = await query(`
    SELECT
      TO_CHAR(DATE_TRUNC('month', o.created_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS mes,
      TO_CHAR(DATE_TRUNC('month', o.created_at AT TIME ZONE 'America/Sao_Paulo'), 'Mon/YY') AS mes_label,
      COUNT(o.id)::int                                        AS total_pedidos,
      COALESCE(SUM(o.total_value), 0)::numeric                AS total_value,
      COALESCE(SUM(o.total_pieces), 0)::int                   AS total_pieces,
      COALESCE(SUM(o.rep_commission_value), 0)::numeric       AS rep_commission,
      COALESCE(SUM(o.office_commission_value), 0)::numeric    AS office_commission,
      COUNT(DISTINCT o.client_id)::int                        AS clientes_atendidos,
      COALESCE(AVG(o.total_value), 0)::numeric                AS ticket_medio
    FROM orders o
    WHERE o.deleted_at IS NULL
      AND o.created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo' - ($1 - 1) * INTERVAL '1 month')
      ${cond}
    GROUP BY DATE_TRUNC('month', o.created_at AT TIME ZONE 'America/Sao_Paulo')
    ORDER BY 1
  `, params)

  res.json(rows)
}

// ─── Clientes Inativos ────────────────────────────────────────────────────────
export async function inactiveClientsReport(req: AuthRequest, res: Response) {
  const isAdmin = req.user?.role === 'admin'
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id
  const factoryId = req.query.factory_id as string | undefined
  const days = parseInt(String(req.query.days || '60'))

  const params: unknown[] = [days]
  let cond = ''
  let idx = 2
  if (repId && isAdmin) { cond += ` AND o.rep_id = $${idx++}`; params.push(repId) }
  if (!isAdmin) { cond += ` AND o.rep_id = $${idx++}`; params.push(req.user!.id) }
  if (factoryId) { cond += ` AND o.factory_id = $${idx++}`; params.push(factoryId) }

  const { rows } = await query(`
    SELECT
      c.id, c.name AS razao_social, c.trade_name AS nome_fantasia,
      c.city AS cidade, c.state AS uf, c.phone, c.whatsapp,
      u.name AS rep_name,
      MAX(o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS ultimo_pedido,
      COUNT(o.id)::int                                          AS total_pedidos,
      COALESCE(SUM(o.total_value), 0)::numeric                 AS total_comprado,
      EXTRACT(DAY FROM NOW() - MAX(o.created_at))::int         AS dias_sem_comprar
    FROM clients c
    LEFT JOIN users u ON u.id = c.rep_id
    LEFT JOIN orders o ON o.client_id = c.id AND o.deleted_at IS NULL ${cond}
    WHERE c.active = true
    GROUP BY c.id, c.name, c.trade_name, c.city, c.state, c.phone, c.whatsapp, u.name
    HAVING
      MAX(o.created_at) < NOW() - ($1 * INTERVAL '1 day')
      OR MAX(o.created_at) IS NULL
    ORDER BY dias_sem_comprar DESC NULLS FIRST
    LIMIT 200
  `, params)

  res.json(rows)
}

// ─── Performance por Representante ──────────────────────────────────────────
export async function repPerformanceReport(req: AuthRequest, res: Response) {
  const isAdmin = req.user?.role === 'admin'
  if (!isAdmin) { res.status(403).json({ error: 'Acesso negado' }); return }

  const [from, to] = dateRange(req)
  const factoryId = req.query.factory_id as string | undefined

  const params: unknown[] = [from, to]
  let cond = ''
  if (factoryId) { cond += ` AND o.factory_id = $3`; params.push(factoryId) }

  const { rows } = await query(`
    SELECT
      u.id AS rep_id,
      u.name AS rep_name,
      COUNT(DISTINCT o.id)::int                              AS total_pedidos,
      COALESCE(SUM(o.total_value), 0)::numeric               AS total_value,
      COALESCE(SUM(o.total_pieces), 0)::int                  AS total_pieces,
      COALESCE(SUM(o.rep_commission_value), 0)::numeric      AS comissao_rep,
      COALESCE(SUM(o.office_commission_value), 0)::numeric   AS comissao_escritorio,
      COUNT(DISTINCT o.client_id)::int                       AS clientes_atendidos,
      COALESCE(AVG(o.total_value), 0)::numeric               AS ticket_medio,
      COALESCE(AVG(o.total_pieces), 0)::numeric              AS media_pecas_pedido
    FROM users u
    LEFT JOIN orders o ON o.rep_id = u.id
      AND o.deleted_at IS NULL
      AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1::date AND $2::date
      ${cond}
    WHERE u.role = 'representante' AND u.active = true
    GROUP BY u.id, u.name
    ORDER BY total_value DESC
  `, params)

  res.json(rows)
}

// ─── Curva ABC de Clientes ────────────────────────────────────────────────────
export async function abcClientsReport(req: AuthRequest, res: Response) {
  const isAdmin = req.user?.role === 'admin'
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id
  const factoryId = req.query.factory_id as string | undefined
  const [from, to] = dateRange(req)

  const params: unknown[] = [from, to]
  const { cond } = buildCond(params, repId || undefined, factoryId || undefined, 3)

  const { rows } = await query(`
    WITH client_sales AS (
      SELECT
        c.id, c.name AS razao_social, c.trade_name AS nome_fantasia,
        c.city AS cidade, c.state AS uf, u.name AS rep_name,
        COUNT(o.id)::int                              AS total_pedidos,
        COALESCE(SUM(o.total_value), 0)::numeric      AS total_value,
        COALESCE(SUM(o.total_pieces), 0)::int         AS total_pieces,
        MAX(o.created_at)::date                       AS ultimo_pedido
      FROM clients c
      LEFT JOIN users u ON u.id = c.rep_id
      JOIN orders o ON o.client_id = c.id AND o.deleted_at IS NULL
        AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1::date AND $2::date ${cond}
      WHERE c.active = true
      GROUP BY c.id, c.name, c.trade_name, c.city, c.state, u.name
    ),
    total AS (SELECT SUM(total_value) AS grand_total FROM client_sales),
    ranked AS (
      SELECT cs.*, t.grand_total,
        cs.total_value / NULLIF(t.grand_total, 0) * 100 AS pct,
        SUM(cs.total_value) OVER (ORDER BY cs.total_value DESC) / NULLIF(t.grand_total, 0) * 100 AS pct_acum
      FROM client_sales cs CROSS JOIN total t
    )
    SELECT *, CASE
      WHEN pct_acum <= 80 THEN 'A'
      WHEN pct_acum <= 95 THEN 'B'
      ELSE 'C'
    END AS classe
    FROM ranked
    ORDER BY total_value DESC
  `, params)

  res.json(rows)
}

// ─── Comparativo de Período ───────────────────────────────────────────────────
export async function periodComparisonReport(req: AuthRequest, res: Response) {
  const isAdmin = req.user?.role === 'admin'
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id
  const factoryId = req.query.factory_id as string | undefined
  const [from, to] = dateRange(req)

  // Período anterior: mesma duração
  const fromD = new Date(from)
  const toD = new Date(to)
  const diff = toD.getTime() - fromD.getTime()
  const prevFrom = new Date(fromD.getTime() - diff - 86400000).toISOString().split('T')[0]
  const prevTo   = new Date(fromD.getTime() - 86400000).toISOString().split('T')[0]

  const makeQuery = async (f: string, t: string) => {
    const params: unknown[] = [f, t]
    const { cond } = buildCond(params, repId || undefined, factoryId || undefined, 3)
    const { rows } = await query(`
      SELECT
        COUNT(o.id)::int                                       AS total_pedidos,
        COALESCE(SUM(o.total_value), 0)::numeric               AS total_value,
        COALESCE(SUM(o.total_pieces), 0)::int                  AS total_pieces,
        COALESCE(SUM(o.rep_commission_value), 0)::numeric      AS rep_commission,
        COALESCE(SUM(o.office_commission_value), 0)::numeric   AS office_commission,
        COUNT(DISTINCT o.client_id)::int                       AS clientes_atendidos,
        COALESCE(AVG(o.total_value), 0)::numeric               AS ticket_medio
      FROM orders o
      WHERE o.deleted_at IS NULL AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1::date AND $2::date ${cond}
    `, params)
    return rows[0]
  }

  const [current, previous] = await Promise.all([
    makeQuery(from, to),
    makeQuery(prevFrom, prevTo),
  ])

  res.json({ current, previous, period: { from, to }, prev_period: { from: prevFrom, to: prevTo } })
}

// ─── Análise por Região/UF ────────────────────────────────────────────────────
export async function regionReport(req: AuthRequest, res: Response) {
  const isAdmin = req.user?.role === 'admin'
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id
  const factoryId = req.query.factory_id as string | undefined
  const [from, to] = dateRange(req)

  const params: unknown[] = [from, to]
  const { cond } = buildCond(params, repId || undefined, factoryId || undefined, 3)

  const { rows } = await query(`
    SELECT
      COALESCE(c.state, 'N/D') AS uf,
      COUNT(DISTINCT o.id)::int                         AS total_pedidos,
      COUNT(DISTINCT o.client_id)::int                  AS clientes_atendidos,
      COALESCE(SUM(o.total_value), 0)::numeric          AS total_value,
      COALESCE(SUM(o.total_pieces), 0)::int             AS total_pieces,
      COALESCE(AVG(o.total_value), 0)::numeric          AS ticket_medio,
      COALESCE(SUM(o.rep_commission_value), 0)::numeric AS comissao_rep
    FROM orders o
    JOIN clients c ON c.id = o.client_id
    WHERE o.deleted_at IS NULL AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN $1::date AND $2::date ${cond}
    GROUP BY c.state
    ORDER BY total_value DESC
  `, params)

  res.json(rows)
}

// ─── Projeção de Comissão ─────────────────────────────────────────────────────
export async function commissionProjectionReport(req: AuthRequest, res: Response) {
  const isAdmin = req.user?.role === 'admin'
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id
  const factoryId = req.query.factory_id as string | undefined

  const params: unknown[] = []
  let repCond = ''
  let factCond = ''
  let idx = 1

  if (!isAdmin) { repCond = ` AND o.rep_id = $${idx++}`; params.push(req.user!.id) }
  else if (repId) { repCond = ` AND o.rep_id = $${idx++}`; params.push(repId) }
  if (factoryId) { factCond = ` AND o.factory_id = $${idx++}`; params.push(factoryId) }

  const { rows } = await query(`
    SELECT
      u.name AS rep_name,
      s.name AS status_name, s.color AS status_color,
      COUNT(o.id)::int                                       AS pedidos,
      COALESCE(SUM(o.total_value), 0)::numeric               AS total_value,
      COALESCE(SUM(o.total_pieces), 0)::int                  AS total_pieces,
      COALESCE(SUM(o.rep_commission_value), 0)::numeric      AS comissao_rep,
      COALESCE(SUM(o.office_commission_value), 0)::numeric   AS comissao_escritorio,
      CASE WHEN s.is_final THEN 'faturado' ELSE 'a_faturar' END AS situacao
    FROM orders o
    JOIN users u ON u.id = o.rep_id
    LEFT JOIN order_statuses s ON s.id = o.status_id
    WHERE o.deleted_at IS NULL ${repCond} ${factCond}
    GROUP BY u.name, s.name, s.color, s.is_final
    ORDER BY situacao, comissao_rep DESC
  `, params)

  res.json(rows)
}
