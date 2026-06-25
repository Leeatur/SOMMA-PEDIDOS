import bcrypt from 'bcryptjs'
import { pool } from '../config/database'
import dotenv from 'dotenv'

dotenv.config()

async function seed() {
  const client = await pool.connect()
  try {
    console.log('🌱 Verificando dados iniciais...')

    const hash = await bcrypt.hash('somma@2026', 10)
    // Admin PRINCIPAL — garantido a cada deploy (anti-lockout: nunca trava o acesso)
    await client.query(`
      INSERT INTO users (name, email, password_hash, role, active)
      VALUES ('Uliano', 'somma.uliano@hotmail.com', $1, 'admin', true)
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash, active = true, updated_at = NOW()
    `, [hash])

    // Admin 2 / Admin 3 — só na PRIMEIRA configuração (tabela só com o principal).
    // Assim, se forem excluídos depois, NÃO voltam a cada boot.
    const { rows: [{ count: userCount }] } = await client.query('SELECT COUNT(*) FROM users')
    if (parseInt(userCount) <= 1) {
      await client.query(`
        INSERT INTO users (name, email, password_hash, role, active)
        VALUES
          ('Admin 2', 'admin2@somma.com.br', $1, 'admin', true),
          ('Admin 3', 'admin3@somma.com.br', $1, 'admin', true)
        ON CONFLICT (email) DO NOTHING
      `, [hash])
    }
    console.log('   ✅ Admin principal garantido: somma.uliano@hotmail.com / somma@2026')

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
