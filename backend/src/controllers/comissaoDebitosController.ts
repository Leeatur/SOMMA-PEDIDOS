import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

// Débitos do fechamento de comissão — o bloco "RELATÓRIO DE DÉBITOS" do formulário
// da fábrica: adiantamento, amostra, devolução. Guardados por representante e
// competência (YYYY-MM) para o relatório do mês poder ser reimpresso igual depois.

const COMPETENCIA = /^\d{4}-\d{2}$/

export async function listDebitos(req: AuthRequest, res: Response) {
  const { rep_id, competencia } = req.query as { rep_id?: string; competencia?: string }
  if (!competencia || !COMPETENCIA.test(competencia)) {
    res.status(400).json({ error: 'Competência inválida (use AAAA-MM).' }); return
  }
  const params: unknown[] = [competencia]
  let cond = ''
  if (rep_id) { params.push(rep_id); cond = ` AND d.rep_id = $${params.length}::uuid` }
  const { rows } = await query(`
    SELECT d.id, d.rep_id, u.name AS rep_nome, d.competencia, d.descricao, d.valor::numeric
      FROM comissao_debitos d
      JOIN users u ON u.id = d.rep_id
     WHERE d.competencia = $1 ${cond}
     ORDER BY d.created_at
  `, params)
  res.json(rows)
}

export async function createDebito(req: AuthRequest, res: Response) {
  const { rep_id, competencia, descricao, valor } = req.body as {
    rep_id?: string; competencia?: string; descricao?: string; valor?: number
  }
  if (!rep_id || !competencia || !COMPETENCIA.test(competencia) || !descricao?.trim()) {
    res.status(400).json({ error: 'Informe representante, competência (AAAA-MM) e descrição.' }); return
  }
  const { rows } = await query(`
    INSERT INTO comissao_debitos (rep_id, competencia, descricao, valor)
    VALUES ($1::uuid, $2, $3, $4)
    RETURNING id, rep_id, competencia, descricao, valor::numeric
  `, [rep_id, competencia, descricao.trim(), Number(valor) || 0])
  res.status(201).json(rows[0])
}

export async function deleteDebito(req: AuthRequest, res: Response) {
  const { rows } = await query(
    'DELETE FROM comissao_debitos WHERE id = $1::uuid RETURNING id', [req.params.id]
  )
  if (!rows.length) { res.status(404).json({ error: 'Débito não encontrado' }); return }
  res.json({ ok: true })
}
