import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

export async function listFactories(req: AuthRequest, res: Response) {
  const { rows } = await query(
    `SELECT f.*,
       COUNT(pt.id) FILTER (WHERE pt.active) AS active_tables
     FROM factories f
     LEFT JOIN price_tables pt ON pt.factory_id = f.id
     WHERE f.active = true
     GROUP BY f.id
     ORDER BY f.name`
  )
  res.json(rows)
}

export async function getFactory(req: AuthRequest, res: Response) {
  const { rows } = await query('SELECT * FROM factories WHERE id=$1', [req.params.id])
  if (!rows[0]) { res.status(404).json({ error: 'Fábrica não encontrada' }); return }
  res.json(rows[0])
}

export async function createFactory(req: AuthRequest, res: Response) {
  const { name, contact, notes } = req.body
  if (!name) { res.status(400).json({ error: 'Nome é obrigatório' }); return }
  const { rows } = await query(
    `INSERT INTO factories (name, contact, notes)
     VALUES ($1, $2, $3) RETURNING *`,
    [name, contact || null, notes || null]
  )
  res.status(201).json(rows[0])
}

export async function updateFactory(req: AuthRequest, res: Response) {
  const { name, contact, notes, active } = req.body
  const { rows } = await query(
    `UPDATE factories SET name=$1, contact=$2, notes=$3, active=$4, updated_at=NOW()
     WHERE id=$5 RETURNING *`,
    [name, contact || null, notes || null, active ?? true, req.params.id]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Fábrica não encontrada' }); return }
  res.json(rows[0])
}

export async function uploadLogo(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }
  const logoUrl = `/uploads/logos/${req.file.filename}`
  const { rows } = await query(
    'UPDATE factories SET logo_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
    [logoUrl, req.params.id]
  )
  res.json(rows[0])
}
