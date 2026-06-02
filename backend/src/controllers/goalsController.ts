import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

export async function listGoals(req: AuthRequest, res: Response) {
  const { rows } = await query(`
    SELECT g.*,
      f.name as factory_name,
      u.name as rep_name,
      COALESCE((
        SELECT SUM(oi.total_pieces)
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        JOIN price_tables pt ON pt.id = p.price_table_id
        WHERE o.deleted_at IS NULL
          AND (g.factory_id IS NULL OR pt.factory_id = g.factory_id)
          AND (g.rep_id IS NULL OR o.rep_id = g.rep_id)
      ), 0)::int AS achieved_pieces
    FROM goals g
    LEFT JOIN factories f ON f.id = g.factory_id
    LEFT JOIN users u ON u.id = g.rep_id
    WHERE g.active = true
    ORDER BY g.type, g.label
  `)
  res.json(rows)
}

export async function createGoal(req: AuthRequest, res: Response) {
  const { type, factory_id, rep_id, label, target_pieces, period_label } = req.body
  if (!type || !label || !target_pieces) {
    res.status(400).json({ error: 'Campos obrigatórios: type, label, target_pieces' }); return
  }
  const { rows: [goal] } = await query(
    `INSERT INTO goals (type, factory_id, rep_id, label, target_pieces, period_label)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [type, factory_id || null, rep_id || null, label, target_pieces, period_label || null]
  )
  res.status(201).json(goal)
}

export async function updateGoal(req: AuthRequest, res: Response) {
  const { label, target_pieces, period_label, active } = req.body
  const { rows: [goal] } = await query(
    `UPDATE goals SET label=$1, target_pieces=$2, period_label=$3, active=$4, updated_at=NOW()
     WHERE id=$5 RETURNING *`,
    [label, target_pieces, period_label || null, active ?? true, req.params.id]
  )
  if (!goal) { res.status(404).json({ error: 'Meta não encontrada' }); return }
  res.json(goal)
}

export async function deleteGoal(req: AuthRequest, res: Response) {
  await query('DELETE FROM goals WHERE id=$1', [req.params.id])
  res.status(204).send()
}
