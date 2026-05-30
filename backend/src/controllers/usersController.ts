import { Response } from 'express'
import bcrypt from 'bcryptjs'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

export async function listUsers(req: AuthRequest, res: Response) {
  const { rows } = await query(`
    SELECT u.id, u.name, u.email, u.role, u.active, u.created_at,
      COALESCE(
        array_agg(ufa.factory_id ORDER BY ufa.factory_id) FILTER (WHERE ufa.factory_id IS NOT NULL),
        '{}'
      ) AS factory_ids
    FROM users u
    LEFT JOIN user_factory_access ufa ON ufa.user_id = u.id
    GROUP BY u.id
    ORDER BY u.name
  `)
  res.json(rows)
}

export async function createUser(req: AuthRequest, res: Response) {
  const { name, email, password, role, factory_ids } = req.body
  if (!name || !email || !password || !role) {
    res.status(400).json({ error: 'Todos os campos são obrigatórios' })
    return
  }
  if (!['admin', 'representante'].includes(role)) {
    res.status(400).json({ error: 'Role inválida' })
    return
  }
  try {
    const hash = await bcrypt.hash(password, 10)
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash, role, active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, name, email, role, active, created_at`,
      [name, email.toLowerCase().trim(), hash, role]
    )
    const user = rows[0]
    // Salva acesso a fábricas
    if (Array.isArray(factory_ids) && factory_ids.length > 0) {
      for (const fid of factory_ids) {
        await query(
          'INSERT INTO user_factory_access (user_id, factory_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [user.id, fid]
        )
      }
    }
    user.factory_ids = Array.isArray(factory_ids) ? factory_ids : []
    res.status(201).json(user)
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(400).json({ error: 'E-mail já cadastrado' })
      return
    }
    res.status(500).json({ error: 'Erro interno' })
  }
}

export async function updateUser(req: AuthRequest, res: Response) {
  const { id } = req.params
  const { name, email, role, active, password, factory_ids } = req.body
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10)
      await query(
        'UPDATE users SET name=$1, email=$2, role=$3, active=$4, password_hash=$5, updated_at=NOW() WHERE id=$6',
        [name, email, role, active, hash, id]
      )
    } else {
      await query(
        'UPDATE users SET name=$1, email=$2, role=$3, active=$4, updated_at=NOW() WHERE id=$5',
        [name, email, role, active, id]
      )
    }
    // Atualiza acesso a fábricas se fornecido
    if (Array.isArray(factory_ids)) {
      await query('DELETE FROM user_factory_access WHERE user_id=$1', [id])
      for (const fid of factory_ids) {
        await query(
          'INSERT INTO user_factory_access (user_id, factory_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, fid]
        )
      }
    }
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.role, u.active,
        COALESCE(
          array_agg(ufa.factory_id ORDER BY ufa.factory_id) FILTER (WHERE ufa.factory_id IS NOT NULL),
          '{}'
        ) AS factory_ids
       FROM users u
       LEFT JOIN user_factory_access ufa ON ufa.user_id = u.id
       WHERE u.id=$1
       GROUP BY u.id`,
      [id]
    )
    res.json(rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' })
  }
}

export async function deleteUser(req: AuthRequest, res: Response) {
  const { id } = req.params
  if (id === req.user!.id) {
    res.status(400).json({ error: 'Não é possível excluir o próprio usuário' })
    return
  }
  try {
    // Verifica se o usuário tem pedidos vinculados
    const { rows: orderCheck } = await query(
      'SELECT 1 FROM orders WHERE rep_id=$1 LIMIT 1',
      [id]
    )
    if (orderCheck.length > 0) {
      res.status(400).json({ error: 'Usuário possui pedidos e não pode ser excluído. Desative-o em vez de excluir.' })
      return
    }
    await query('DELETE FROM user_factory_access WHERE user_id=$1', [id])
    await query('DELETE FROM users WHERE id=$1', [id])
    res.json({ message: 'Usuário excluído' })
  } catch {
    res.status(500).json({ error: 'Erro interno' })
  }
}
