/**
 * fixPkteGrades.ts
 * One-time script: sets type='pack' and correct grade_configs for PKTE products.
 * Run: npx ts-node -r tsconfig-paths/register src/scripts/fixPkteGrades.ts
 */
import { pool, query } from '../config/database'
import dotenv from 'dotenv'
dotenv.config()

interface GradeRow {
  color: string
  sizes: Record<string, number>
}

interface PackDef {
  reference: string
  grades: GradeRow[]
}

const PACKS: PackDef[] = [
  {
    reference: 'PKTE11375',
    grades: [
      { color: 'AREIA',  sizes: { '36': 0, '38': 1, '40': 1, '42': 1, '44': 1, '46': 1, '48': 0 } },
      { color: 'KAKI',   sizes: { '36': 1, '38': 1, '40': 1, '42': 2, '44': 2, '46': 1, '48': 1 } },
      { color: 'PRETO',  sizes: { '36': 1, '38': 1, '40': 2, '42': 2, '44': 2, '46': 1, '48': 1 } },
    ],
  },
  {
    reference: 'PKTE11351',
    grades: [
      { color: 'PRETO',        sizes: { 'P': 1, 'M': 2, 'G': 2, 'GG': 2, 'XG': 1 } },
      { color: 'BRANCO',       sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
      { color: 'VERDE ESCURO', sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
      { color: 'MARINHO',      sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
      { color: 'NATURAL',      sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
    ],
  },
  {
    reference: 'PKTE11356',
    grades: [
      { color: 'PRETO',       sizes: { 'P': 1, 'M': 2, 'G': 2, 'GG': 2, 'XG': 1 } },
      { color: 'AVEIA',       sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
      { color: 'AZUL JEANS',  sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
      { color: 'ROSA',        sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
      { color: 'CINZA MÉDIO', sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
    ],
  },
  {
    reference: 'PKTE11364',
    grades: [
      { color: 'PRETO',       sizes: { 'P': 1, 'M': 2, 'G': 2, 'GG': 2, 'XG': 1 } },
      { color: 'BRANCO',      sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
      { color: 'ROSA',        sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
      { color: 'MESCLA CINZA',sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
      { color: 'MARINHO',     sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
    ],
  },
  {
    reference: 'PKTE11365',
    grades: [
      { color: 'PRETO',        sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 1 } },
      { color: 'AVEIA',        sizes: { 'P': 0, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
      { color: 'AZUL CLARO',   sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
      { color: 'VERDE CLARO',  sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
      { color: 'MARROM',       sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
      { color: 'MESCLA PRETO', sizes: { 'P': 1, 'M': 1, 'G': 1, 'GG': 1, 'XG': 0 } },
    ],
  },
  {
    reference: 'PKTE25685',
    grades: [
      { color: 'PRETO',   sizes: { 'P': 1, 'M': 1, 'G': 2, 'GG': 2, 'XG': 0 } },
      { color: 'MARINHO', sizes: { 'P': 1, 'M': 1, 'G': 2, 'GG': 2, 'XG': 0 } },
    ],
  },
  {
    reference: 'PKTE25681',
    grades: [
      { color: 'PRETO',     sizes: { 'P': 1, 'M': 1, 'G': 2, 'GG': 2, 'XG': 0 } },
      { color: 'OFF WHITE', sizes: { 'P': 1, 'M': 1, 'G': 2, 'GG': 2, 'XG': 0 } },
    ],
  },
]

async function run() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const pack of PACKS) {
      // Find all products with this reference (may exist in multiple price tables)
      const { rows: products } = await client.query(
        `SELECT id, reference FROM products WHERE reference = $1`,
        [pack.reference]
      )

      if (products.length === 0) {
        console.log(`⚠️  ${pack.reference} — não encontrado no banco`)
        continue
      }

      for (const product of products) {
        // 1. Set type = 'pack'
        await client.query(
          `UPDATE products SET type = 'pack', updated_at = NOW() WHERE id = $1`,
          [product.id]
        )

        // 2. Delete existing grade_configs
        await client.query(`DELETE FROM grade_configs WHERE product_id = $1`, [product.id])

        // 3. Insert new grade_configs
        for (let i = 0; i < pack.grades.length; i++) {
          const gc = pack.grades[i]
          const total = Object.values(gc.sizes).reduce((s, v) => s + v, 0)
          await client.query(
            `INSERT INTO grade_configs (product_id, color, sizes, total_pieces, sort_order)
             VALUES ($1, $2, $3, $4, $5)`,
            [product.id, gc.color, JSON.stringify(gc.sizes), total, i]
          )
        }

        const totalPerBox = pack.grades.reduce(
          (s, gc) => s + Object.values(gc.sizes).reduce((a, b) => a + b, 0), 0
        )
        console.log(`✅  ${pack.reference} (id: ${product.id}) → pack, ${pack.grades.length} cores, ${totalPerBox} pç/cx`)
      }
    }

    await client.query('COMMIT')
    console.log('\n✅ Concluído com sucesso!')

    // ── Corrige subtotais de pedidos PKTE em transação separada ─────────────
    // Feito fora do bloco principal para não arriscar o startup se falhar
    console.log('\n🔧 Corrigindo subtotais dos pedidos PKTE existentes…')
    try {
      await client.query('BEGIN')

      // 1. Busca IDs dos produtos com type='pack'
      const { rows: packProducts } = await client.query(
        `SELECT id FROM products WHERE type = 'pack'`
      )
      if (packProducts.length > 0) {
        const packIds = packProducts.map((p: { id: string }) => p.id)

        // 2. Atualiza subtotal: unit_price × boxes_count (preço da caixa × qtd caixas)
        const { rowCount: itemsFixed } = await client.query(
          `UPDATE order_items oi
           SET subtotal = oi.unit_price * (1 - o.discount_pct / 100.0) * oi.boxes_count
           FROM orders o
           WHERE oi.order_id = o.id
             AND oi.product_id = ANY($1)
             AND oi.boxes_count > 0
             AND ABS(oi.subtotal - oi.unit_price * (1 - o.discount_pct / 100.0) * oi.boxes_count) > 0.01`,
          [packIds]
        )
        console.log(`   ${itemsFixed ?? 0} order_items corrigidos`)

        // 3. Recalcula total_value dos pedidos afetados
        const { rowCount: ordersFixed } = await client.query(
          `UPDATE orders o
           SET total_value = sub.tv, updated_at = NOW()
           FROM (
             SELECT order_id, SUM(subtotal) AS tv
             FROM order_items
             GROUP BY order_id
           ) sub
           WHERE o.id = sub.order_id
             AND ABS(o.total_value - sub.tv) > 0.01`
        )
        console.log(`   ${ordersFixed ?? 0} pedidos com total_value corrigido`)
      } else {
        console.log('   Nenhum produto pack encontrado ainda')
      }

      await client.query('COMMIT')
    } catch (fixErr) {
      await client.query('ROLLBACK')
      console.warn('⚠️  Correção de subtotais falhou (não crítico):', fixErr)
    }
  } catch (err) {
    try { await client.query('ROLLBACK') } catch (_) { /* ignora */ }
    console.error('❌ Erro no fixPkteGrades (não crítico para o servidor):', err)
    // NÃO chama process.exit(1) — erro aqui não deve impedir o servidor de subir
  } finally {
    try { client.release() } catch (_) { /* ignora */ }
    try { await pool.end() } catch (_) { /* ignora */ }
  }
}

run().catch(err => {
  console.error('❌ fixPkteGrades falhou:', err)
  // Sai normalmente (código 0) para não bloquear o startup do servidor
  process.exit(0)
})
