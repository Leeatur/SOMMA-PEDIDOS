import { Response } from 'express'
import path from 'path'
import { query, pool } from '../config/database'
import { AuthRequest } from '../middleware/auth'
import { importExcel, buildDefaultGrade, ImportedProduct } from '../services/import/excelImporter'
import { importCatalogPdf } from '../services/import/pdfImporter'

export async function listPriceTables(req: AuthRequest, res: Response) {
  const { factory_id } = req.query
  let sql = `
    SELECT pt.*, f.name as factory_name,
      COUNT(p.id) as product_count
    FROM price_tables pt
    JOIN factories f ON f.id = pt.factory_id
    LEFT JOIN products p ON p.price_table_id = pt.id
    WHERE pt.active = true
  `
  const params: unknown[] = []
  if (factory_id) { sql += ` AND pt.factory_id = $1`; params.push(factory_id) }
  sql += ' GROUP BY pt.id, f.name ORDER BY pt.created_at DESC'
  const { rows } = await query(sql, params)
  res.json(rows)
}

export async function getPriceTable(req: AuthRequest, res: Response) {
  const { rows } = await query(
    `SELECT pt.*, f.name as factory_name FROM price_tables pt
     JOIN factories f ON f.id = pt.factory_id WHERE pt.id=$1`, [req.params.id]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Tabela não encontrada' }); return }

  const { rows: rules } = await query(
    'SELECT * FROM discount_commission_rules WHERE price_table_id=$1 ORDER BY discount_pct',
    [req.params.id]
  )
  res.json({ ...rows[0], discount_rules: rules })
}

// Preview do Excel antes de confirmar importação
export async function previewExcelImport(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }
  try {
    const result = importExcel(req.file.path)
    res.json({
      tableName: result.tableName,
      totalProducts: result.products.length,
      regularCount: result.products.filter(p => p.type === 'regular').length,
      packCount: result.products.filter(p => p.type === 'pack').length,
      discountColumns: result.discountColumns,
      sampleProducts: result.products.slice(0, 5),
    })
  } catch (err) {
    res.status(400).json({ error: 'Erro ao ler arquivo Excel' })
  }
}

// Confirma importação com metadados e regras de comissão
export async function confirmExcelImport(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }

  const { factory_id, name, collection, season, year, discount_rules } = req.body
  if (!factory_id || !name) {
    res.status(400).json({ error: 'factory_id e name são obrigatórios' }); return
  }

  let parsedRules: Array<{
    discount_pct: number; total_commission_pct: number
    rep_commission_pct: number; office_commission_pct: number
  }> = []
  try {
    parsedRules = typeof discount_rules === 'string' ? JSON.parse(discount_rules) : discount_rules || []
  } catch {
    res.status(400).json({ error: 'discount_rules inválido' }); return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: [pt] } = await client.query(
      `INSERT INTO price_tables (factory_id, name, collection, season, year, imported_at)
       VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
      [factory_id, name, collection || null, season || null, year ? parseInt(year) : null]
    )

    // Regras de desconto × comissão
    for (let i = 0; i < parsedRules.length; i++) {
      const r = parsedRules[i]
      await client.query(
        `INSERT INTO discount_commission_rules
         (price_table_id, discount_pct, total_commission_pct, rep_commission_pct, office_commission_pct, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [pt.id, r.discount_pct, r.total_commission_pct, r.rep_commission_pct, r.office_commission_pct, i]
      )
    }

    // Importa produtos
    const result = importExcel(req.file!.path)
    let inserted = 0

    for (const prod of result.products) {
      const { rows: [p] } = await client.query(
        `INSERT INTO products
         (price_table_id, reference, type, product_name, model, size_range, base_price, category, observation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (price_table_id, reference) DO UPDATE
         SET base_price=EXCLUDED.base_price, updated_at=NOW()
         RETURNING id`,
        [pt.id, prod.reference, prod.type, prod.product_name, prod.model,
         prod.size_range, prod.base_price, prod.category, prod.observation]
      )

      if (prod.type === 'pack' && prod.grade) {
        // Grade vem do Excel
        for (let i = 0; i < prod.grade.length; i++) {
          const g = prod.grade[i]
          const total = Object.values(g.sizes).reduce((a, b) => a + b, 0)
          await client.query(
            `INSERT INTO grade_configs (product_id, color, sizes, total_pieces, sort_order)
             VALUES ($1,$2,$3,$4,$5)`,
            [p.id, g.color, JSON.stringify(g.sizes), total, i]
          )
        }
      } else {
        // Grade padrão: 1 peça por tamanho
        const sizes = buildDefaultGrade(prod.size_range)
        const total = Object.keys(sizes).length
        if (total > 0) {
          await client.query(
            `INSERT INTO grade_configs (product_id, color, sizes, total_pieces)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT DO NOTHING`,
            [p.id, null, JSON.stringify(sizes), total]
          )
        }
      }
      inserted++
    }

    await client.query('COMMIT')
    res.status(201).json({
      priceTable: pt,
      inserted,
      regularCount: result.products.filter(p => p.type === 'regular').length,
      packCount: result.products.filter(p => p.type === 'pack').length,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Erro ao importar tabela' })
  } finally {
    client.release()
  }
}

// Importa catálogo PDF e associa fotos às referências
export async function importCatalog(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }
  const { price_table_id } = req.body
  if (!price_table_id) { res.status(400).json({ error: 'price_table_id obrigatório' }); return }

  // Referências da tabela de preço
  const { rows: prods } = await query(
    'SELECT reference FROM products WHERE price_table_id=$1', [price_table_id]
  )
  const tableRefs = prods.map(p => p.reference)

  const uploadDir = path.join(__dirname, '../../..', 'uploads', 'products')
  const result = await importCatalogPdf(req.file.path, uploadDir, tableRefs)

  // Atualiza image_url nos produtos encontrados
  const client = await pool.connect()
  try {
    for (const page of result.pages) {
      for (const ref of page.references) {
        if (page.imagePath) {
          await client.query(
            `UPDATE products SET image_url=$1, updated_at=NOW()
             WHERE price_table_id=$2 AND reference=$3 AND image_url IS NULL`,
            [page.imagePath, price_table_id, ref]
          )
        }
      }
    }
  } finally {
    client.release()
  }

  res.json({
    totalPages: result.totalPages,
    matched: result.matched,
    unmatched: result.unmatched,
    unmatchedCount: result.unmatched.length,
  })
}

// Upload manual de foto para uma referência
export async function uploadProductImage(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }
  const imageUrl = `/uploads/products/${req.file.filename}`
  const { rows } = await query(
    'UPDATE products SET image_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
    [imageUrl, req.params.id]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Produto não encontrado' }); return }
  res.json(rows[0])
}

export async function listProducts(req: AuthRequest, res: Response) {
  const { price_table_id, search, type } = req.query
  let sql = `
    SELECT p.*,
      pt.name as price_table_name,
      f.name as factory_name,
      json_agg(gc ORDER BY gc.sort_order) FILTER (WHERE gc.id IS NOT NULL) as grade_configs
    FROM products p
    LEFT JOIN price_tables pt ON pt.id = p.price_table_id
    LEFT JOIN factories f ON f.id = pt.factory_id
    LEFT JOIN grade_configs gc ON gc.product_id = p.id
    WHERE p.active = true
  `
  const params: unknown[] = []
  let idx = 1
  if (price_table_id) { sql += ` AND p.price_table_id = $${idx++}`; params.push(price_table_id) }
  if (type) { sql += ` AND p.type = $${idx++}`; params.push(type) }
  if (search) {
    sql += ` AND (p.reference ILIKE $${idx} OR p.product_name ILIKE $${idx} OR p.model ILIKE $${idx})`
    params.push(`%${search}%`)
    idx++
  }
  sql += ' GROUP BY p.id ORDER BY p.reference'
  const { rows } = await query(sql, params)
  res.json(rows)
}

export async function deletePriceTable(req: AuthRequest, res: Response) {
  const { id } = req.params

  // Check if any orders reference this price table
  const { rows: linked } = await query(
    'SELECT id FROM orders WHERE price_table_id = $1 LIMIT 1',
    [id]
  )
  if (linked.length > 0) {
    res.status(400).json({
      error: 'Não é possível excluir esta tabela pois ela possui pedidos vinculados.',
    })
    return
  }

  // Products and discount_commission_rules cascade automatically
  const { rows } = await query(
    'DELETE FROM price_tables WHERE id = $1 RETURNING id',
    [id]
  )
  if (!rows[0]) {
    res.status(404).json({ error: 'Tabela não encontrada' })
    return
  }
  res.json({ deleted: true })
}

export async function updateGradeConfig(req: AuthRequest, res: Response) {
  const { product_id } = req.params
  const { grade_configs } = req.body
  // grade_configs: [{color, sizes, sort_order}]
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM grade_configs WHERE product_id=$1', [product_id])
    for (let i = 0; i < grade_configs.length; i++) {
      const g = grade_configs[i]
      const total = Object.values(g.sizes as Record<string, number>).reduce((a, b) => a + b, 0)
      await client.query(
        'INSERT INTO grade_configs (product_id, color, sizes, total_pieces, sort_order) VALUES ($1,$2,$3,$4,$5)',
        [product_id, g.color || null, JSON.stringify(g.sizes), total, i]
      )
    }
    await client.query('COMMIT')
    const { rows } = await client.query('SELECT * FROM grade_configs WHERE product_id=$1 ORDER BY sort_order', [product_id])
    res.json(rows)
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: 'Erro ao atualizar grade' })
  } finally {
    client.release()
  }
}
