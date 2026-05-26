import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

function signAccess(user: { id: string; role: string; name: string }) {
  return jwt.sign(user, process.env.JWT_SECRET!, { expiresIn: '8h' })
}

function signRefresh(userId: string) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET!, { expiresIn: '7d' })
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body
  if (!email || !password) {
    res.status(400).json({ error: 'E-mail e senha obrigatórios' })
    return
  }
  try {
    const { rows } = await query(
      'SELECT id, name, email, password_hash, role, active FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    )
    const user = rows[0]
    if (!user || !user.active) {
      res.status(401).json({ error: 'Credenciais inválidas' })
      return
    }
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      res.status(401).json({ error: 'Credenciais inválidas' })
      return
    }
    const payload = { id: user.id, role: user.role, name: user.name }
    const accessToken = signAccess(payload)
    const refreshToken = signRefresh(user.id)

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    )

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro interno' })
  }
}

export async function refresh(req: Request, res: Response) {
  const { refreshToken } = req.body
  if (!refreshToken) {
    res.status(400).json({ error: 'Refresh token obrigatório' })
    return
  }
  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_SECRET!) as { id: string }
    const { rows } = await query(
      'SELECT rt.id, u.id as uid, u.name, u.role FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token = $1 AND rt.expires_at > NOW() AND u.active = true',
      [refreshToken]
    )
    if (!rows[0]) {
      res.status(401).json({ error: 'Refresh token inválido ou expirado' })
      return
    }
    const user = rows[0]
    const newAccess = signAccess({ id: user.uid, role: user.role, name: user.name })
    res.json({ accessToken: newAccess })
  } catch {
    res.status(401).json({ error: 'Refresh token inválido' })
  }
}

export async function logout(req: Request, res: Response) {
  const { refreshToken } = req.body
  if (refreshToken) {
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]).catch(() => {})
  }
  res.json({ message: 'Logout realizado' })
}

export async function me(req: AuthRequest, res: Response) {
  const { rows } = await query(
    'SELECT id, name, email, role FROM users WHERE id = $1 AND active = true',
    [req.user!.id]
  )
  if (!rows[0]) {
    res.status(404).json({ error: 'Usuário não encontrado' })
    return
  }
  res.json(rows[0])
}
