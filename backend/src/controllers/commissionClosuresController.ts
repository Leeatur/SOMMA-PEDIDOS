import { Request, Response } from 'express'
import { pool } from '../config/database'

const COMPETENCIA = /^\d{4}-\d{2}$/

interface AuthRequest extends Request {
  user?: { id: string; role: string; name?: string }
}

export async function listClosures(req: AuthRequest, res: Response) {
  const isAdmin = req.user?.role === 'admin'
  const repId = isAdmin ? (req.query.rep_id as string | undefined) : req.user?.id
  const { competencia } = req.query as { competencia?: string }

  const params: unknown[] = []
  const conds: string[] = []
  if (repId)       { params.push(repId);      conds.push(`rep_id = $${params.length}::uuid`) }
  if (competencia) { params.push(competencia); conds.push(`competencia = $${params.length}`) }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const client = await pool.connect()
  try {
    const { rows } = await client.query(`
      SELECT id, rep_id, rep_name, competencia,
             total_pedidos,
             total_faturado::numeric,
             total_comissao::numeric,
             total_debitos::numeric,
             valor_liquido::numeric,
             closed_by_name,
             created_at
        FROM commission_closures
       ${where}
       ORDER BY competencia DESC, rep_name ASC
    `, params)
    res.json(rows)
  } finally {
    client.release()
  }
}

export async function getClosure(req: AuthRequest, res: Response) {
  const isAdmin = req.user?.role === 'admin'
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      'SELECT * FROM commission_closures WHERE id = $1::uuid', [req.params.id]
    )
    if (!rows.length) { res.status(404).json({ error: 'Fechamento não encontrado' }); return }
    const closure = rows[0]
    if (!isAdmin && closure.rep_id !== req.user?.id) {
      res.status(403).json({ error: 'Acesso negado' }); return
    }
    res.json(closure)
  } finally {
    client.release()
  }
}

export async function createClosure(req: AuthRequest, res: Response) {
  const { rep_id, competencia, rows: snapshot } = req.body as {
    rep_id?: string; competencia?: string; rows?: unknown[]
  }

  if (!rep_id || !competencia || !COMPETENCIA.test(competencia)) {
    res.status(400).json({ error: 'rep_id e competência (AAAA-MM) são obrigatórios.' }); return
  }

  const client = await pool.connect()
  try {
    const { rows: repRows } = await client.query(
      'SELECT name FROM users WHERE id = $1::uuid', [rep_id]
    )
    if (!repRows.length) { res.status(404).json({ error: 'Representante não encontrado' }); return }

    const repName = repRows[0].name
    const snapshotRows = Array.isArray(snapshot) ? snapshot : []

    const totalPedidos  = snapshotRows.length
    const totalFaturado = snapshotRows.reduce((s: number, r: any) =>
      s + Number(r.valor_faturado_fabrica ?? r.total_value ?? 0), 0)
    const totalComissao = snapshotRows.reduce((s: number, r: any) =>
      s + Number(r.rep_commission_value ?? 0), 0)

    const { rows: debitRows } = await client.query(`
      SELECT id, descricao, valor::numeric
        FROM comissao_debitos
       WHERE rep_id = $1::uuid AND competencia = $2
       ORDER BY created_at
    `, [rep_id, competencia])

    const totalDebitos = debitRows.reduce((s: number, r: any) => s + Number(r.valor), 0)
    const valorLiquido = totalComissao - totalDebitos

    const { rows: result } = await client.query(`
      INSERT INTO commission_closures
        (rep_id, rep_name, competencia, total_pedidos, total_faturado, total_comissao,
         total_debitos, valor_liquido, snapshot, debitos, closed_by_name)
      VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
      ON CONFLICT (rep_id, competencia) DO UPDATE SET
        rep_name       = EXCLUDED.rep_name,
        total_pedidos  = EXCLUDED.total_pedidos,
        total_faturado = EXCLUDED.total_faturado,
        total_comissao = EXCLUDED.total_comissao,
        total_debitos  = EXCLUDED.total_debitos,
        valor_liquido  = EXCLUDED.valor_liquido,
        snapshot       = EXCLUDED.snapshot,
        debitos        = EXCLUDED.debitos,
        closed_by_name = EXCLUDED.closed_by_name,
        created_at     = NOW()
      RETURNING id, rep_id, rep_name, competencia, total_pedidos,
                total_faturado::numeric, total_comissao::numeric,
                total_debitos::numeric, valor_liquido::numeric,
                closed_by_name, created_at
    `, [
      rep_id, repName, competencia, totalPedidos, totalFaturado, totalComissao,
      totalDebitos, valorLiquido,
      JSON.stringify(snapshotRows), JSON.stringify(debitRows),
      req.user?.name || null,
    ])

    res.status(201).json(result[0])
  } finally {
    client.release()
  }
}

export async function deleteClosure(req: AuthRequest, res: Response) {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      'DELETE FROM commission_closures WHERE id = $1::uuid RETURNING id', [req.params.id]
    )
    if (!rows.length) { res.status(404).json({ error: 'Fechamento não encontrado' }); return }
    res.json({ ok: true })
  } finally {
    client.release()
  }
}
