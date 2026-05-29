import { Request, Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'
import { uploadToR2, isR2Configured } from '../utils/r2'

// Retorna todas as configurações como objeto chave→valor
export async function getSettings(_req: Request, res: Response) {
  const { rows } = await query('SELECT key, value FROM company_settings ORDER BY key')
  const settings: Record<string, string> = {}
  for (const r of rows) settings[r.key] = r.value || ''

  // Auto-migra logo_url local (/uploads/...) para URL R2 se R2 estiver configurado
  if (settings.logo_url && settings.logo_url.startsWith('/uploads/') && isR2Configured()) {
    const publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')
    const filename = settings.logo_url.split('/').pop() // ex: 'company-logo.png'
    const r2LogoUrl = `${publicUrl}/logos/${filename}`
    settings.logo_url = r2LogoUrl
    // Atualiza o banco para não precisar converter novamente
    await query(
      `UPDATE company_settings SET value=$1, updated_at=NOW() WHERE key='logo_url'`,
      [r2LogoUrl]
    ).catch(() => { /* ignora erro de atualização */ })
  }

  res.json(settings)
}

// Atualiza múltiplas chaves de uma vez
export async function updateSettings(req: AuthRequest, res: Response) {
  const updates = req.body as Record<string, string>
  const allowed = [
    'name','trade_name','cnpj','address','city','state','zip',
    'phone','whatsapp','email','website','order_footer',
  ]
  try {
    for (const [key, value] of Object.entries(updates)) {
      if (!allowed.includes(key)) continue
      await query(
        `INSERT INTO company_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
        [key, value ?? '']
      )
    }
    const { rows } = await query('SELECT key, value FROM company_settings ORDER BY key')
    const settings: Record<string, string> = {}
    for (const r of rows) settings[r.key] = r.value || ''
    res.json(settings)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao salvar configurações' })
  }
}

// Remove o logo da empresa
export async function deleteLogo(_req: AuthRequest, res: Response) {
  try {
    await query(`DELETE FROM company_settings WHERE key = 'logo_url'`)
    res.json({ ok: true })
  } catch (err) {
    console.error('Erro ao remover logo:', err)
    res.status(500).json({ error: 'Erro ao remover logo' })
  }
}

// Upload do logo da empresa
export async function uploadLogo(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }
  try {
    let logoUrl: string
    if (isR2Configured()) {
      // Usa nome fixo para sobrescrever logo anterior no R2
      const ext = req.file.originalname.split('.').pop() || 'png'
      logoUrl = await uploadToR2(req.file.buffer, req.file.originalname, 'logos', `company-logo.${ext}`)
    } else {
      // Fallback: salva localmente
      const path = await import('path')
      const fs = await import('fs')
      const ext = path.extname(req.file.originalname)
      const dest = path.join(__dirname, '../../..', 'uploads', 'logos', `company-logo${ext}`)
      fs.writeFileSync(dest, req.file.buffer)
      logoUrl = `/uploads/logos/company-logo${ext}`
    }
    await query(
      `INSERT INTO company_settings (key, value) VALUES ('logo_url', $1)
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [logoUrl]
    )
    res.json({ logo_url: logoUrl })
  } catch (err) {
    console.error('Erro upload logo:', err)
    res.status(500).json({ error: 'Erro ao salvar logo' })
  }
}
