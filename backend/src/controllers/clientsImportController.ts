import { Response } from 'express'
import { query, pool } from '../config/database'
import { AuthRequest } from '../middleware/auth'
import { previewClientsExcel, importClientsExcel } from '../services/import/clientsImporter'

// Passo 1: faz upload e retorna preview + mapeamento detectado
export async function previewImport(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }
  try {
    const preview = previewClientsExcel(req.file.buffer ?? req.file.path)
    res.json(preview)
  } catch (err) {
    console.error(err)
    res.status(400).json({ error: 'Erro ao ler arquivo. Verifique se é um Excel válido.' })
  }
}

// Passo 2: confirma importação com mapeamento (pode ser ajustado pelo usuário)
export async function confirmImport(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }

  let mapping: Record<string, string>
  try {
    mapping = typeof req.body.mapping === 'string'
      ? JSON.parse(req.body.mapping)
      : req.body.mapping
  } catch {
    res.status(400).json({ error: 'Mapeamento inválido' }); return
  }

  const rep_id = req.user!.id
  const clients = importClientsExcel(req.file.buffer ?? req.file.path, mapping)

  if (!clients.length) {
    res.status(400).json({ error: 'Nenhum cliente encontrado no arquivo' }); return
  }

  const dbClient = await pool.connect()
  let imported = 0
  let skipped  = 0
  const errors: string[] = []

  try {
    await dbClient.query('BEGIN')

    for (const c of clients) {
      try {
        // Se já existir pelo CNPJ: atualiza os dados (inclusive state_registration)
        if (c.cnpj) {
          const { rows } = await dbClient.query(
            'SELECT id FROM clients WHERE cnpj=$1 AND active=true LIMIT 1',
            [c.cnpj]
          )
          if (rows[0]) {
            await dbClient.query(
              `UPDATE clients SET
                 name=$1, trade_name=$2, state_registration=$3,
                 phone=$4, whatsapp=$5, email=$6,
                 address=$7, city=$8, state=$9, zip=$10,
                 updated_at=NOW()
               WHERE id=$11`,
              [
                c.name, c.trade_name||null, c.state_registration||null,
                c.phone||null, c.whatsapp||null, c.email||null,
                c.address||null, c.city||null, c.state||null, c.zip||null,
                rows[0].id,
              ]
            )
            skipped++  // conta como "atualizado" — não duplicou
            continue
          }
        }

        await dbClient.query(
          `INSERT INTO clients
           (name, trade_name, cnpj, cpf, state_registration, phone, whatsapp, email, address, city, state, zip, notes, rep_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            c.name, c.trade_name||null, c.cnpj||null, c.cpf||null,
            c.state_registration||null,
            c.phone||null, c.whatsapp||null, c.email||null,
            c.address||null, c.city||null, c.state||null,
            c.zip||null, c.notes||null, rep_id,
          ]
        )
        imported++
      } catch (err: any) {
        errors.push(`${c.name}: ${err.message}`)
      }
    }

    await dbClient.query('COMMIT')
    res.json({ imported, updated: skipped, skipped: 0, errors: errors.slice(0, 20), total: clients.length })
  } catch (err) {
    await dbClient.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Erro ao importar clientes' })
  } finally {
    dbClient.release()
  }
}
