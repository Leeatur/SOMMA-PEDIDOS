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
