import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

// Railway fornece DATABASE_URL automaticamente
// Localmente usa variáveis individuais
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : new Pool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME     || 'somma_pedidos',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })

pool.on('error', (err) => {
  console.error('Erro inesperado no pool do PostgreSQL', err)
})

export { pool }
export const query = (text: string, params?: unknown[]) => pool.query(text, params)
