import { Response } from 'express'
import path from 'path'
import { query, pool } from '../config/database'
import { AuthRequest } from '../middleware/auth'
import { importExcel, buildDefaultGrade, ImportedProduct } from '../services/import/excelImporter'
import { importCatalogPdf } from '../services/import/pdfImporter'
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
    res.json(rows[0])
  } catch (err) {
    console.error('Erro upload imagem produto:', err)
    res.status(500).json({ error: 'Erro ao salvar imagem' })
  }
}

export async function listProducts(req: AuthRequest, res: Response) {
  const { price_table_id, search, type, include_inactive } = req.query
  const isAdmin = req.user?.role === 'admin'
  let sql = `
    SELECT p.*,
      pt.name as price_table_name,
      f.name as factory_name,
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
    if (grade_configs && Array.isArray(grade_configs) && grade_configs.length > 0) {
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
  const { reference, product_name, model, size_range, base_price, category, observation, type } = req.body
  if (!reference || base_price === undefined) {
    res.status(400).json({ error: 'reference e base_price são obrigatórios' }); return
  }
  const { rows } = await query(
    `UPDATE products SET reference=$1, product_name=$2, model=$3, size_range=$4, base_price=$5, category=$6, observation=$7, type=$8, updated_at=NOW() WHERE id=$9 RETURNING *`,
    [reference, product_name || null, model || null, size_range || null, base_price, category || null, observation || null, type, id]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Produto não encontrado' }); return }
  res.json(rows[0])
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

export async function updatePriceTableRules(req: AuthRequest, res: Response) {
  const { id } = req.params
  const { discount_rules, name, collection, season, year } = req.body

  const dbClient = await (await import('../config/database')).pool.connect()
  try {
    await dbClient.query('BEGIN')

    // Atualiza metadados se fornecidos
    if (name !== undefined) {
      await dbClient.query(
        `UPDATE price_tables SET name=$1, collection=$2, season=$3, year=$4 WHERE id=$5`,
        [name, collection||null, season||null, year||null, id]
      )
    }

    // Substitui todas as regras de desconto/comissão
    if (discount_rules !== undefined) {
      const rules = Array.isArray(discount_rules) ? discount_rules : JSON.parse(discount_rules)
      await dbClient.query('DELETE FROM discount_commission_rules WHERE price_table_id=$1', [id])
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i]
        await dbClient.query(
          `INSERT INTO discount_commission_rules
           (price_table_id, discount_pct, total_commission_pct, rep_commission_pct, office_commission_pct, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, r.discount_pct, r.total_commission_pct, r.rep_commission_pct, r.office_commission_pct, i]
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
  const REF_REGEX = /((?:TE|PKTE)\d+)/i

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
