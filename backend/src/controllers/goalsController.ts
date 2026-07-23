import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

export async function listGoals(req: AuthRequest, res: Response) {
  const isAdmin = req.user!.role === 'admin'
  const repId   = req.user!.id

  // Admin vê todas; rep vê metas de fábrica + suas próprias metas de rep
  const whereClause = isAdmin
    ? 'WHERE g.active = true'
    : `WHERE g.active = true AND (g.type = 'factory' OR g.rep_id = $1)`
  const params = isAdmin ? [] : [repId]

  const achievedRepFilter = isAdmin ? '' : `AND o.rep_id = '${repId}'`

  const { rows } = await query(`
    SELECT g.*,
      f.name as factory_name,
      u.name as rep_name,
      COALESCE((
        SELECT SUM(o.total_pieces)
        FROM orders o
        WHERE o.deleted_at IS NULL
          AND (g.factory_id IS NULL OR o.factory_id = g.factory_id)
          AND (g.rep_id IS NULL OR o.rep_id = g.rep_id)
          ${achievedRepFilter}
          AND (g.period_start IS NULL OR DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') >= g.period_start)
          AND (g.period_end   IS NULL OR DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') <= g.period_end)
      ), 0)::int AS achieved_pieces
    FROM goals g
    LEFT JOIN factories f ON f.id = g.factory_id
    LEFT JOIN users u ON u.id = g.rep_id
    ${whereClause}
    ORDER BY g.type, g.label
  `, params)
  res.json(rows)
}

export async function createGoal(req: AuthRequest, res: Response) {
  const { type, factory_id, rep_id, label, target_pieces, period_label, period_start, period_end } = req.body
  if (!type || !label || !target_pieces) {
    res.status(400).json({ error: 'Campos obrigatórios: type, label, target_pieces' }); return
  }
  const { rows: [goal] } = await query(
    `INSERT INTO goals (type, factory_id, rep_id, label, target_pieces, period_label, period_start, period_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [type, factory_id || null, rep_id || null, label, target_pieces, period_label || null, period_start || null, period_end || null]
  )
  res.status(201).json(goal)
}

export async function updateGoal(req: AuthRequest, res: Response) {
  const { label, target_pieces, period_label, period_start, period_end, active } = req.body
  const { rows: [goal] } = await query(
    `UPDATE goals SET label=$1, target_pieces=$2, period_label=$3, active=$4, period_start=$5, period_end=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [label, target_pieces, period_label || null, active ?? true, period_start || null, period_end || null, req.params.id]
  )
  if (!goal) { res.status(404).json({ error: 'Meta não encontrada' }); return }
  res.json(goal)
}

export async function deleteGoal(req: AuthRequest, res: Response) {
  await query('DELETE FROM goals WHERE id=$1', [req.params.id])
  res.status(204).send()
}
