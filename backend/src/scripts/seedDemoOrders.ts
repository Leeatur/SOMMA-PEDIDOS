// Gera VENDAS SIMULADAS distribuídas pelos status configurados — para demonstração/teste.
// Rodar:  cd backend && npm run seed:demo   (ou seed:demo:prod no Railway Console)
// Idempotente: limpa os pedidos demo anteriores (clientes começando com "DEMO ") antes de recriar.
import { pool, query } from '../config/database'

// Comissão de exemplo (modo fábrica NXO): Loja 5% / Repres. 3% / Guia 2% = 10% total
const REP_PCT = 5, OFF_PCT = 3, GUIDE_PCT = 2
const DEMO_CLIENTS = [
  { name: 'DEMO Loja Estrela Jeans',  trade: 'Estrela Jeans',  city: 'São Paulo',  uf: 'SP', cnpj: '11111111000111' },
  { name: 'DEMO Boutique Aurora',     trade: 'Aurora Modas',   city: 'Campinas',   uf: 'SP', cnpj: '22222222000122' },
  { name: 'DEMO Mega Atacado Sul',    trade: 'Mega Sul',       city: 'Curitiba',   uf: 'PR', cnpj: '33333333000133' },
  { name: 'DEMO Point do Jeans',      trade: 'Point Jeans',    city: 'Goiânia',    uf: 'GO', cnpj: '44444444000144' },
]

async function main() {
  console.log('🌱 Gerando vendas simuladas...')

  const { rows: [rep] } = await query(`SELECT id FROM users WHERE active=true ORDER BY role='admin' DESC LIMIT 1`)
  if (!rep) throw new Error('Nenhum usuário ativo encontrado.')

  const { rows: [factory] } = await query(`SELECT id FROM factories WHERE active=true ORDER BY created_at LIMIT 1`)
  if (!factory) throw new Error('Nenhuma fábrica encontrada.')

  const { rows: [pt] } = await query(`SELECT id FROM price_tables WHERE active=true ORDER BY created_at DESC LIMIT 1`)
  if (!pt) throw new Error('Nenhuma tabela de preço encontrada.')

  const { rows: products } = await query(
    `SELECT id, reference, base_price FROM products WHERE price_table_id=$1 AND active=true AND base_price>0 ORDER BY reference LIMIT 8`,
    [pt.id]
  )
  if (products.length === 0) throw new Error('Nenhum produto com preço na tabela.')

  const { rows: statuses } = await query(
    `SELECT id, name FROM order_statuses WHERE active=true ORDER BY sort_order, name`
  )
  if (statuses.length === 0) throw new Error('Nenhum status configurado.')

  // Limpa demo anterior
  const { rows: oldClients } = await query(`SELECT id FROM clients WHERE name LIKE 'DEMO %'`)
  if (oldClients.length) {
    const ids = oldClients.map((c: { id: string }) => c.id)
    await query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE client_id = ANY($1))`, [ids])
    await query(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE client_id = ANY($1))`, [ids])
    await query(`DELETE FROM orders WHERE client_id = ANY($1)`, [ids])
    await query(`DELETE FROM clients WHERE id = ANY($1)`, [ids])
    console.log(`   limpou ${oldClients.length} clientes demo antigos`)
  }

  // Cria clientes demo
  const clientIds: string[] = []
  for (const c of DEMO_CLIENTS) {
    const { rows: [cli] } = await query(
      `INSERT INTO clients (name, trade_name, cnpj, city, state, phone, whatsapp, email, rep_id)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8) RETURNING id`,
      [c.name, c.trade, c.cnpj, c.city, c.uf, '(11) 90000-0000', 'contato@demo.com.br', rep.id]
    )
    clientIds.push(cli.id)
  }

  // Cria ~2 pedidos por status (distribui pelo fluxo), 1-2 itens cada
  let count = 0
  for (let i = 0; i < statuses.length * 2; i++) {
    const status = statuses[i % statuses.length]
    const client = clientIds[i % clientIds.length]
    const itemCount = 1 + (i % 2)
    const chosen = products.slice((i * 2) % products.length, ((i * 2) % products.length) + itemCount)
    const items = (chosen.length ? chosen : [products[0]]).map((p: { id: string; reference: string; base_price: number }) => {
      const pieces = 6 + (i % 4) * 6 // 6..24
      const unit = Number(p.base_price)
      return { product_id: p.id, reference: p.reference, unit_price: unit, total_pieces: pieces, subtotal: Math.round(unit * pieces * 100) / 100 }
    })
    const totalPieces = items.reduce((s, it) => s + it.total_pieces, 0)
    const totalValue = Math.round(items.reduce((s, it) => s + it.subtotal, 0) * 100) / 100
    const repV = Math.round(totalValue * REP_PCT / 100 * 100) / 100
    const offV = Math.round(totalValue * OFF_PCT / 100 * 100) / 100
    const guiV = Math.round(totalValue * GUIDE_PCT / 100 * 100) / 100
    const daysAgo = i % 25

    const { rows: [order] } = await query(
      `INSERT INTO orders
        (client_id, rep_id, factory_id, price_table_id, status_id, discount_pct,
         total_commission_pct, rep_commission_pct, office_commission_pct, guide_commission_pct,
         total_pieces, total_value, rep_commission_value, office_commission_value, guide_commission_value,
         created_at, synced_at)
       VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW() - ($15 || ' days')::interval, NOW())
       RETURNING id`,
      [client, rep.id, factory.id, pt.id, status.id,
       REP_PCT + OFF_PCT + GUIDE_PCT, REP_PCT, OFF_PCT, GUIDE_PCT,
       totalPieces, totalValue, repV, offV, guiV, String(daysAgo)]
    )
    for (const it of items) {
      await query(
        `INSERT INTO order_items (order_id, product_id, reference, boxes_count, unit_price, total_pieces, subtotal)
         VALUES ($1,$2,$3,1,$4,$5,$6)`,
        [order.id, it.product_id, it.reference, it.unit_price, it.total_pieces, it.subtotal]
      )
    }
    count++
  }

  console.log(`✅ ${count} pedidos demo criados (${clientIds.length} clientes), distribuídos em ${statuses.length} status.`)
  await pool.end()
}

main().catch(e => { console.error('❌ Erro:', e); process.exit(1) })
