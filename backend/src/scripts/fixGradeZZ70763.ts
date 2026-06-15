/**
 * fixGradeZZ70763.ts
 * Corrige grade_configs de ZZ70763P, ZZ70764P, ZZ70765P → apenas G1, G2, G3.
 * Rodar: npm run fix:grade-zz70763
 */
import { pool } from '../config/database'
import dotenv from 'dotenv'
dotenv.config()

const REFERENCES = ['ZZ70763P', 'ZZ70764P', 'ZZ70765P']
const CORRECT_SIZES = { 'G1': 1, 'G2': 1, 'G3': 1 }
const TOTAL_PIECES = 3

async function fix() {
  const client = await pool.connect()
  try {
    console.log('🔧 Corrigindo grade_configs de ZZ70763P / ZZ70764P / ZZ70765P...\n')

    for (const ref of REFERENCES) {
      const { rows: products } = await client.query(
        `SELECT id, reference, size_range FROM products WHERE reference = $1 AND active = true LIMIT 10`,
        [ref]
      )

      if (products.length === 0) {
        console.log(`  ⚠️  ${ref}: não encontrado`)
        continue
      }

      for (const product of products) {
        const { rows: existing } = await client.query(
          `SELECT id, sizes FROM grade_configs WHERE product_id = $1`,
          [product.id]
        )

        console.log(`  📋 ${ref} (id: ${product.id})`)
        console.log(`     grade_configs atual (${existing.length} linhas):`)
        existing.forEach(g => console.log(`       sizes: ${JSON.stringify(g.sizes)}`))

        await client.query(`DELETE FROM grade_configs WHERE product_id = $1`, [product.id])
        await client.query(
          `INSERT INTO grade_configs (product_id, color, sizes, total_pieces, sort_order)
           VALUES ($1, NULL, $2::jsonb, $3, 0)`,
          [product.id, JSON.stringify(CORRECT_SIZES), TOTAL_PIECES]
        )
        await client.query(
          `UPDATE products SET size_range = 'G1,G2,G3', updated_at = NOW() WHERE id = $1`,
          [product.id]
        )

        console.log(`     ✅ grade_config atualizado para: ${JSON.stringify(CORRECT_SIZES)}`)
        console.log(`     ✅ size_range = 'G1,G2,G3'\n`)
      }
    }

    console.log('✅ Correção concluída!')
    console.log('   ZZ70763P, ZZ70764P, ZZ70765P agora mostram apenas G1, G2, G3.')

  } catch (err) {
    console.error('❌ Erro:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

fix()
