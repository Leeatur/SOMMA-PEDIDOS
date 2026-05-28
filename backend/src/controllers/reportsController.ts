import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

function dateRange(req: AuthRequest): [string, string] {
  const today = new Date().toISOString().split('T')[0]
  const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
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

  const params: unknown[] = [`${from} 00:00:00`, `${to} 23:59:59`]
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
      WHERE o.created_at BETWEEN $1 AND $2 ${cond}
    `, [...params]),
    query(`
      SELECT
        DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo')   AS date,
        COUNT(o.id)::int                                       AS order_count,
        COALESCE(SUM(o.total_pieces), 0)::int                 AS total_pieces,
        COALESCE(SUM(o.total_value), 0)::numeric              AS total_value
      FROM orders o
      WHERE o.created_at BETWEEN $1 AND $2 ${cond}
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

  const params: unknown[] = [`${from} 00:00:00`, `${to} 23:59:59`]
  const { cond } = buildCond(params, repId || undefined, undefined, 3)

  const { rows } = await query(`
    SELECT
      u.id                                                      AS rep_id,
      u.name                                                    AS rep_name,
      COUNT(o.id)::int                                          AS order_count,
      COALESCE(SUM(o.total_pieces), 0)::int                    AS total_pieces,
      COALESCE(SUM(o.total_value), 0)::numeric                 AS total_value,
      COALESCE(SUM(o.rep_commission_value), 0)::numeric        AS rep_commission_value,
      COALESCE(SUM(o.office_commission_value), 0)::numeric     AS office_commission_value
    FROM orders o
    JOIN users u ON u.id = o.rep_id
    WHERE o.created_at BETWEEN $1 AND $2 ${cond}
    GROUP BY u.id, u.name
    ORDER BY total_value DESC
  `, params)

  res.json(rows)
}

export async function clientsReport(req: AuthRequest, res: Response) {
  const [from, to] = dateRange(req)
  const isAdmin = req.user?.role === 'admin'
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id
  const factoryId = req.query.factory_id as string | undefined

  const params: unknown[] = [`${from} 00:00:00`, `${to} 23:59:59`]
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
    WHERE o.created_at BETWEEN $1 AND $2 ${cond}
    GROUP BY c.id, c.name, c.trade_name, c.city, c.state
    ORDER BY total_value DESC
  `, params)

  res.json(rows)
}

export async function collectionsReport(req: AuthRequest, res: Response) {
  const [from, to] = dateRange(req)
  const factoryId = req.query.factory_id as string | undefined
  const isAdmin = req.user?.role === 'admin'
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id

  // Constrói parâmetros e cláusulas em um único array sequencial
  const params: unknown[] = [`${from} 00:00:00`, `${to} 23:59:59`]
  let salesCond = ''  // filtros dentro do subquery de vendas
  let ptWhere   = ''  // filtro na tabela de preços

  if (repId)      { salesCond += ` AND o.rep_id = $${params.length + 1}`;      params.push(repId) }
  if (factoryId)  { salesCond += ` AND o.factory_id = $${params.length + 1}`;  params.push(factoryId)
                    ptWhere    =  ` AND pt.factory_id = $${params.length}` }

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
        AND o.created_at BETWEEN $1 AND $2
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

  const params: unknown[] = [`${from} 00:00:00`, `${to} 23:59:59`]
  const { cond } = buildCond(params, repId || undefined, factoryId || undefined, 3)

  const { rows } = await query(`
    SELECT
      oi.reference,
      COUNT(DISTINCT o.id)::int                        AS order_count,
      COALESCE(SUM(oi.total_pieces), 0)::int           AS total_pieces,
      COALESCE(SUM(oi.subtotal), 0)::numeric           AS total_value
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.created_at BETWEEN $1 AND $2 ${cond}
    GROUP BY oi.reference
    ORDER BY total_pieces DESC
    LIMIT 100
  `, params)

  res.json(rows)
}
