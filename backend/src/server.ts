import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import multer from 'multer'
import routes from './routes'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const isProd = process.env.NODE_ENV === 'production'

// CORS — em produção o frontend está no mesmo servidor
app.use(cors({
  origin: isProd ? false : (process.env.FRONTEND_URL || 'http://localhost:5174'),
  credentials: true,
}))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Uploads estáticos
app.use('/uploads', express.static(path.join(__dirname, '../..', 'uploads')))

// API
app.use('/api', routes)

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date() }))

// Storage diagnostic (sem autenticação para diagnóstico rápido)
app.get('/api/debug/storage', async (_, res) => {
  const { isR2Configured } = await import('./utils/r2')
  const { query } = await import('./config/database')
  const r2ok = isR2Configured()
  const logoRow = await query("SELECT value FROM company_settings WHERE key='logo_url'")
  const imgRow  = await query("SELECT image_url FROM products WHERE image_url IS NOT NULL LIMIT 3")
  res.json({
    r2_configured: r2ok,
    env: {
      R2_ACCOUNT_ID:     process.env.R2_ACCOUNT_ID     ? '✅ set' : '❌ missing',
      R2_ACCESS_KEY_ID:  process.env.R2_ACCESS_KEY_ID  ? '✅ set' : '❌ missing',
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ? '✅ set' : '❌ missing',
      R2_BUCKET_NAME:    process.env.R2_BUCKET_NAME    ? '✅ set' : '❌ missing',
      R2_PUBLIC_URL:     process.env.R2_PUBLIC_URL     || '❌ missing',
    },
    logo_url: logoRow.rows[0]?.value || null,
    sample_image_urls: imgRow.rows.map((r: { image_url: string }) => r.image_url),
  })
})

// Em produção, serve o frontend buildado (arquivo gerado em frontend/dist)
if (isProd) {
  const frontendDist = path.join(__dirname, '../../frontend/dist')
  app.use(express.static(frontendDist))
  // SPA fallback — todas as rotas não-API retornam index.html
  app.get('*', (_, res) => res.sendFile(path.join(frontendDist, 'index.html')))
}

// Tratador de erros do Multer (arquivo muito grande, tipo inválido, etc.)
// Deve vir DEPOIS das rotas para capturar erros propagados via next(err)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `Arquivo muito grande. Limite: ${process.env.MAX_FILE_SIZE_MB || 50}MB` })
      return
    }
    res.status(400).json({ error: `Erro no upload: ${err.message}` })
    return
  }
  // Erros genéricos
  console.error('Erro não tratado:', err)
  res.status(500).json({ error: 'Erro interno do servidor' })
})

// Proteção contra crashes por exceções não capturadas
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason)
})

app.listen(PORT, () => {
  console.log(`🚀 Somma Pedidos rodando em http://localhost:${PORT}`)
  if (isProd) console.log('📦 Servindo frontend buildado')
})

export default app
