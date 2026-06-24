import { Response } from 'express'
import path from 'path'
import { PoolClient } from 'pg'
import { query, pool } from '../config/database'
import { AuthRequest } from '../middleware/auth'
import { importExcel, buildDefaultGrade, ImportedProduct } from '../services/import/excelImporter'
import { importCatalogPdf } from '../services/import/pdfImporter'
import { parseStock } from '../services/import/stockImporter'
import { uploadToR2, isR2Configured } from '../utils/r2'

export async function listPriceTables(req: AuthRequest, res: Response) {
  const { factory_id } = req.query
  const isAdmin = req.user?.role === 'admin'
  let sql = `
    SELECT pt.*, f.name as factory_name,
      COUNT(p.id) as product_count
    FROM price_tables pt
    JOIN factories f ON f.id = pt.factory_id
    LEFT JOIN products p ON p.price_table_id = pt.id
    WHERE pt.active = true
  `
  const params: unknown[] = []
  let idx = 1
  if (factory_id) { sql += ` AND pt.factory_id = $${idx++}`; params.push(factory_id) }
  // Rep: filtra apenas fábricas autorizadas (se tiver alguma configurada)
  if (!isAdmin) {
    sql += ` AND (
      NOT EXISTS (SELECT 1 FROM user_factory_access WHERE user_id=$${idx})
      OR pt.factory_id IN (SELECT factory_id FROM user_factory_access WHERE user_id=$${idx})
    )`
    params.push(req.user!.id)
    idx++
  }
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
  // Indica se é tabela de Pronta Entrega (para carregamento automático de comissão padrão)
  const { rows: peRows } = await query(
    'SELECT id FROM pe_catalogs WHERE price_table_id=$1 LIMIT 1', [req.params.id]
  )
  res.json({ ...rows[0], discount_rules: rules, is_pe: peRows.length > 0 })
}

// Preview do Excel antes de confirmar importação
export async function previewExcelImport(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }
  try {
    const result = importExcel(req.file.buffer)
    res.json({
      tableName: result.tableName || path.basename(req.file.originalname || '', path.extname(req.file.originalname || '')),
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
    guide_commission_pct?: number
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
         (price_table_id, discount_pct, total_commission_pct, rep_commission_pct, office_commission_pct, guide_commission_pct, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pt.id, r.discount_pct, r.total_commission_pct, r.rep_commission_pct, r.office_commission_pct, r.guide_commission_pct || 0, i]
      )
    }

    // Importa produtos
    const result = importExcel(req.file!.buffer)
    let inserted = 0

    // Corta campos longos p/ caber nos limites da coluna (evita abortar a importação
    // inteira por uma única linha com texto grande, ex.: lista de cores muito longa)
    const cut = (v: string | null | undefined, n: number) =>
      (v == null ? v : (String(v).length > n ? String(v).slice(0, n) : v))
    for (const prod of result.products) {
      const { rows: [p] } = await client.query(
        `INSERT INTO products
         (price_table_id, reference, type, product_name, model, size_range, base_price, category, observation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (price_table_id, reference) DO UPDATE
         SET base_price=EXCLUDED.base_price, updated_at=NOW()
         RETURNING id`,
        [pt.id, cut(prod.reference, 50), prod.type, cut(prod.product_name, 255), cut(prod.model, 255),
         cut(prod.size_range, 255), prod.base_price, cut(prod.category, 100), prod.observation]
      )

      if (prod.grade && prod.grade.length > 0) {
        // Grade vem do Excel (packs OU regulares com variantes cor/modelo × tamanho)
        // Limpa grades antigas do produto p/ re-import ser idempotente (não duplicar)
        await client.query('DELETE FROM grade_configs WHERE product_id=$1', [p.id])
        for (let i = 0; i < prod.grade.length; i++) {
          const g = prod.grade[i]
          const total = Object.values(g.sizes).reduce((a, b) => a + b, 0)
          await client.query(
            `INSERT INTO grade_configs (product_id, color, sizes, total_pieces, sort_order)
             VALUES ($1,$2,$3,$4,$5)`,
            [p.id, g.color, JSON.stringify(g.sizes), total, i]
          )
        }
      }
      // Produtos REG não têm grade_configs — apenas size_range define os tamanhos disponíveis
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

// Atualiza uma tabela JÁ EXISTENTE a partir de uma planilha (sem criar tabela nova):
//  - referência que já existe  → atualiza preço/descrição e MANTÉM foto, estoque e grade
//  - referência nova           → insere o produto (gera grade do Excel, como na importação)
//  - referência que saiu        → INATIVA (some da venda, mas preserva histórico/foto; reversível)
export async function updateTableFromExcel(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }
  const { id } = req.params

  const cut = (v: string | null | undefined, n: number) =>
    (v == null ? v : (String(v).length > n ? String(v).slice(0, n) : v))

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: [pt] } = await client.query('SELECT id FROM price_tables WHERE id=$1', [id])
    if (!pt) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Tabela não encontrada' }); return }

    const result = importExcel(req.file!.buffer)
    let updated = 0, inserted = 0, reactivated = 0
    const sheetRefs: string[] = []

    for (const prod of result.products) {
      const ref = cut(prod.reference, 50) as string
      sheetRefs.push(ref)

      const { rows: [existing] } = await client.query(
        'SELECT id, active FROM products WHERE price_table_id=$1 AND reference=$2',
        [pt.id, ref]
      )

      if (existing) {
        // Mantém estrutura de variantes (type/size_range/grade), foto (image_url) e estoque (stock).
        // Atualiza apenas preço + descrição e reativa caso estivesse inativo.
        await client.query(
          `UPDATE products
           SET base_price=$1, product_name=$2, model=$3, category=$4, observation=$5,
               active=true, updated_at=NOW()
           WHERE id=$6`,
          [prod.base_price, cut(prod.product_name, 255), cut(prod.model, 255),
           cut(prod.category, 100), prod.observation, existing.id]
        )
        if (!existing.active) reactivated++
        updated++
      } else {
        // Produto novo: insere e gera grade a partir do Excel (igual à importação inicial)
        const { rows: [p] } = await client.query(
          `INSERT INTO products
           (price_table_id, reference, type, product_name, model, size_range, base_price, category, observation)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [pt.id, ref, prod.type, cut(prod.product_name, 255), cut(prod.model, 255),
           cut(prod.size_range, 255), prod.base_price, cut(prod.category, 100), prod.observation]
        )
        if (prod.grade && prod.grade.length > 0) {
          for (let i = 0; i < prod.grade.length; i++) {
            const g = prod.grade[i]
            const total = Object.values(g.sizes).reduce((a, b) => a + b, 0)
            await client.query(
              `INSERT INTO grade_configs (product_id, color, sizes, total_pieces, sort_order)
               VALUES ($1,$2,$3,$4,$5)`,
              [p.id, g.color, JSON.stringify(g.sizes), total, i]
            )
          }
        }
        inserted++
      }
    }

    // Inativa as referências que sumiram da planilha (mantém os dados; reversível)
    let deactivated = 0
    if (sheetRefs.length > 0) {
      const { rowCount } = await client.query(
        `UPDATE products SET active=false, updated_at=NOW()
         WHERE price_table_id=$1 AND active=true AND reference <> ALL($2::text[])`,
        [pt.id, sheetRefs]
      )
      deactivated = rowCount || 0
    }

    await client.query('COMMIT')
    res.json({ updated, inserted, reactivated, deactivated, sheetCount: result.products.length })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Erro ao atualizar tabela' })
  } finally {
    client.release()
  }
}

// Importa catálogo PDF e associa fotos às referências
// overwrite=true → substitui fotos já existentes; overwrite=false (padrão) → só preenche vazias
export async function importCatalog(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }
  const { price_table_id, overwrite } = req.body
  if (!price_table_id) { res.status(400).json({ error: 'price_table_id obrigatório' }); return }
  const shouldOverwrite = overwrite === 'true' || overwrite === true

  // Referências da tabela de preço
  const { rows: prods } = await query(
    'SELECT reference FROM products WHERE price_table_id=$1', [price_table_id]
  )
  const tableRefs = prods.map(p => p.reference)

  // Salva PDF em diretório temporário para o importador
  const os = await import('os')
  const fs = await import('fs')
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'somma-pdf-'))
  const pdfPath = path.join(tmpDir, 'catalog.pdf')
  const uploadDir = path.join(tmpDir, 'images')
  fs.mkdirSync(uploadDir, { recursive: true })
  fs.writeFileSync(pdfPath, req.file.buffer)

  let result
  try {
    result = await importCatalogPdf(pdfPath, uploadDir, tableRefs)
  } catch (pdfErr: unknown) {
    console.error('❌ Erro ao processar PDF:', pdfErr)
    const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr)
    res.status(500).json({ error: `Erro ao processar PDF: ${msg}` })
    return
  }

  // Faz upload das imagens extraídas para R2 (ou copia para uploads local)
  // ATENÇÃO: page.imagePath é uma URL "/uploads/products/ref.jpg"
  // O arquivo REAL está em uploadDir (pasta temp), não nesse caminho!
  const client = await pool.connect()
  try {
    for (const page of result.pages) {
      if (!page.imagePath) continue

      // Caminho real do arquivo no diretório temporário
      const tempFilePath = path.join(uploadDir, path.basename(page.imagePath))
      if (!fs.existsSync(tempFilePath)) continue

      let finalUrl = page.imagePath  // fallback (URL relativa)

      if (isR2Configured()) {
        try {
          const imgBuffer = fs.readFileSync(tempFilePath)
          const imgName = path.basename(tempFilePath)
          finalUrl = await uploadToR2(imgBuffer, imgName, 'products')
        } catch (r2Err) {
          console.error('Erro upload R2:', r2Err)
        }
      } else {
        // Sem R2: copia para a pasta de uploads estática (persiste até próximo restart)
        const uploadsProductsDir = path.join(__dirname, '../../..', 'uploads', 'products')
        fs.mkdirSync(uploadsProductsDir, { recursive: true })
        fs.copyFileSync(tempFilePath, path.join(uploadsProductsDir, path.basename(tempFilePath)))
      }

      for (const ref of page.references) {
        const condition = shouldOverwrite ? '' : 'AND image_url IS NULL'
        await client.query(
          `UPDATE products SET image_url=$1, updated_at=NOW()
           WHERE price_table_id=$2 AND reference=$3 ${condition}`,
          [finalUrl, price_table_id, ref]
        )
      }
    }
  } finally {
    client.release()
    // Limpa arquivos temporários
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }

  res.json({
    totalPages: result.totalPages,
    pagesWithText: result.pagesWithText,
    foundInPdf: result.foundInPdf,          // array completo para diagnóstico
    foundInPdfCount: result.foundInPdf.length,
    matched: result.matched,
    matchedCount: result.matched.length,
    unmatched: result.unmatched,
    unmatchedCount: result.unmatched.length,
  })
}

// Upload manual de foto para uma referência
export async function uploadProductImage(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }
  try {
    let imageUrl: string
    if (isR2Configured()) {
      imageUrl = await uploadToR2(req.file.buffer, req.file.originalname, 'products')
    } else {
      // Fallback local
      const fs = await import('fs')
      const ext = path.extname(req.file.originalname)
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
      const dest = path.join(__dirname, '../../..', 'uploads', 'products', filename)
      fs.writeFileSync(dest, req.file.buffer)
      imageUrl = `/uploads/products/${filename}`
    }
    const { rows } = await query(
      'UPDATE products SET image_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [imageUrl, req.params.id]
    )
    if (!rows[0]) { res.status(404).json({ error: 'Produto não encontrado' }); return }

    // Sincroniza a mesma foto em todos os produtos com a MESMA referência
    // (a referência se repete em várias tabelas de preço — ex: catálogo normal,
    // Pronta Entrega, coleções diferentes — e todas devem exibir a mesma foto)
    const synced = await query(
      'UPDATE products SET image_url=$1, updated_at=NOW() WHERE reference=$2 AND id<>$3 RETURNING id',
      [imageUrl, rows[0].reference, rows[0].id]
    )

    res.json({ ...rows[0], synced_count: synced.rows.length })
  } catch (err) {
    console.error('Erro upload imagem produto:', err)
    res.status(500).json({ error: 'Erro ao salvar imagem' })
  }
}

// ── Galeria de fotos do produto ───────────────────────────────────────────────
// Adiciona UMA imagem à galeria (append). Define como capa só se o produto ainda não tiver.
export async function addProductImage(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }
  const { id } = req.params
  try {
    const sharpLib = (await import('sharp')).default
    const resized = await sharpLib(req.file.buffer)
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer()

    const key = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    let url: string
    if (isR2Configured()) {
      url = await uploadToR2(resized, key, 'products')
    } else {
      const fs = await import('fs')
      const dest = path.join(__dirname, '../../..', 'uploads', 'products', key)
      fs.writeFileSync(dest, resized)
      url = `/uploads/products/${key}`
    }

    const { rows: [{ next }] } = await query(
      'SELECT COALESCE(MAX(sort_order)+1,0) as next FROM product_images WHERE product_id=$1', [id]
    )
    const { rows: [img] } = await query(
      'INSERT INTO product_images (product_id, url, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [id, url, next]
    )
    // Define capa se ainda não houver
    await query(
      `UPDATE products SET image_url=COALESCE(NULLIF(image_url,''),$1), updated_at=NOW() WHERE id=$2`,
      [url, id]
    )
    res.status(201).json(img)
  } catch (err) {
    console.error('Erro ao adicionar imagem à galeria:', err)
    res.status(500).json({ error: 'Erro ao adicionar imagem' })
  }
}

export async function listProductImages(req: AuthRequest, res: Response) {
  const { rows } = await query(
    'SELECT * FROM product_images WHERE product_id=$1 ORDER BY sort_order, created_at', [req.params.id]
  )
  res.json(rows)
}

// Remove imagem da galeria. Se era a capa, promove a próxima (ou limpa).
export async function deleteProductImage(req: AuthRequest, res: Response) {
  const { id, imageId } = req.params
  const { rows: [img] } = await query('SELECT url FROM product_images WHERE id=$1 AND product_id=$2', [imageId, id])
  if (!img) { res.status(404).json({ error: 'Imagem não encontrada' }); return }
  await query('DELETE FROM product_images WHERE id=$1', [imageId])
  const { rows: [prod] } = await query('SELECT image_url FROM products WHERE id=$1', [id])
  if (prod && prod.image_url === img.url) {
    const { rows: [nextImg] } = await query(
      'SELECT url FROM product_images WHERE product_id=$1 ORDER BY sort_order, created_at LIMIT 1', [id]
    )
    await query('UPDATE products SET image_url=$1, updated_at=NOW() WHERE id=$2', [nextImg ? nextImg.url : null, id])
  }
  res.json({ deleted: true })
}

// Define a foto-capa (image_url) a partir de uma imagem da galeria
export async function setCoverImage(req: AuthRequest, res: Response) {
  const { id, imageId } = req.params
  const { rows: [img] } = await query('SELECT url FROM product_images WHERE id=$1 AND product_id=$2', [imageId, id])
  if (!img) { res.status(404).json({ error: 'Imagem não encontrada' }); return }
  await query('UPDATE products SET image_url=$1, updated_at=NOW() WHERE id=$2', [img.url, id])
  res.json({ cover: img.url })
}

export async function listProducts(req: AuthRequest, res: Response) {
  const { price_table_id, search, type, include_inactive, sem_foto, com_foto } = req.query
  const isAdmin = req.user?.role === 'admin'
  let sql = `
    SELECT p.*,
      pt.name as price_table_name,
      f.name as factory_name,
      COALESCE((SELECT json_agg(pi.url ORDER BY pi.sort_order, pi.created_at)
                FROM product_images pi WHERE pi.product_id = p.id), '[]') as images,
      json_agg(gc ORDER BY gc.sort_order) FILTER (WHERE gc.id IS NOT NULL) as grade_configs
    FROM products p
    LEFT JOIN price_tables pt ON pt.id = p.price_table_id
    LEFT JOIN factories f ON f.id = pt.factory_id
    LEFT JOIN grade_configs gc ON gc.product_id = p.id
    WHERE 1=1
  `
  const params: unknown[] = []
  let idx = 1
  // Filtra inativos: admin com include_inactive=true vê tudo; rep só vê ativos
  if (!isAdmin || include_inactive !== 'true') {
    sql += ` AND p.active = true`
  }
  if (price_table_id) { sql += ` AND p.price_table_id = $${idx++}`; params.push(price_table_id) }
  if (type) { sql += ` AND p.type = $${idx++}`; params.push(type) }
  if (sem_foto === 'true') { sql += ` AND (p.image_url IS NULL OR p.image_url = '')` }
  if (com_foto === 'true') { sql += ` AND p.image_url IS NOT NULL AND p.image_url <> ''` }
  if (search) {
    sql += ` AND (
      p.reference ILIKE $${idx} OR p.product_name ILIKE $${idx} OR
      p.model ILIKE $${idx} OR p.category ILIKE $${idx} OR
      p.observation ILIKE $${idx} OR p.size_range ILIKE $${idx} OR
      f.name ILIKE $${idx} OR pt.name ILIKE $${idx}
    )`
    params.push(`%${search}%`)
    idx++
  }
  // Rep: filtra apenas fábricas autorizadas (se tiver alguma configurada)
  if (!isAdmin) {
    sql += ` AND (
      NOT EXISTS (SELECT 1 FROM user_factory_access WHERE user_id=$${idx})
      OR pt.factory_id IN (SELECT factory_id FROM user_factory_access WHERE user_id=$${idx})
    )`
    params.push(req.user!.id)
    idx++
  }
  sql += ' GROUP BY p.id, pt.name, f.name ORDER BY p.reference'
  const { rows } = await query(sql, params)
  res.json(rows)
}

export async function createProduct(req: AuthRequest, res: Response) {
  const { price_table_id, reference, product_name, model, size_range, base_price, category, observation, type, grade_configs } = req.body
  if (!price_table_id || !reference || base_price === undefined) {
    res.status(400).json({ error: 'price_table_id, reference e base_price são obrigatórios' }); return
  }
  const dbClient = await (await import('../config/database')).pool.connect()
  try {
    await dbClient.query('BEGIN')
    const { rows } = await dbClient.query(
      `INSERT INTO products (price_table_id, reference, type, product_name, model, size_range, base_price, category, observation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [price_table_id, reference, type || 'regular', product_name || null, model || null, size_range || null, base_price, category || null, observation || null]
    )
    const product = rows[0]
    // Só salva grade_configs para produtos PACK (REG não usa grade)
    if ((type === 'pack') && grade_configs && Array.isArray(grade_configs) && grade_configs.length > 0) {
      for (let i = 0; i < grade_configs.length; i++) {
        const gc = grade_configs[i]
        const totalPieces = Object.values(gc.sizes as Record<string, number>).reduce((s: number, v: unknown) => s + Number(v || 0), 0)
        await dbClient.query(
          `INSERT INTO grade_configs (product_id, color, sizes, total_pieces, sort_order) VALUES ($1,$2,$3,$4,$5)`,
          [product.id, gc.color || null, JSON.stringify(gc.sizes), totalPieces, i]
        )
      }
    }
    await dbClient.query('COMMIT')
    res.status(201).json(product)
  } catch (err) {
    await dbClient.query('ROLLBACK')
    console.error('Erro criar produto:', err)
    res.status(500).json({ error: 'Erro ao criar produto' })
  } finally {
    dbClient.release()
  }
}

export async function duplicateProduct(req: AuthRequest, res: Response) {
  const { id } = req.params
  const { reference } = req.body  // nova referência para o duplicado
  const dbClient = await (await import('../config/database')).pool.connect()
  try {
    await dbClient.query('BEGIN')
    // Busca produto original com grades
    const { rows: [orig] } = await dbClient.query('SELECT * FROM products WHERE id=$1', [id])
    if (!orig) { res.status(404).json({ error: 'Produto não encontrado' }); return }
    const { rows: grades } = await dbClient.query('SELECT * FROM grade_configs WHERE product_id=$1 ORDER BY sort_order', [id])
    // Cria cópia com nova referência
    const newRef = reference || `${orig.reference}-COPIA`
    const { rows: [newProd] } = await dbClient.query(
      `INSERT INTO products (price_table_id, reference, type, product_name, model, size_range, base_price, category, observation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [orig.price_table_id, newRef, orig.type, orig.product_name, orig.model, orig.size_range, orig.base_price, orig.category, orig.observation]
    )
    // Copia grades
    for (const gc of grades) {
      await dbClient.query(
        `INSERT INTO grade_configs (product_id, color, sizes, total_pieces, sort_order) VALUES ($1,$2,$3,$4,$5)`,
        [newProd.id, gc.color, gc.sizes, gc.total_pieces, gc.sort_order]
      )
    }
    await dbClient.query('COMMIT')
    res.status(201).json(newProd)
  } catch (err) {
    await dbClient.query('ROLLBACK')
    console.error('Erro duplicar produto:', err)
    res.status(500).json({ error: 'Erro ao duplicar produto' })
  } finally {
    dbClient.release()
  }
}

export async function updateProduct(req: AuthRequest, res: Response) {
  const { id } = req.params
  const { reference, product_name, model, size_range, base_price, category, observation, type, price_table_id } = req.body
  if (!reference || base_price === undefined) {
    res.status(400).json({ error: 'reference e base_price são obrigatórios' }); return
  }
  const params: unknown[] = [reference, product_name || null, model || null, size_range || null, base_price, category || null, observation || null, type, id]
  if (price_table_id) params.splice(8, 0, price_table_id) // insert before id
  const sql = price_table_id
    ? `UPDATE products SET reference=$1, product_name=$2, model=$3, size_range=$4, base_price=$5, category=$6, observation=$7, type=$8, price_table_id=$9, updated_at=NOW() WHERE id=$10 RETURNING *`
    : `UPDATE products SET reference=$1, product_name=$2, model=$3, size_range=$4, base_price=$5, category=$6, observation=$7, type=$8, updated_at=NOW() WHERE id=$9 RETURNING *`
  try {
    // Captura a referência ANTES da edição, para localizar corretamente os "irmãos"
    // (mesmo produto cadastrado em outras tabelas de preço/coleções) mesmo quando a
    // própria referência está sendo alterada nesta edição
    const { rows: currentRows } = await query('SELECT reference FROM products WHERE id=$1', [id])
    if (!currentRows[0]) { res.status(404).json({ error: 'Produto não encontrado' }); return }
    const oldReference = currentRows[0].reference as string

    const { rows } = await query(sql, params)
    if (!rows[0]) { res.status(404).json({ error: 'Produto não encontrado' }); return }

    // Propaga as alterações (exceto preço, tabela de preço e a própria referência) para
    // todos os outros produtos com a MESMA referência — ou seja, o mesmo modelo
    // cadastrado em outras coleções/tabelas de preço
    const synced = await query(
      `UPDATE products
          SET product_name=$1, model=$2, size_range=$3, category=$4, observation=$5, type=$6, updated_at=NOW()
        WHERE reference=$7 AND id<>$8
        RETURNING id`,
      [product_name || null, model || null, size_range || null, category || null, observation || null, type, oldReference, rows[0].id]
    )

    res.json({ ...rows[0], synced_count: synced.rows.length })
  } catch (err) {
    console.error('Erro ao atualizar produto:', err)
    res.status(500).json({ error: 'Erro ao salvar produto' })
  }
}

export async function deleteProduct(req: AuthRequest, res: Response) {
  const { id } = req.params
  const dbClient = await (await import('../config/database')).pool.connect()
  try {
    await dbClient.query('BEGIN')
    // Remove itens de pedidos que referenciam este produto (apenas os não finalizados)
    await dbClient.query('DELETE FROM grade_configs WHERE product_id=$1', [id])
    const { rows } = await dbClient.query(
      'DELETE FROM products WHERE id=$1 RETURNING reference', [id]
    )
    if (!rows[0]) { await dbClient.query('ROLLBACK'); res.status(404).json({ error: 'Produto não encontrado' }); return }
    await dbClient.query('COMMIT')
    res.json({ ok: true, reference: rows[0].reference })
  } catch (err) {
    await dbClient.query('ROLLBACK')
    // Se tiver pedidos vinculados, apenas inativa em vez de excluir
    await (await import('../config/database')).query(
      'UPDATE products SET active=false WHERE id=$1', [id]
    )
    res.json({ ok: true, inactivated: true })
  } finally {
    dbClient.release()
  }
}

export async function updateProductAvailability(req: AuthRequest, res: Response) {
  const { id } = req.params
  const { active } = req.body
  if (typeof active !== 'boolean') {
    res.status(400).json({ error: 'active deve ser boolean' })
    return
  }
  const { rows } = await query(
    'UPDATE products SET active=$1 WHERE id=$2 RETURNING id, active',
    [active, id]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Produto não encontrado' }); return }
  res.json(rows[0])
}

export async function updateBlockedSizes(req: AuthRequest, res: Response) {
  const { id } = req.params
  const { blocked_sizes } = req.body
  if (!Array.isArray(blocked_sizes)) {
    res.status(400).json({ error: 'blocked_sizes deve ser array' })
    return
  }
  const { rows } = await query(
    'UPDATE products SET blocked_sizes=$1 WHERE id=$2 RETURNING id, blocked_sizes',
    [blocked_sizes, id]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Produto não encontrado' }); return }
  res.json(rows[0])
}

export async function createPriceTable(req: AuthRequest, res: Response) {
  const { factory_id, name, collection, season, year, discount_rules } = req.body
  if (!factory_id || !name) {
    res.status(400).json({ error: 'factory_id e name são obrigatórios' }); return
  }
  const dbClient = await (await import('../config/database')).pool.connect()
  try {
    await dbClient.query('BEGIN')
    const { rows: [table] } = await dbClient.query(
      `INSERT INTO price_tables (factory_id, name, collection, season, year, imported_at)
       VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
      [factory_id, name, collection||null, season||null, year||null]
    )
    // Insere regras de desconto/comissão se fornecidas
    if (discount_rules && Array.isArray(discount_rules)) {
      for (let i = 0; i < discount_rules.length; i++) {
        const r = discount_rules[i]
        await dbClient.query(
          `INSERT INTO discount_commission_rules (price_table_id, discount_pct, total_commission_pct, rep_commission_pct, office_commission_pct, guide_commission_pct, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [table.id, r.discount_pct||0, r.total_commission_pct||0, r.rep_commission_pct||0, r.office_commission_pct||0, r.guide_commission_pct||0, i]
        )
      }
    }
    await dbClient.query('COMMIT')
    res.status(201).json(table)
  } catch (err) {
    await dbClient.query('ROLLBACK')
    console.error('Erro criar tabela:', err)
    res.status(500).json({ error: 'Erro ao criar tabela' })
  } finally {
    dbClient.release()
  }
}

export async function updatePriceTableRules(req: AuthRequest, res: Response) {
  const { id } = req.params
  const { discount_rules, name, collection, season, year } = req.body

  const dbClient = await (await import('../config/database')).pool.connect()
  try {
    await dbClient.query('BEGIN')

    // Atualiza só os metadados realmente enviados (campos omitidos não são zerados)
    const { max_cash_discount_pct } = req.body
    const sets: string[] = []
    const params: unknown[] = []
    let idx = 1
    if (name !== undefined)       { sets.push(`name=$${idx++}`);       params.push(name) }
    if (collection !== undefined) { sets.push(`collection=$${idx++}`); params.push(collection || null) }
    if (season !== undefined)     { sets.push(`season=$${idx++}`);     params.push(season || null) }
    if (year !== undefined)       { sets.push(`year=$${idx++}`);       params.push(year || null) }
    if (max_cash_discount_pct !== undefined) {
      const maxCash = (max_cash_discount_pct === '' || max_cash_discount_pct === null) ? null : parseFloat(max_cash_discount_pct)
      sets.push(`max_cash_discount_pct=$${idx++}`); params.push(maxCash)
    }
    if (sets.length > 0) {
      params.push(id)
      await dbClient.query(`UPDATE price_tables SET ${sets.join(', ')} WHERE id=$${idx}`, params)
    }

    // Substitui todas as regras de desconto/comissão
    if (discount_rules !== undefined) {
      const rules = Array.isArray(discount_rules) ? discount_rules : JSON.parse(discount_rules)
      await dbClient.query('DELETE FROM discount_commission_rules WHERE price_table_id=$1', [id])
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i]
        await dbClient.query(
          `INSERT INTO discount_commission_rules
           (price_table_id, discount_pct, total_commission_pct, rep_commission_pct, office_commission_pct, guide_commission_pct, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, r.discount_pct, r.total_commission_pct, r.rep_commission_pct, r.office_commission_pct, r.guide_commission_pct||0, i]
        )
      }
    }

    await dbClient.query('COMMIT')

    // Retorna tabela atualizada com regras
    const { rows: [pt] } = await dbClient.query('SELECT * FROM price_tables WHERE id=$1', [id])
    const { rows: rules } = await dbClient.query(
      'SELECT * FROM discount_commission_rules WHERE price_table_id=$1 ORDER BY discount_pct', [id]
    )
    res.json({ ...pt, discount_rules: rules })
  } catch (err) {
    await dbClient.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Erro ao atualizar tabela' })
  } finally {
    dbClient.release()
  }
}

export async function deletePriceTable(req: AuthRequest, res: Response) {
  const { id } = req.params
  // Products/grade_configs/discount_rules cascade delete.
  // orders.price_table_id and order_items.product_id are SET NULL automatically
  // (see migration v4), so order history is fully preserved.
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

// Limpa todas as image_url de uma tabela (para re-importar após bugfix)
export async function clearProductImages(req: AuthRequest, res: Response) {
  const { id } = req.params
  const { rows } = await query(
    `UPDATE products SET image_url=NULL, updated_at=NOW()
     WHERE price_table_id=$1 RETURNING id`,
    [id]
  )
  res.json({ cleared: rows.length })
}

// Importa fotos em massa via arquivo ZIP
// Extrai imagens do ZIP, lê a referência do nome do arquivo (ex: "001 TE10308-791.jpg" → TE10308)
// redimensiona com sharp e sobe para R2 (ou local como fallback)
export async function importPhotosZip(req: AuthRequest, res: Response) {
  const hasFile = req.file && (req.file.buffer?.length || req.file.path)
  if (!hasFile) { res.status(400).json({ error: 'Arquivo ZIP não enviado' }); return }
  const { price_table_id, overwrite } = req.body
  if (!price_table_id) { res.status(400).json({ error: 'price_table_id obrigatório' }); return }
  const shouldOverwrite = overwrite === 'true' || overwrite === true

  // Referências da tabela alvo
  const { rows: prods } = await query(
    'SELECT reference FROM products WHERE price_table_id=$1', [price_table_id]
  )
  if (prods.length === 0) { res.status(404).json({ error: 'Tabela não encontrada ou sem produtos' }); return }
  const tableSet = new Set(prods.map((p: { reference: string }) => p.reference.toUpperCase()))

  const os = await import('os')
  const fs = await import('fs')
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'somma-zip-'))
  const zipPath = path.join(tmpDir, 'photos.zip')
  const extractDir = path.join(tmpDir, 'images')
  fs.mkdirSync(extractDir, { recursive: true })

  // Grava ZIP no disco (pode vir de memory ou disk multer)
  if (req.file!.path) {
    fs.copyFileSync(req.file!.path, zipPath)
    try { fs.unlinkSync(req.file!.path) } catch {}
  } else {
    fs.writeFileSync(zipPath, req.file!.buffer!)
  }

  // Extrai imagens do ZIP usando unzipper (Node.js puro — sem dependência de Python)
  const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
  // Aceita qualquer referência: TE, PKTE, ZZ, ZO, etc. (2 letras maiúsculas + dígitos)
  const REF_REGEX = /([A-Z]{2,4}\d+)/i

  let extracted: Array<{ ref: string; path: string; ext: string }> = []
  try {
    const unzipper = await import('unzipper')
    const directory = await unzipper.Open.file(zipPath)

    for (const file of directory.files) {
      if (file.type === 'Directory') continue
      const base = path.basename(file.path)
      const ext = path.extname(base).toLowerCase()
      if (!IMAGE_EXTS.has(ext)) continue
      const m = base.match(REF_REGEX)
      if (!m) continue
      const ref = m[1].toUpperCase()
      const outPath = path.join(extractDir, ref + ext)
      const buffer = await file.buffer()
      fs.writeFileSync(outPath, buffer)
      extracted.push({ ref, path: outPath, ext })
    }
  } catch (err) {
    console.error('Erro ao extrair ZIP:', err)
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    res.status(500).json({ error: 'Erro ao processar ZIP. Verifique se é um arquivo .zip válido.' })
    return
  }

  let matched = 0
  let skipped = 0
  const notInTable: string[] = []
  const errors: string[] = []

  const client = await pool.connect()
  try {
    for (const item of extracted) {
      if (!tableSet.has(item.ref)) { notInTable.push(item.ref); continue }

      let finalUrl: string
      try {
        // Redimensiona para max 1200px preservando proporção, JPEG 85%
        const sharpLib = (await import('sharp')).default
        const resized = await sharpLib(item.path)
          .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()

        if (isR2Configured()) {
          finalUrl = await uploadToR2(resized, `${item.ref}.jpg`, 'products')
        } else {
          const localDest = path.join(__dirname, '../../..', 'uploads', 'products', `${item.ref}.jpg`)
          fs.writeFileSync(localDest, resized)
          finalUrl = `/uploads/products/${item.ref}.jpg`
        }
      } catch (uploadErr) {
        console.error(`Erro ao processar ${item.ref}:`, uploadErr)
        errors.push(item.ref)
        continue
      }

      const condition = shouldOverwrite ? '' : 'AND image_url IS NULL'
      const r = await client.query(
        `UPDATE products SET image_url=$1, updated_at=NOW()
         WHERE price_table_id=$2 AND UPPER(reference)=$3 ${condition} RETURNING id`,
        [finalUrl, price_table_id, item.ref]
      )
      if ((r.rowCount ?? 0) > 0) matched++; else skipped++
    }
  } finally {
    client.release()
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }

  res.json({ total: extracted.length, matched, skipped, notInTable, notInTableCount: notInTable.length, errors })
}

// Upload de foto por referência (usado pelo cliente JSZip para uploads individuais)
// POST /price-tables/:id/photo-by-ref?reference=TE10308&overwrite=true
export async function uploadPhotoByRef(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }
  const priceTableId = req.params.id
  const reference = (req.query.reference as string || '').toUpperCase().trim()
  const overwrite = req.query.overwrite === 'true'
  if (!reference) { res.status(400).json({ error: 'reference obrigatório' }); return }

  // Verifica se referência existe na tabela
  const { rows: prods } = await query(
    'SELECT id FROM products WHERE price_table_id=$1 AND UPPER(reference)=$2',
    [priceTableId, reference]
  )
  if (prods.length === 0) { res.json({ skipped: true, reason: 'not_found' }); return }

  // Verifica se já tem foto (quando overwrite=false)
  if (!overwrite) {
    const { rows: existing } = await query(
      'SELECT image_url FROM products WHERE price_table_id=$1 AND UPPER(reference)=$2 AND image_url IS NOT NULL',
      [priceTableId, reference]
    )
    if (existing.length > 0) { res.json({ skipped: true, reason: 'already_exists' }); return }
  }

  try {
    const sharpLib = (await import('sharp')).default
    const resized = await sharpLib(req.file.buffer)
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()

    let finalUrl: string
    if (isR2Configured()) {
      finalUrl = await uploadToR2(resized, `${reference}.jpg`, 'products')
    } else {
      const fs = await import('fs')
      const localDest = path.join(__dirname, '../../..', 'uploads', 'products', `${reference}.jpg`)
      fs.writeFileSync(localDest, resized)
      finalUrl = `/uploads/products/${reference}.jpg`
    }

    await query(
      `UPDATE products SET image_url=$1, updated_at=NOW()
       WHERE price_table_id=$2 AND UPPER(reference)=$3`,
      [finalUrl, priceTableId, reference]
    )
    res.json({ matched: true, reference, url: finalUrl })
  } catch (err) {
    console.error(`Erro upload foto ${reference}:`, err)
    res.status(500).json({ error: `Erro ao processar ${reference}` })
  }
}

async function replaceGradeConfigs(client: PoolClient, productId: string, grade_configs: { color?: string | null; sizes: Record<string, number> }[]) {
  await client.query('DELETE FROM grade_configs WHERE product_id=$1', [productId])
  for (let i = 0; i < grade_configs.length; i++) {
    const g = grade_configs[i]
    const total = Object.values(g.sizes as Record<string, number>).reduce((a, b) => a + b, 0)
    await client.query(
      'INSERT INTO grade_configs (product_id, color, sizes, total_pieces, sort_order) VALUES ($1,$2,$3,$4,$5)',
      [productId, g.color || null, JSON.stringify(g.sizes), total, i]
    )
  }
}

export async function updateGradeConfig(req: AuthRequest, res: Response) {
  const { product_id } = req.params
  const { grade_configs } = req.body
  // grade_configs: [{color, sizes, sort_order}]
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await replaceGradeConfigs(client, product_id, grade_configs)

    // Propaga a mesma grade (cores/tamanhos) para os demais produtos com a MESMA
    // referência — ou seja, o mesmo modelo cadastrado em outras coleções/tabelas de preço
    const { rows: prodRows } = await client.query('SELECT reference FROM products WHERE id=$1', [product_id])
    let syncedCount = 0
    if (prodRows[0]) {
      const { rows: siblings } = await client.query(
        'SELECT id FROM products WHERE reference=$1 AND id<>$2',
        [prodRows[0].reference, product_id]
      )
      for (const sibling of siblings) {
        await replaceGradeConfigs(client, sibling.id, grade_configs)
      }
      syncedCount = siblings.length
    }

    await client.query('COMMIT')
    const { rows } = await client.query('SELECT * FROM grade_configs WHERE product_id=$1 ORDER BY sort_order', [product_id])
    res.json({ rows, synced_count: syncedCount })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Erro ao atualizar grade:', err)
    res.status(500).json({ error: 'Erro ao atualizar grade' })
  } finally {
    client.release()
  }
}

// ── Relatório de produtos sem foto ────────────────────────────────────────────
export async function downloadSemFotos(req: AuthRequest, res: Response) {
  const XLSX = await import('xlsx')

  const { rows } = await query(`
    SELECT
      f.name   AS fabrica,
      pt.name  AS tabela,
      p.reference,
      p.product_name AS nome,
      p.type,
      p.active
    FROM products p
    JOIN price_tables pt ON pt.id = p.price_table_id
    JOIN factories    f  ON f.id  = pt.factory_id
    WHERE (p.image_url IS NULL OR p.image_url = '')
    ORDER BY f.name, pt.name, p.reference
  `)

  // Agrupa por fábrica/tabela para sheet de resumo
  const groups: Record<string, { total: number }> = {}
  for (const r of rows) {
    const key = `${r.fabrica} — ${r.tabela}`
    if (!groups[key]) groups[key] = { total: 0 }
    groups[key].total++
  }

  const wb = XLSX.utils.book_new()

  // Aba 1: Resumo
  const resumoData = [
    ['Fábrica / Tabela', 'Qtd sem foto'],
    ...Object.entries(groups).map(([k, v]) => [k, v.total]),
    [],
    ['TOTAL', rows.length],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumoData), 'Resumo')

  // Aba 2: Lista completa
  const listaData = [
    ['Fábrica', 'Tabela', 'Referência', 'Nome', 'Tipo', 'Status'],
    ...rows.map(r => [
      r.fabrica, r.tabela, r.reference, r.nome,
      r.type === 'regular' ? 'Regular' : 'Pack',
      r.active ? 'Ativo' : 'Inativo',
    ]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(listaData), 'Produtos sem Foto')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  res.setHeader('Content-Disposition', 'attachment; filename="sem-fotos.xlsx"')
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.send(buf)
}

// Importa estoque (planilha diária) — atualiza products.stock por referência
export async function importStock(req: AuthRequest, res: Response) {
  if (!req.file) { res.status(400).json({ error: 'Arquivo não enviado' }); return }
  try {
    const { byRef, totalRefs, totalRows } = parseStock(req.file.buffer)
    let matched = 0
    const notFound: string[] = []
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const ref of Object.keys(byRef)) {
        const { rowCount } = await client.query(
          `UPDATE products SET stock=$1, stock_updated_at=NOW() WHERE reference=$2`,
          [JSON.stringify(byRef[ref]), ref]
        )
        if (rowCount && rowCount > 0) matched++; else notFound.push(ref)
      }
      await client.query('COMMIT')
    } catch (e) { await client.query('ROLLBACK'); throw e }
    finally { client.release() }
    res.json({ totalRefs, totalRows, matched, notFoundCount: notFound.length, notFound: notFound.slice(0, 50) })
  } catch (err) {
    console.error('importStock', err)
    res.status(400).json({ error: 'Erro ao ler a planilha de estoque' })
  }
}
