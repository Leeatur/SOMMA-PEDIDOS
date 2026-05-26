import bcrypt from 'bcryptjs'
import { pool } from '../config/database'
import dotenv from 'dotenv'

dotenv.config()

async function seed() {
  const client = await pool.connect()
  try {
    console.log('🌱 Verificando dados iniciais...')

    // Admin padrão — idempotente via ON CONFLICT (email)
    const hash = await bcrypt.hash('somma@2026', 10)
    await client.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES
        ('Administrador', 'admin@somma.com.br', $1, 'admin'),
        ('Admin 2',       'admin2@somma.com.br', $1, 'admin'),
        ('Admin 3',       'admin3@somma.com.br', $1, 'admin')
      ON CONFLICT (email) DO NOTHING
    `, [hash])

    // Status padrão — só insere se a tabela estiver vazia
    const { rows: [{ count }] } = await client.query(
      'SELECT COUNT(*) FROM order_statuses'
    )
    if (parseInt(count) === 0) {
      await client.query(`
        INSERT INTO order_statuses (name, color, sort_order, is_initial, is_final)
        VALUES
          ('Aguardando Conferência', '#F59E0B', 1, true,  false),
          ('Em Digitação',          '#3B82F6', 2, false, false),
          ('Enviado à Fábrica',     '#8B5CF6', 3, false, false),
          ('Confirmado',            '#10B981', 4, false, false),
          ('Em Produção',           '#06B6D4', 5, false, false),
          ('Faturado',              '#6366F1', 6, false, false),
          ('Entregue',              '#22C55E', 7, false, true),
          ('Cancelado',             '#EF4444', 8, false, true)
      `)
      console.log('   ✅ Status padrão criados')
    }

    console.log('✅ Seed concluído!')
    console.log('   📧 Login: admin@somma.com.br')
    console.log('   🔑 Senha: somma@2026')
  } catch (err) {
    console.error('❌ Erro no seed:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

seed()
