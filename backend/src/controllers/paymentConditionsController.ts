import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

export async function listConditions(req: AuthRequest, res: Response) {
  const { rows } = await query(
    'SELECT * FROM payment_conditions WHERE active=true ORDER BY sort_order, name'
  )
  res.json(rows)
}

export async function createCondition(req: AuthRequest, res: Response) {
  const { name, sort_order } = req.body
  if (!name?.trim()) { res.status(400).json({ error: 'Nome é obrigatório' }); return }
  const { rows } = await query(
    'INSERT INTO payment_conditions (name, sort_order) VALUES ($1,$2) RETURNING *',
    [name.trim(), sort_order ?? 0]
  )
  res.status(201).json(rows[0])
}

export async function updateCondition(req: AuthRequest, res: Response) {
  const { name, sort_order, active } = req.body
  if (!name?.trim()) { res.status(400).json({ error: 'Nome é obrigatório' }); return }
  const { rows } = await query(
    'UPDATE payment_conditions SET name=$1, sort_order=$2, active=$3 WHERE id=$4 RETURNING *',
    [name.trim(), sort_order ?? 0, active ?? true, req.params.id]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Condição não encontrada' }); return }
  res.json(rows[0])
}

export async function deleteCondition(req: AuthRequest, res: Response) {
  await query('UPDATE payment_conditions SET active=false WHERE id=$1', [req.params.id])
  res.json({ ok: true })
}

export async function reorderConditions(req: AuthRequest, res: Response) {
  const { order } = req.body // [{id, sort_order}]
  if (!Array.isArray(order)) { res.status(400).json({ error: 'order deve ser array' }); return }
  for (const item of order) {
    await query('UPDATE payment_conditions SET sort_order=$1 WHERE id=$2', [item.sort_order, item.id])
  }
  res.json({ ok: true })
}
