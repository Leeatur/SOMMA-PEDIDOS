/**
 * seedDev.ts
 *
 * Seed completo para o ambiente de desenvolvimento / homologação.
 * Configura a SOMMA Technology como empresa, cria usuários admin e
 * popula dados mínimos para testes.
 *
 * Uso:
 *   npx tsx src/scripts/seedDev.ts
 *   (ou via npm run seed:dev)
 *
 * ⚠️  NUNCA rodar em produção — use seed.ts para isso.
 */

import bcrypt from 'bcryptjs'
import { pool } from '../config/database'
import dotenv from 'dotenv'

dotenv.config()

async function seedDev() {
  const client = await pool.connect()
  try {
    console.log('🌱 [DEV] Iniciando seed do ambiente de desenvolvimento...\n')

    // ── 1. Configurações da empresa ──────────────────────────────────────
    console.log('📋 Configurando empresa SOMMA Technology...')
    const companySettings: Record<string, string> = {
      name:         'SOMMA Technology',
      trade_name:   'SOMMA Technology',
      cnpj:         '00.000.000/0001-00',
      address:      'Rua Exemplo, 100',
      city:         'Erechim',
      state:        'RS',
      zip:          '99700-000',
      phone:        '(54) 9.9162-5024',
      whatsapp:     '5454991625024',
      email:        'contato@sommatechnology.com.br',
      website:      'https://sommatechnology.com.br',
      order_footer: 'Obrigado pela preferência! SOMMA Technology — Erechim | RS',
    }

    for (const [key, value] of Object.entries(companySettings)) {
      await client.query(
        `INSERT INTO company_settings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
      )
    }
    console.log('   ✅ Empresa configurada: SOMMA Technology — Erechim | RS\n')

    // ── 2. Usuários admin ─────────────────────────────────────────────────
    console.log('👤 Criando usuários admin...')
    const hash = await bcrypt.hash('somma@dev2026', 10)

    await client.query(`
      INSERT INTO users (name, email, password_hash, role, active)
      VALUES
        ('Uliano (Dev)',  'uliano@sommatechnology.com.br', $1, 'admin', true),
        ('Admin DEV',    'admin@dev.sommagestao.com.br',  $1, 'admin', true)
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            name          = EXCLUDED.name,
            role          = EXCLUDED.role,
            active        = true,
            updated_at    = NOW()
    `, [hash])
    console.log('   ✅ Admins criados/atualizados')
    console.log('   📧 uliano@sommatechnology.com.br / somma@dev2026')
    console.log('   📧 admin@dev.sommagestao.com.br  / somma@dev2026\n')

    // ── 3. Representante de teste ─────────────────────────────────────────
    console.log('👤 Criando representante de teste...')
    const hashRep = await bcrypt.hash('rep@dev2026', 10)
    await client.query(`
      INSERT INTO users (name, email, password_hash, role, active)
      VALUES ('Rep Teste', 'rep@dev.sommagestao.com.br', $1, 'rep', true)
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            name          = EXCLUDED.name,
            role          = EXCLUDED.role,
            active        = true,
            updated_at    = NOW()
    `, [hashRep])
    console.log('   ✅ Rep: rep@dev.sommagestao.com.br / rep@dev2026\n')

    // ── 4. Status de pedidos ──────────────────────────────────────────────
    const { rows: [{ count: statusCount }] } = await client.query('SELECT COUNT(*) FROM order_statuses')
    if (parseInt(statusCount) === 0) {
      console.log('📋 Criando status de pedidos...')
      await client.query(`
        INSERT INTO order_statuses (name, color, sort_order, is_initial, is_final) VALUES
          ('Aguardando Conferência', '#F59E0B', 1, true,  false),
          ('Em Digitação',          '#3B82F6', 2, false, false),
          ('Enviado à Fábrica',     '#8B5CF6', 3, false, false),
          ('Confirmado',            '#10B981', 4, false, false),
          ('Em Produção',           '#06B6D4', 5, false, false),
          ('Faturado',              '#6366F1', 6, false, false),
          ('Entregue',              '#22C55E', 7, false, true),
          ('Cancelado',             '#EF4444', 8, false, true)
      `)
      console.log('   ✅ Status criados\n')
    }

    // ── 5. Cliente SOMMA Technology (para testes de pedidos) ──────────────
    console.log('🏢 Criando cliente SOMMA Technology...')
    const adminUser = await client.query(
      `SELECT id FROM users WHERE email = 'uliano@sommatechnology.com.br' LIMIT 1`
    )
    const adminId = adminUser.rows[0]?.id

    if (adminId) {
      await client.query(`
        INSERT INTO clients (name, trade_name, cnpj, city, state, phone, whatsapp, email, rep_id, active)
        VALUES (
          'SOMMA Technology', 'SOMMA TECH', '00.000.000/0001-00',
          'Erechim', 'RS', '(54) 9.9162-5024', '5454991625024',
          'contato@sommatechnology.com.br', $1, true
        )
        ON CONFLICT DO NOTHING
      `, [adminId])
      console.log('   ✅ Cliente SOMMA Technology criado\n')
    }

    // ── 6. Condição de pagamento padrão ───────────────────────────────────
    const { rows: [{ count: payCount }] } = await client.query(
      `SELECT COUNT(*) FROM payment_conditions`
    ).catch(() => ({ rows: [{ count: '0' }] }))

    if (parseInt(payCount) === 0) {
      console.log('💳 Criando condições de pagamento...')
      await client.query(`
        INSERT INTO payment_conditions (name, active)
        VALUES
          ('À Vista',          true),
          ('30 dias',          true),
          ('30/60 dias',       true),
          ('30/60/90 dias',    true),
          ('28/56/84 dias',    true)
        ON CONFLICT DO NOTHING
      `).catch(() => console.log('   ⚠️  Tabela payment_conditions não existe ainda — ok'))
      console.log('   ✅ Condições de pagamento criadas\n')
    }

    console.log('═══════════════════════════════════════')
    console.log('✅ Seed DEV concluído com sucesso!')
    console.log('')
    console.log('  🌐 URL dev: https://dev.sommagestao.com.br')
    console.log('  📧 Admin:  uliano@sommatechnology.com.br')
    console.log('  🔑 Senha:  somma@dev2026')
    console.log('  📧 Rep:    rep@dev.sommagestao.com.br')
    console.log('  🔑 Senha:  rep@dev2026')
    console.log('═══════════════════════════════════════')

  } catch (err) {
    console.error('❌ Erro no seed DEV:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

seedDev()
