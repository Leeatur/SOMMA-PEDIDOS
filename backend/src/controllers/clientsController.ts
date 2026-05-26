import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

export async function listClients(req: AuthRequest, res: Response) {
  const { search } = req.query
  const isAdmin = req.user!.role === 'admin'

  let sql = `
    SELECT c.*, u.name as rep_name
    FROM clients c
    LEFT JOIN users u ON u.id = c.rep_id
    WHERE c.active = true
  `
  const params: unknown[] = []
  if (!isAdmin) { sql += ` AND c.rep_id = $1`; params.push(req.user!.id) }
  if (search) {
    const idx = params.length + 1
    sql += ` AND (c.name ILIKE $${idx} OR c.trade_name ILIKE $${idx} OR c.cnpj ILIKE $${idx} OR c.city ILIKE $${idx})`
    params.push(`%${search}%`)
  }
  sql += ' ORDER BY c.name'
  const { rows } = await query(sql, params)
  res.json(rows)
}

export async function getClient(req: AuthRequest, res: Response) {
  const { rows } = await query(
    `SELECT c.*, u.name as rep_name FROM clients c
     LEFT JOIN users u ON u.id = c.rep_id WHERE c.id=$1 AND c.active=true`,
    [req.params.id]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Cliente não encontrado' }); return }
  const isAdmin = req.user!.role === 'admin'
  if (!isAdmin && rows[0].rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Acesso negado' }); return
  }
  res.json(rows[0])
}

export async function createClient(req: AuthRequest, res: Response) {
  const { name, trade_name, cnpj, cpf, address, city, state, zip, phone, whatsapp, email, rep_id, notes } = req.body
  if (!name) { res.status(400).json({ error: 'Nome é obrigatório' }); return }
  const assignedRep = req.user!.role === 'admin' ? (rep_id || req.user!.id) : req.user!.id
  const { rows } = await query(
    `INSERT INTO clients (name, trade_name, cnpj, cpf, address, city, state, zip, phone, whatsapp, email, rep_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [name, trade_name||null, cnpj||null, cpf||null, address||null, city||null,
     state||null, zip||null, phone||null, whatsapp||null, email||null, assignedRep, notes||null]
  )
  res.status(201).json(rows[0])
}

export async function updateClient(req: AuthRequest, res: Response) {
  const { name, trade_name, cnpj, cpf, address, city, state, zip, phone, whatsapp, email, rep_id, notes, active } = req.body
  const { rows: [existing] } = await query('SELECT rep_id FROM clients WHERE id=$1', [req.params.id])
  if (!existing) { res.status(404).json({ error: 'Cliente não encontrado' }); return }
  const isAdmin = req.user!.role === 'admin'
  if (!isAdmin && existing.rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Acesso negado' }); return
  }
  const assignedRep = isAdmin ? (rep_id || existing.rep_id) : existing.rep_id
  const { rows } = await query(
    `UPDATE clients SET name=$1, trade_name=$2, cnpj=$3, cpf=$4, address=$5, city=$6,
     state=$7, zip=$8, phone=$9, whatsapp=$10, email=$11, rep_id=$12, notes=$13, active=$14, updated_at=NOW()
     WHERE id=$15 RETURNING *`,
    [name, trade_name||null, cnpj||null, cpf||null, address||null, city||null,
     state||null, zip||null, phone||null, whatsapp||null, email||null, assignedRep, notes||null, active??true, req.params.id]
  )
  res.json(rows[0])
}
