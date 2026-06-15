/**
 * fixGradeZZ70756.ts
 *
 * Corrige os grade_configs das referências ZZ70756P, ZZ70757P, ZZ70758P.
 * Problema: grade_configs contém todos os tamanhos (P,M,G,GG,48... G1,G2,G3)
 * em vez de apenas G1, G2, G3.
 * Solução: apaga os grade_configs errados e recria com apenas G1, G2, G3.
 *
 * Rodar: npm run fix:grade-zz70756
 */

import { pool } from '../config/database'
import dotenv from 'dotenv'
dotenv.config()

const REFERENCES = ['ZZ70756P', 'ZZ70757P', 'ZZ70758P']
const CORRECT_SIZES = { 'G1': 1, 'G2': 1, 'G3': 1 }
const TOTAL_PIECES = 3

async function fix() {
  const client = await pool.connect()
  try {
    console.log('🔧 Corrigindo grade_configs de ZZ70756P / ZZ70757P / ZZ70758P...\n')

    for (const ref of REFERENCES) {
      // 1. Buscar o produto
      const { rows: products } = await client.query(
        `SELECT p.id, p.reference, p.size_range
         FROM products p
         WHERE p.reference = $1 AND p.active = true
         LIMIT 10`,
        [ref]
      )

      if (products.length === 0) {
        console.log(`  ⚠️  ${ref}: não encontrado`)
        continue
      }

      for (const product of products) {
        // 2. Verificar grade_configs atual
        const { rows: existing } = await client.query(
          `SELECT id, sizes FROM grade_configs WHERE product_id = $1`,
          [product.id]
        )

        console.log(`  📋 ${ref} (id: ${product.id})`)
        console.log(`     size_range atual: ${product.size_range}`)
        console.log(`     grade_configs atual (${existing.length} linhas):`)
        existing.forEach(g => console.log(`       sizes: ${JSON.stringify(g.sizes)}`))

        // 3. Apagar grade_configs errados
        await client.query(
          `DELETE FROM grade_configs WHERE product_id = $1`,
          [product.id]
        )

        // 4. Criar grade_config correta: apenas G1, G2, G3
        await client.query(
          `INSERT INTO grade_configs (product_id, color, sizes, total_pieces, sort_order)
           VALUES ($1, NULL, $2::jsonb, $3, 0)`,
          [product.id, JSON.stringify(CORRECT_SIZES), TOTAL_PIECES]
        )

        // 5. Garantir size_range correto
        await client.query(
          `UPDATE products SET size_range = 'G1,G2,G3', updated_at = NOW() WHERE id = $1`,
          [product.id]
        )

        console.log(`     ✅ grade_config atualizado para: ${JSON.stringify(CORRECT_SIZES)}`)
        console.log(`     ✅ size_range = 'G1,G2,G3'\n`)
      }
    }

    console.log('✅ Correção concluída!')
    console.log('   As referências ZZ70756P, ZZ70757P, ZZ70758P agora mostram apenas G1, G2, G3.')

  } catch (err) {
    console.error('❌ Erro:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

fix()
