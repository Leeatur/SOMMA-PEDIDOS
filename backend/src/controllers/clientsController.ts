import { Response } from 'express'
import * as XLSX from 'xlsx'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

export async function listClients(req: AuthRequest, res: Response) {
  const { search } = req.query

  // All authenticated users see all active clients (no rep_id filter)
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
  const { name, trade_name, cnpj, cpf, state_registration, address, city, state, zip, phone, whatsapp, email, rep_id, notes, buyer_name } = req.body
  if (!name) { res.status(400).json({ error: 'Nome é obrigatório' }); return }
  const assignedRep = req.user!.role === 'admin' ? (rep_id || req.user!.id) : req.user!.id
  const { rows } = await query(
    `INSERT INTO clients (name, trade_name, cnpj, cpf, state_registration, address, city, state, zip, phone, whatsapp, email, rep_id, notes, buyer_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [name, trade_name||null, cnpj||null, cpf||null, state_registration||null, address||null, city||null,
     state||null, zip||null, phone||null, whatsapp||null, email||null, assignedRep, notes||null, buyer_name||null]
  )
  res.status(201).json(rows[0])
}

export async function deleteClient(req: AuthRequest, res: Response) {
  const { rows: [existing] } = await query('SELECT id FROM clients WHERE id=$1 AND active=true', [req.params.id])
  if (!existing) { res.status(404).json({ error: 'Cliente não encontrado' }); return }
  await query('UPDATE clients SET active=false, updated_at=NOW() WHERE id=$1', [req.params.id])
  res.status(204).send()
}

export async function exportClients(req: AuthRequest, res: Response) {
  const { search, rep_id } = req.query
  const isAdmin = req.user!.role === 'admin'

  let sql = `
    SELECT c.name, c.trade_name, c.cnpj, c.cpf, c.state_registration,
           c.address, c.city, c.state, c.zip, c.phone, c.whatsapp,
           c.email, c.notes, u.name AS rep_name,
           COUNT(DISTINCT o.id)::int AS total_pedidos,
           COALESCE(SUM(o.total_value), 0)::numeric AS total_comprado
    FROM clients c
    LEFT JOIN users u ON u.id = c.rep_id
    LEFT JOIN orders o ON o.client_id = c.id AND o.deleted_at IS NULL
    WHERE c.active = true
  `
  const params: unknown[] = []

  if (!isAdmin) {
    params.push(req.user!.id)
    sql += ` AND c.rep_id = $${params.length}`
  } else if (rep_id) {
    params.push(rep_id)
    sql += ` AND c.rep_id = $${params.length}`
  }

  if (search) {
    params.push(`%${search}%`)
    const idx = params.length
    sql += ` AND (c.name ILIKE $${idx} OR c.trade_name ILIKE $${idx} OR
      c.cnpj ILIKE $${idx} OR c.cpf ILIKE $${idx} OR c.city ILIKE $${idx})`
  }

  sql += ' GROUP BY c.id, u.name ORDER BY c.name'
  const { rows } = await query(sql, params)

  // ── Monta a planilha ──
  const data = rows.map(r => ({
    'Razão Social':        r.name             || '',
    'Nome Fantasia':       r.trade_name        || '',
    'CNPJ':                r.cnpj              || '',
    'CPF':                 r.cpf               || '',
    'Insc. Estadual':      r.state_registration|| '',
    'Endereço':            r.address           || '',
    'Cidade':              r.city              || '',
    'UF':                  r.state             || '',
    'CEP':                 r.zip               || '',
    'Telefone':            r.phone             || '',
    'WhatsApp':            r.whatsapp          || '',
    'E-mail':              r.email             || '',
    'Representante':       r.rep_name          || '',
    'Total de Pedidos':    r.total_pedidos,
    'Total Comprado (R$)': Number(r.total_comprado).toFixed(2),
    'Notas':               r.notes             || '',
  }))

  const ws = XLSX.utils.json_to_sheet(data)

  // Larguras das colunas
  ws['!cols'] = [
    { wch: 35 }, // Razão Social
    { wch: 25 }, // Nome Fantasia
    { wch: 18 }, // CNPJ
    { wch: 14 }, // CPF
    { wch: 18 }, // Insc. Estadual
    { wch: 35 }, // Endereço
    { wch: 20 }, // Cidade
    { wch: 5  }, // UF
    { wch: 10 }, // CEP
    { wch: 15 }, // Telefone
    { wch: 15 }, // WhatsApp
    { wch: 28 }, // E-mail
    { wch: 20 }, // Representante
    { wch: 14 }, // Total Pedidos
    { wch: 18 }, // Total Comprado
    { wch: 30 }, // Notas
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const today = new Date().toISOString().split('T')[0]

  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="clientes-${today}.xlsx"`,
  })
  res.send(buf)
}

export async function updateClient(req: AuthRequest, res: Response) {
  const { name, trade_name, cnpj, cpf, state_registration, address, city, state, zip, phone, whatsapp, email, rep_id, notes, active, buyer_name } = req.body
  const { rows: [existing] } = await query('SELECT rep_id FROM clients WHERE id=$1', [req.params.id])
  if (!existing) { res.status(404).json({ error: 'Cliente não encontrado' }); return }
  const isAdmin = req.user!.role === 'admin'
  const assignedRep = isAdmin ? (rep_id || existing.rep_id) : existing.rep_id
  const { rows } = await query(
    `UPDATE clients SET name=$1, trade_name=$2, cnpj=$3, cpf=$4, state_registration=$5, address=$6, city=$7,
     state=$8, zip=$9, phone=$10, whatsapp=$11, email=$12, rep_id=$13, notes=$14, active=$15, buyer_name=$16, updated_at=NOW()
     WHERE id=$17 RETURNING *`,
    [name, trade_name||null, cnpj||null, cpf||null, state_registration||null, address||null, city||null,
     state||null, zip||null, phone||null, whatsapp||null, email||null, assignedRep, notes||null, active??true, buyer_name||null, req.params.id]
  )
  res.json(rows[0])
}
