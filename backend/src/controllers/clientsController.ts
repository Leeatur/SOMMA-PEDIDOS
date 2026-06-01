import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

export async function listClients(req: AuthRequest, res: Response) {
  const { search } = req.query

  let sql = `
    SELECT c.*, u.name as rep_name
    FROM clients c
    LEFT JOIN users u ON u.id = c.rep_id
    WHERE c.active = true
  `
  const params: unknown[] = []

  if (search) {
    const idx = params.length + 1
    sql += ` AND (
      c.name ILIKE $${idx} OR c.trade_name ILIKE $${idx} OR
      c.cnpj ILIKE $${idx} OR c.cpf ILIKE $${idx} OR
      c.city ILIKE $${idx} OR c.state ILIKE $${idx} OR
      c.phone ILIKE $${idx} OR c.whatsapp ILIKE $${idx} OR
      c.email ILIKE $${idx} OR c.address ILIKE $${idx} OR
      c.zip ILIKE $${idx} OR c.state_registration ILIKE $${idx} OR
      u.name ILIKE $${idx}
    )`
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
  res.json(rows[0])
}

export async function createClient(req: AuthRequest, res: Response) {
  const { name, trade_name, cnpj, cpf, state_registration, address, city, state, zip, phone, whatsapp, email, rep_id, notes } = req.body
  if (!name) { res.status(400).json({ error: 'Nome é obrigatório' }); return }
  const assignedRep = req.user!.role === 'admin' ? (rep_id || req.user!.id) : req.user!.id
  const { rows } = await query(
    `INSERT INTO clients (name, trade_name, cnpj, cpf, state_registration, address, city, state, zip, phone, whatsapp, email, rep_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [name, trade_name||null, cnpj||null, cpf||null, state_registration||null, address||null, city||null,
     state||null, zip||null, phone||null, whatsapp||null, email||null, assignedRep, notes||null]
  )
  res.status(201).json(rows[0])
}

export async function deleteClient(req: AuthRequest, res: Response) {
  const { rows: [existing] } = await query('SELECT id FROM clients WHERE id=$1 AND active=true', [req.params.id])
  if (!existing) { res.status(404).json({ error: 'Cliente não encontrado' }); return }
  await query('UPDATE clients SET active=false, updated_at=NOW() WHERE id=$1', [req.params.id])
  res.status(204).send()
}

export async function updateClient(req: AuthRequest, res: Response) {
  const { name, trade_name, cnpj, cpf, state_registration, address, city, state, zip, phone, whatsapp, email, rep_id, notes, active } = req.body
  const { rows: [existing] } = await query('SELECT rep_id FROM clients WHERE id=$1', [req.params.id])
  if (!existing) { res.status(404).json({ error: 'Cliente não encontrado' }); return }
  const isAdmin = req.user!.role === 'admin'
  const assignedRep = isAdmin ? (rep_id || existing.rep_id) : existing.rep_id
  const { rows } = await query(
    `UPDATE clients SET name=$1, trade_name=$2, cnpj=$3, cpf=$4, state_registration=$5, address=$6, city=$7,
     state=$8, zip=$9, phone=$10, whatsapp=$11, email=$12, rep_id=$13, notes=$14, active=$15, updated_at=NOW()
     WHERE id=$16 RETURNING *`,
    [name, trade_name||null, cnpj||null, cpf||null, state_registration||null, address||null, city||null,
     state||null, zip||null, phone||null, whatsapp||null, email||null, assignedRep, notes||null, active??true, req.params.id]
  )
  res.json(rows[0])
}
