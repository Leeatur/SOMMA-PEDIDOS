import { Response } from 'express'
import bcrypt from 'bcryptjs'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

export async function listUsers(req: AuthRequest, res: Response) {
  const { rows } = await query(
    'SELECT id, name, email, role, active, created_at FROM users ORDER BY name'
  )
  res.json(rows)
}

export async function createUser(req: AuthRequest, res: Response) {
  const { name, email, password, role } = req.body
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
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, active, created_at`,
      [name, email.toLowerCase().trim(), hash, role]
    )
    res.status(201).json(rows[0])
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
  const { name, email, role, active, password } = req.body
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
    const { rows } = await query(
      'SELECT id, name, email, role, active FROM users WHERE id=$1', [id]
    )
    res.json(rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' })
  }
}

export async function deleteUser(req: AuthRequest, res: Response) {
  const { id } = req.params
  if (id === req.user!.id) {
    res.status(400).json({ error: 'Não é possível remover o próprio usuário' })
    return
  }
  await query('UPDATE users SET active=false WHERE id=$1', [id])
  res.json({ message: 'Usuário desativado' })
}
