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
  // Índices para acelerar queries críticas
  await safe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_deleted_at ON orders(deleted_at)`)
  await safe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created_at ON orders(created_at)`)
  await safe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_factory_id ON orders(factory_id)`)
  await safe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_rep_id ON orders(rep_id)`)
  await safe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_id ON orders(status_id)`)
  await safe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`)
  await safe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_reference ON order_items(reference)`)
  await safe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grade_configs_product_id ON grade_configs(product_id)`)
  await safe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_price_table_ref ON products(price_table_id, reference)`)
  await safe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_name ON clients(name)`)
  await safe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_cnpj ON clients(cnpj)`)
  // Código ERP do cliente por variante (cor/tamanho) — ex: Cusco
  await safe('ALTER TABLE products ADD COLUMN IF NOT EXISTS customer_skus JSONB DEFAULT NULL')
  // order_number pode ser NULL para pedidos importados (não consomem a sequência nativa)
  await safe(`ALTER TABLE orders ALTER COLUMN order_number DROP NOT NULL`)
  await safe(`UPDATE orders SET order_number = NULL WHERE notes LIKE 'Importado SuasVendas%' AND order_number IS NOT NULL`)
  // Renumera pedidos nativos com número alto (gap gerado pelo import SuasVendas)
  // Idempotente: se não houver order_number > 1000 em pedidos nativos, não faz nada
  await safe(`
    UPDATE orders SET order_number = sub.new_num
    FROM (
      SELECT id,
        (SELECT COALESCE(MAX(order_number), 0) FROM orders
         WHERE (notes IS NULL OR notes NOT LIKE 'Importado SuasVendas%')
           AND order_number <= 1000
        ) + CAST(ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS INTEGER) AS new_num
      FROM orders
      WHERE (notes IS NULL OR notes NOT LIKE 'Importado SuasVendas%')
        AND order_number > 1000
    ) sub
    WHERE orders.id = sub.id
  `)
  // Ajusta a sequência para continuar a partir do maior order_number atual
  await safe(`SELECT setval(pg_get_serial_sequence('orders', 'order_number'), (SELECT COALESCE(MAX(order_number), 1) FROM orders WHERE order_number IS NOT NULL))`)
  console.log('✅ Migrations de startup concluídas')
}

app.listen(PORT, async () => {
  console.log(`🚀 Somma Pedidos rodando em http://localhost:${PORT}`)
  if (isProd) console.log('📦 Servindo frontend buildado')

  // Migrations e correções rodam em background para não atrasar o primeiro request
  setImmediate(async () => {
    await runStartupMigrations()
    // Recalcula comissões apenas se necessário (scripts idempotentes)
    try { await fixAllCommissionPcts() } catch (err) {
      console.warn('⚠️  fixAllCommissionPcts falhou (não crítico):', err)
    }
    try { await fixCommissions() } catch (err) {
      console.warn('⚠️  fixCommissions falhou (não crítico):', err)
    }
  })
})

export default app
