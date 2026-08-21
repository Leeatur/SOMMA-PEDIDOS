/**
 * fixGradePkte11422.ts
 * One-time fix: corrige grade_configs do PKTE11422 que estava com 2x por tamanho (48 pç/cx)
 * Valor correto: 1 por tamanho por cor = 24 pç/cx
 * Run: DATABASE_URL=<prod_url> npx ts-node -r tsconfig-paths/register src/scripts/fixGradePkte11422.ts
 */
import { pool } from '../config/database'
import dotenv from 'dotenv'
dotenv.config()

const GRADE = [
  { color: 'PRETO',  sizes: { '36': 1, '38': 1, '40': 1, '42': 1, '44': 1, '46': 1, '48': 1 } }, // 7 pç
  { color: 'AREIA',  sizes: { '36': 0, '38': 1, '40': 1, '42': 1, '44': 1, '46': 1, '48': 0 } }, // 5 pç
  { color: 'CAQUI',  sizes: { '36': 1, '38': 1, '40': 1, '42': 1, '44': 1, '46': 1, '48': 1 } }, // 7 pç
  { color: 'CHUMBO', sizes: { '36': 0, '38': 1, '40': 1, '42': 1, '44': 1, '46': 1, '48': 0 } }, // 5 pç
  // Total: 24 pç/cx
]

async function run() {
  const client = await pool.connect()
  try {
    const { rows: products } = await client.query(
      `SELECT id, reference FROM products WHERE reference = $1`,
      ['PKTE11422']
    )

    if (products.length === 0) {
      console.log('⚠️  PKTE11422 — não encontrado no banco')
      return
    }

    await client.query('BEGIN')

    for (const product of products) {
      await client.query(`DELETE FROM grade_configs WHERE product_id = $1`, [product.id])

      for (let i = 0; i < GRADE.length; i++) {
        const gc = GRADE[i]
        const total = Object.values(gc.sizes).reduce((s, v) => s + v, 0)
        await client.query(
          `INSERT INTO grade_configs (product_id, color, sizes, total_pieces, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [product.id, gc.color, JSON.stringify(gc.sizes), total, i]
        )
      }

      const totalPerBox = GRADE.reduce((s, gc) => s + Object.values(gc.sizes).reduce((a, b) => a + b, 0), 0)
      console.log(`✅  PKTE11422 (id: ${product.id}) → ${GRADE.length} cores, ${totalPerBox} pç/cx`)
    }

    await client.query('COMMIT')
    console.log('\n✅ Grade corrigida com sucesso!')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('❌ Erro:', err)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
