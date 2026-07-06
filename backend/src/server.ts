import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import multer from 'multer'
import routes from './routes'
import { fixAllCommissionPcts, fixCommissions } from './scripts/fixCommissions'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const isProd = process.env.NODE_ENV === 'production'

// CORS — em produção o frontend está no mesmo servidor
app.use(cors({
  origin: isProd ? false : true, // em dev aceita qualquer origem (localhost e IPs de rede local)
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
  // Assets com hash no nome (JS/CSS/imagens) → cache de 1 ano
  // index.html → nunca cachear, para PWA/home screen sempre buscar versão nova
  app.use(express.static(frontendDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
        res.setHeader('Pragma', 'no-cache')
        res.setHeader('Expires', '0')
      }
    }
  }))
  // SPA fallback — todas as rotas não-API retornam index.html
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
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

// Migration automática: remove restrição UNIQUE(price_table_id, reference) para permitir
// que a mesma referência exista em múltiplas tabelas de preço e quantas vezes for necessário.
async function runStartupMigrations() {
  // Cada migration roda isolada para não bloquear as demais em caso de erro
  const { query } = await import('./config/database')
  const safe = async (sql: string) => {
    try { await query(sql) } catch { /* coluna/constraint já existe ou não aplicável */ }
  }

  await safe('ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_table_id_reference_key')
  await safe('ALTER TABLE price_tables ADD COLUMN IF NOT EXISTS max_cash_discount_pct NUMERIC(5,2) DEFAULT NULL')
  await safe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS needs_review_discount BOOLEAN DEFAULT FALSE')
  await safe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_discount_pct NUMERIC(5,2) DEFAULT NULL')
  await safe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_manual_override BOOLEAN DEFAULT FALSE')
  await safe('UPDATE orders SET commission_manual_override = FALSE WHERE commission_manual_override IS NULL')
  // Colunas que podem não existir em instâncias antigas
  await safe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS industry_order_number VARCHAR(100)')
  await safe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_name VARCHAR(200)')
  await safe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS transportadora VARCHAR(200)')
  await safe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date DATE')
  await safe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ')
  await safe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(200)')
  // price_table_id pode ser NOT NULL em instâncias antigas — importação histórica não tem tabela de preço
  await safe('ALTER TABLE orders ALTER COLUMN price_table_id DROP NOT NULL')
  // Admin principal
  await safe(`UPDATE users SET name = 'SOMMA - Uliano Spèrandio' WHERE email = 'somma.uliano@hotmail.com' AND name != 'SOMMA - Uliano Spèrandio'`)
  await safe(`DELETE FROM users WHERE email IN ('admin2@somma.com.br', 'admin3@somma.com.br')`)
  console.log('✅ Migrations de startup concluídas')
}

app.listen(PORT, async () => {
  await runStartupMigrations()
  // 1. Recalcula percentuais a partir das regras de comissão (corrige PCT zerado)
  try {
    await fixAllCommissionPcts()
  } catch (err) {
    console.warn('⚠️  fixAllCommissionPcts falhou (não crítico):', err)
  }
  // 2. Garante que os valores estejam sincronizados com os percentuais
  try {
    await fixCommissions()
  } catch (err) {
    console.warn('⚠️  fixCommissions falhou (não crítico):', err)
  }
  console.log(`🚀 Somma Pedidos rodando em http://localhost:${PORT}`)
  if (isProd) console.log('📦 Servindo frontend buildado')
})

export default app
