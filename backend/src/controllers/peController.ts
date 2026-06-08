import { Response } from 'express'
import { query, pool } from '../config/database'
import { AuthRequest } from '../middleware/auth'
import crypto from 'crypto'
import * as XLSX from 'xlsx'

// ─── helpers ────────────────────────────────────────────────────────────────

/** Extrai referências do buffer xlsx. Aceita qualquer coluna que pareça referência de produto. */
function refsFromBuffer(buf: Buffer): string[] {
  const wb   = XLSX.read(buf, { type: 'buffer' })
  const ws   = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })

  const refs: string[] = []
  const REF_RE = /^[A-Z]{2,5}\d{3,}/i

  for (const row of rows) {
    for (const cell of row) {
      const val = String(cell ?? '').trim().toUpperCase()
      if (REF_RE.test(val)) refs.push(val)
    }
  }
  return [...new Set(refs)]
}

// ─── Listagem ────────────────────────────────────────────────────────────────

/**
 * Remove automaticamente do(s) catálogo(s) de Pronta Entrega quaisquer produtos
 * sem foto cadastrada (image_url vazio/nulo). Roda toda vez que a lista de
 * catálogos PE é carregada — autolimpeza contínua, além do filtro já aplicado
 * na importação (que impede a entrada de referências sem foto).
 */
async function removePeProductsWithoutPhoto() {
  const { rows: affected } = await query(`
    SELECT p.id, p.price_table_id
    FROM products p
    JOIN pe_catalogs pc ON pc.price_table_id = p.price_table_id
    WHERE p.image_url IS NULL OR btrim(p.image_url) = ''
  `)
  if (affected.length === 0) return

  const ids = affected.map(r => r.id)
  await query('DELETE FROM grade_configs WHERE product_id = ANY($1)', [ids])
  await query('DELETE FROM products WHERE id = ANY($1)', [ids])

  const tableIds = [...new Set(affected.map(r => r.price_table_id))]
  await query(`
    UPDATE pe_catalogs pc
       SET item_count = (SELECT count(*) FROM products WHERE price_table_id = pc.price_table_id),
           updated_at = NOW()
     WHERE pc.price_table_id = ANY($1)
  `, [tableIds])
}

export async function listPeCatalogs(req: AuthRequest, res: Response) {
  await removePeProductsWithoutPhoto()

  const { rows } = await query(`
    SELECT
      pe.id, pe.name, pe.active, pe.item_count, pe.last_import_at, pe.created_at,
      f.id   AS factory_id,   f.name  AS factory_name,
      cp.token AS portal_token,
      pt.id  AS price_table_id
    FROM pe_catalogs pe
    JOIN factories f          ON f.id  = pe.factory_id
    LEFT JOIN customer_portals cp ON cp.id = pe.portal_id
    LEFT JOIN price_tables     pt ON pt.id = pe.price_table_id
    ORDER BY f.name, pe.name
  `)
  res.json(rows)
}

// ─── Criação ────────────────────────────────────────────────────────────────

export async function createPeCatalog(req: AuthRequest, res: Response) {
  const { name, factory_id } = req.body
  if (!name || !factory_id) {
    res.status(400).json({ error: 'name e factory_id são obrigatórios' }); return
  }

  const repId = req.user!.id
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Tabela de preços dedicada ao PE
    const ptName = `PE ${name}`
    const { rows: [pt] } = await client.query(
      `INSERT INTO price_tables (factory_id, name, collection, season, year, active)
       VALUES ($1, $2, 'Pronta Entrega', '', NULL, true) RETURNING id`,
      [factory_id, ptName]
    )

    // 2. Portal de cliente apontando para essa tabela
    const token = crypto.randomBytes(24).toString('hex')
    const { rows: [cp] } = await client.query(
      `INSERT INTO customer_portals (rep_id, factory_ids, price_table_ids, token, name, active)
       VALUES ($1::uuid, ARRAY[]::uuid[], ARRAY[$2::uuid], $3, $4, true) RETURNING id`,
      [repId, pt.id, token, `Portal PE — ${name}`]
    )

    // 3. Registro pe_catalogs
    const { rows: [pe] } = await client.query(
      `INSERT INTO pe_catalogs (name, factory_id, price_table_id, portal_id, rep_id)
       VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid)
       RETURNING *`,
      [name, factory_id, pt.id, cp.id, repId]
    )

    await client.query('COMMIT')
    res.status(201).json({ ...pe, portal_token: token })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Erro ao criar catálogo PE' })
  } finally {
    client.release()
  }
}

// ─── Importar Excel ──────────────────────────────────────────────────────────

export async function importPeExcel(req: AuthRequest, res: Response) {
  const { id } = req.params
  if (!req.file) { res.status(400).json({ error: 'Arquivo xlsx obrigatório' }); return }

  // Busca o PE catalog
  const { rows: [pe] } = await query(
    `SELECT pe.*, f.id AS fac_id
     FROM pe_catalogs pe JOIN factories f ON f.id = pe.factory_id
     WHERE pe.id = $1`,
    [id]
  )
  if (!pe) { res.status(404).json({ error: 'Catálogo PE não encontrado' }); return }
  if (!pe.price_table_id) { res.status(400).json({ error: 'Sem tabela de preços associada' }); return }

  // Extrai referências do xlsx
  const refs = refsFromBuffer(req.file.buffer)
  if (refs.length === 0) {
    res.status(400).json({ error: 'Nenhuma referência encontrada no arquivo' }); return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Busca produtos correspondentes (todas as tabelas da fábrica, prioriza mais recente)
    const { rows: sourceProducts } = await client.query(`
      SELECT DISTINCT ON (p.reference)
        p.id AS source_id, p.reference, p.product_name, p.model, p.size_range,
        p.base_price, p.type, p.category, p.observation, p.image_url, p.blocked_sizes
      FROM products p
      JOIN price_tables pt ON pt.id = p.price_table_id
      WHERE p.reference = ANY($1)
        AND pt.factory_id = $2
        AND p.active = true
        AND pt.active = true
        AND pt.id != $3
      ORDER BY p.reference, pt.created_at DESC
    `, [refs, pe.fac_id, pe.price_table_id])

    const found     = sourceProducts.map(p => p.reference)
    const notFound  = refs.filter(r => !found.includes(r))

    // Referências sem foto NÃO entram no catálogo de Pronta Entrega — são eliminadas automaticamente
    const hasPhoto   = (p: { image_url: string | null }) => !!(p.image_url && String(p.image_url).trim() !== '')
    const withPhoto  = sourceProducts.filter(hasPhoto)
    const noPhoto    = sourceProducts.filter(p => !hasPhoto(p)).map(p => p.reference)

    // Limpa produtos antigos do PE
    await client.query('DELETE FROM grade_configs WHERE product_id IN (SELECT id FROM products WHERE price_table_id=$1)', [pe.price_table_id])
    await client.query('DELETE FROM products WHERE price_table_id=$1', [pe.price_table_id])

    // Insere produtos novos (somente os que possuem foto)
    for (const p of withPhoto) {
      const { rows: [np] } = await client.query(`
        INSERT INTO products
          (price_table_id, reference, product_name, model, size_range,
           base_price, type, category, observation, image_url, blocked_sizes, active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
        RETURNING id
      `, [pe.price_table_id, p.reference, p.product_name, p.model, p.size_range,
          p.base_price, p.type, p.category, p.observation, p.image_url, p.blocked_sizes])

      // Copia grade_configs (packs)
      await client.query(`
        INSERT INTO grade_configs (product_id, color, sizes, total_pieces, sort_order)
        SELECT $1, color, sizes, total_pieces, sort_order
        FROM grade_configs WHERE product_id = $2
      `, [np.id, p.source_id])
    }

    // Atualiza contagem e data de importação
    await client.query(
      `UPDATE pe_catalogs SET item_count=$1, last_import_at=NOW(), updated_at=NOW() WHERE id=$2`,
      [withPhoto.length, id]
    )

    await client.query('COMMIT')
    res.json({
      ok: true,
      imported: withPhoto.length,
      not_found: notFound,
      no_photo: noPhoto,
      refs_in_file: refs.length,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Erro ao importar Excel' })
  } finally {
    client.release()
  }
}

// ─── Toggle ativo ────────────────────────────────────────────────────────────

export async function togglePeCatalog(req: AuthRequest, res: Response) {
  const { rows: [pe] } = await query('SELECT id, active, portal_id FROM pe_catalogs WHERE id=$1', [req.params.id])
  if (!pe) { res.status(404).json({ error: 'Catálogo PE não encontrado' }); return }

  const newActive = !pe.active
  await query('UPDATE pe_catalogs SET active=$1, updated_at=NOW() WHERE id=$2', [newActive, pe.id])
  if (pe.portal_id) {
    await query('UPDATE customer_portals SET active=$1 WHERE id=$2', [newActive, pe.portal_id])
  }
  res.json({ active: newActive })
}

// ─── Excluir ────────────────────────────────────────────────────────────────

export async function deletePeCatalog(req: AuthRequest, res: Response) {
  const { rows: [pe] } = await query(
    'SELECT id, price_table_id, portal_id FROM pe_catalogs WHERE id=$1', [req.params.id]
  )
  if (!pe) { res.status(404).json({ error: 'Catálogo PE não encontrado' }); return }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // O registro pe_catalogs referencia customer_portals via portal_id (sem cascade),
    // então precisa ser removido ANTES do portal — caso contrário o banco rejeita a
    // exclusão do portal por violação de chave estrangeira (e toda a operação falha)
    await client.query('DELETE FROM pe_catalogs WHERE id=$1', [pe.id])

    if (pe.price_table_id) {
      await client.query('DELETE FROM grade_configs WHERE product_id IN (SELECT id FROM products WHERE price_table_id=$1)', [pe.price_table_id])
      await client.query('DELETE FROM products WHERE price_table_id=$1', [pe.price_table_id])
      await client.query('DELETE FROM price_tables WHERE id=$1', [pe.price_table_id])
    }
    if (pe.portal_id) await client.query('DELETE FROM customer_portals WHERE id=$1', [pe.portal_id])

    await client.query('COMMIT')
    res.status(204).send()
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Erro ao excluir catálogo PE:', err)
    res.status(500).json({ error: 'Erro ao excluir catálogo PE' })
  } finally {
    client.release()
  }
}
