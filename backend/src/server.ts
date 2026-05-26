import express from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
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

// Em produção, serve o frontend buildado (arquivo gerado em frontend/dist)
if (isProd) {
  const frontendDist = path.join(__dirname, '../../frontend/dist')
  app.use(express.static(frontendDist))
  // SPA fallback — todas as rotas não-API retornam index.html
  app.get('*', (_, res) => res.sendFile(path.join(frontendDist, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`🚀 Somma Pedidos rodando em http://localhost:${PORT}`)
  if (isProd) console.log('📦 Servindo frontend buildado')
})

export default app
