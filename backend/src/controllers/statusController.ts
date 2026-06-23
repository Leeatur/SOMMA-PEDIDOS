import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

export async function listStatuses(req: AuthRequest, res: Response) {
  const { rows } = await query(
    'SELECT * FROM order_statuses WHERE active=true ORDER BY sort_order, name'
  )
  res.json(rows)
}

export async function createStatus(req: AuthRequest, res: Response) {
  const { name, color, icon, sort_order, is_initial, is_final } = req.body
  if (!name) { res.status(400).json({ error: 'Nome é obrigatório' }); return }

  // Garante que só existe um status inicial
  if (is_initial) {
    await query('UPDATE order_statuses SET is_initial=false WHERE is_initial=true')
  }

  const { rows } = await query(
    `INSERT INTO order_statuses (name, color, icon, sort_order, is_initial, is_final)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, color||'#6B7280', icon||null, sort_order||0, is_initial||false, is_final||false]
  )
  res.status(201).json(rows[0])
}

export async function updateStatus(req: AuthRequest, res: Response) {
  const { name, color, icon, sort_order, is_initial, is_final, active } = req.body

  if (is_initial) {
    await query('UPDATE order_statuses SET is_initial=false WHERE is_initial=true AND id != $1', [req.params.id])
  }

  const { rows } = await query(
    `UPDATE order_statuses
     SET name=$1, color=$2, icon=$3, sort_order=$4, is_initial=$5, is_final=$6, active=$7, updated_at=NOW()
     WHERE id=$8 RETURNING *`,
    [name, color||'#6B7280', icon||null, sort_order||0, is_initial||false, is_final||false, active??true, req.params.id]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Status não encontrado' }); return }
  res.json(rows[0])
}

export async function deleteStatus(req: AuthRequest, res: Response) {
  try {
    const id = req.params.id

    // Bloqueia se houver pedidos ATIVOS (não excluídos) com este status
    const { rows: active } = await query(
      'SELECT COUNT(*) FROM orders WHERE status_id=$1 AND deleted_at IS NULL', [id]
    )
    if (parseInt(active[0].count) > 0) {
      res.status(400).json({ error: 'Status em uso por pedidos ativos. Desative-o em vez de excluir.' })
      return
    }

    // Limpa dependências antes de deletar
    await query('DELETE FROM order_status_history WHERE from_status_id=$1 OR to_status_id=$1', [id])
    await query('UPDATE orders SET status_id=NULL WHERE status_id=$1 AND deleted_at IS NOT NULL', [id])

    await query('DELETE FROM order_statuses WHERE id=$1', [id])
    res.json({ message: 'Status excluído' })
  } catch (err) {
    console.error('deleteStatus error:', err)
    res.status(500).json({ error: 'Erro ao excluir status. Tente novamente.' })
  }
}

export async function reorderStatuses(req: AuthRequest, res: Response) {
  const { order } = req.body // [{id, sort_order}]
  if (!Array.isArray(order)) { res.status(400).json({ error: 'order deve ser array' }); return }
  for (const item of order) {
    await query('UPDATE order_statuses SET sort_order=$1 WHERE id=$2', [item.sort_order, item.id])
  }
  res.json({ message: 'Ordem atualizada' })
}
