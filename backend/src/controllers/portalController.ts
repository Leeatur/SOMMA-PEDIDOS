import { Request, Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'
import crypto from 'crypto'

// ─── Rotas autenticadas (gerenciamento pelo rep) ──────────────────────────────

export async function listPortals(req: AuthRequest, res: Response) {
  const repId = req.user!.role === 'admin' ? req.query.rep_id || req.user!.id : req.user!.id
  const { rows } = await query(
    `SELECT cp.*, u.name as rep_name,
       array_agg(f.name ORDER BY f.name) FILTER (WHERE f.id IS NOT NULL) AS factory_names
     FROM customer_portals cp
     LEFT JOIN users u ON u.id = cp.rep_id
     LEFT JOIN unnest(cp.factory_ids) fid ON true
     LEFT JOIN factories f ON f.id = fid
     WHERE cp.rep_id = $1
     GROUP BY cp.id, u.name
     ORDER BY cp.created_at DESC`,
    [repId]
  )
  res.json(rows)
}

export async function createPortal(req: AuthRequest, res: Response) {
  const { name, factory_ids, price_table_ids, expires_at } = req.body
  if (!name) { res.status(400).json({ error: 'Nome é obrigatório' }); return }
  const token = crypto.randomBytes(24).toString('hex')
  const repId = req.user!.id
  const { rows: [portal] } = await query(
    `INSERT INTO customer_portals (rep_id, factory_ids, price_table_ids, token, name, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [repId, factory_ids || [], price_table_ids || [], token, name, expires_at || null]
  )
  res.status(201).json(portal)
}

export async function updatePortal(req: AuthRequest, res: Response) {
  const { name, factory_ids, active, expires_at } = req.body
  const { rows: [existing] } = await query(
    'SELECT rep_id FROM customer_portals WHERE id=$1', [req.params.id]
  )
  if (!existing) { res.status(404).json({ error: 'Portal não encontrado' }); return }
  if (existing.rep_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Sem permissão' }); return
  }
  const { rows: [portal] } = await query(
    `UPDATE customer_portals SET name=$1, factory_ids=$2, active=$3, expires_at=$4, updated_at=NOW()
     WHERE id=$5 RETURNING *`,
    [name, factory_ids || [], active ?? true, expires_at || null, req.params.id]
  )
  res.json(portal)
}

export async function deletePortal(req: AuthRequest, res: Response) {
  await query('DELETE FROM customer_portals WHERE id=$1 AND rep_id=$2', [req.params.id, req.user!.id])
  res.status(204).send()
}

// ─── Rotas PÚBLICAS (cliente sem login) ──────────────────────────────────────

async function getPortal(token: string) {
  const { rows: [portal] } = await query(
    `SELECT cp.*, u.name as rep_name, u.email as rep_email
     FROM customer_portals cp
     JOIN users u ON u.id = cp.rep_id
     WHERE cp.token = $1 AND cp.active = true
       AND (cp.expires_at IS NULL OR cp.expires_at > NOW())`,
    [token]
  )
  return portal
}

// GET /public/portal/:token — info do portal (nome rep, fábricas disponíveis)
export async function getPortalInfo(req: Request, res: Response) {
  const portal = await getPortal(req.params.token)
  if (!portal) { res.status(404).json({ error: 'Link inválido ou expirado' }); return }

  // Se tem tabelas específicas, retorna apenas elas
  if (portal.price_table_ids?.length > 0) {
    const { rows: priceTables } = await query(
      `SELECT pt.id, pt.name, pt.collection, pt.season, pt.year, f.id as factory_id, f.name as factory_name, f.logo_url
       FROM price_tables pt JOIN factories f ON f.id=pt.factory_id
       WHERE pt.id = ANY($1) AND pt.active=true ORDER BY f.name, pt.name`,
      [portal.price_table_ids]
    )
    res.json({ portal: { id: portal.id, name: portal.name, rep_name: portal.rep_name }, price_tables: priceTables, factories: [] })
    return
  }

  // Fallback: filtra por fábricas
  const { rows: factories } = await query(
    portal.factory_ids?.length > 0
      ? `SELECT f.id, f.name, f.logo_url FROM factories f WHERE f.id = ANY($1) AND f.active=true ORDER BY f.name`
      : `SELECT f.id, f.name, f.logo_url FROM factories f WHERE f.active=true ORDER BY f.name`,
    portal.factory_ids?.length > 0 ? [portal.factory_ids] : []
  )
  res.json({ portal: { id: portal.id, name: portal.name, rep_name: portal.rep_name }, factories, price_tables: [] })
}

// POST /public/portal/:token/lookup-cnpj — valida CNPJ e retorna dados do cliente
export async function portalLookupCnpj(req: Request, res: Response) {
  const portal = await getPortal(req.params.token)
  if (!portal) { res.status(404).json({ error: 'Link inválido ou expirado' }); return }

  const cnpj = (req.body.cnpj || '').replace(/\D/g, '')
  if (cnpj.length !== 14) { res.status(400).json({ error: 'CNPJ inválido' }); return }

  try {
    // Busca dados na Receita Federal
    const rfRes = await fetch(`https://minhareceita.org/${cnpj}`, {
      headers: { 'User-Agent': 'SommaGestaoComercial/1.0' },
      signal: AbortSignal.timeout(12000),
    })
    if (!rfRes.ok) { res.status(404).json({ error: 'CNPJ não encontrado na Receita Federal' }); return }
    const rf = await rfRes.json() as Record<string, unknown>

    // Verifica se já é cliente cadastrado
    const { rows: [existing] } = await query(
      `SELECT id, name, trade_name, city, state, phone, whatsapp, email, address, zip FROM clients
       WHERE cnpj ILIKE $1 AND active=true LIMIT 1`,
      [`%${cnpj}%`]
    )
    const phone = rf.ddd_telefone_1
      ? `(${String(rf.ddd_telefone_1).slice(0,2)}) ${String(rf.ddd_telefone_1).slice(2)}`
      : null

    res.json({
      cnpj,
      razao_social: rf.razao_social,
      nome_fantasia: rf.nome_fantasia || null,
      address: [rf.logradouro, rf.numero, rf.complemento].filter(Boolean).join(', '),
      city: rf.municipio,
      state: rf.uf,
      zip: rf.cep,
      phone,
      email: rf.email || null,
      situacao: rf.descricao_situacao_cadastral,
      existing_client: existing || null,
    })
  } catch { res.status(502).json({ error: 'Erro ao consultar CNPJ. Tente novamente.' }) }
}

// GET /public/portal/:token/catalog?factory_id= — produtos disponíveis
export async function getPortalCatalog(req: Request, res: Response) {
  const portal = await getPortal(req.params.token)
  if (!portal) { res.status(404).json({ error: 'Link inválido ou expirado' }); return }

  const { factory_id, price_table_id } = req.query as Record<string, string>

  // Prioridade: price_table_ids > factory_ids
  const allowedPriceTables = portal.price_table_ids?.length > 0 ? portal.price_table_ids : null
  const allowedFactories   = !allowedPriceTables && portal.factory_ids?.length > 0 ? portal.factory_ids : null

  let ptWhere = 'WHERE pt.active=true'
  const params: unknown[] = []

  if (allowedPriceTables) {
    ptWhere += ` AND pt.id = ANY($${params.length + 1})`; params.push(allowedPriceTables)
  } else if (allowedFactories) {
    ptWhere += ` AND pt.factory_id = ANY($${params.length + 1})`; params.push(allowedFactories)
  }
  if (factory_id && !allowedPriceTables) {
    ptWhere += ` AND pt.factory_id = $${params.length + 1}`; params.push(factory_id)
  }
  if (price_table_id) {
    ptWhere += ` AND pt.id = $${params.length + 1}`; params.push(price_table_id)
  }

  const { rows: priceTables } = await query(
    `SELECT pt.id, pt.name, pt.collection, pt.season, pt.year, f.id as factory_id, f.name as factory_name, f.logo_url
     FROM price_tables pt JOIN factories f ON f.id=pt.factory_id
     ${ptWhere} ORDER BY f.name, pt.name`,
    params
  )

  if (priceTables.length === 0) { res.json({ price_tables: [] }); return }

  const tableIds = priceTables.map(t => t.id)
  const { rows: products } = await query(
    `SELECT p.id, p.reference, p.product_name, p.model, p.size_range, p.base_price,
            p.type, p.image_url, p.observation, p.price_table_id,
       (SELECT json_agg(json_build_object('color', gc.color, 'sizes', gc.sizes, 'total_pieces', gc.total_pieces) ORDER BY gc.sort_order)
        FROM grade_configs gc WHERE gc.product_id=p.id) AS grade_configs
     FROM products p
     WHERE p.price_table_id = ANY($1) AND p.active=true
     ORDER BY p.reference`,
    [tableIds]
  )

  const tables = priceTables.map(t => ({
    ...t,
    products: products.filter(p => p.price_table_id === t.id),
  }))
  res.json({ price_tables: tables })
}

// POST /public/portal/:token/order — cria pedido pelo cliente
export async function submitPortalOrder(req: Request, res: Response) {
  const portal = await getPortal(req.params.token)
  if (!portal) { res.status(404).json({ error: 'Link inválido ou expirado' }); return }

  const { cnpj, client_name, trade_name, address, city, state, zip, phone, email,
          price_table_id, factory_id, discount_pct, notes, items } = req.body

  if (!cnpj || !client_name || !price_table_id || !factory_id || !items?.length) {
    res.status(400).json({ error: 'Dados obrigatórios faltando' }); return
  }

  // Verifica se a fábrica é permitida
  if (portal.factory_ids.length > 0 && !portal.factory_ids.includes(factory_id)) {
    res.status(403).json({ error: 'Fábrica não autorizada' }); return
  }

  // Busca cliente existente pelo CNPJ (sem precisar de constraint UNIQUE)
  const cnpjClean = cnpj.replace(/\D/g, '')
  const { rows: [existingClient] } = await query(
    `SELECT id FROM clients WHERE REGEXP_REPLACE(cnpj, '[^0-9]', '', 'g') = $1 AND active=true LIMIT 1`,
    [cnpjClean]
  )

  let clientId: string
  if (existingClient) {
    // Cliente já existe — atualiza dados e usa o ID existente
    await query(
      `UPDATE clients SET name=$1, trade_name=$2, address=$3, city=$4, state=$5, zip=$6,
       phone=COALESCE($7, phone), email=COALESCE($8, email), updated_at=NOW() WHERE id=$9`,
      [client_name, trade_name||null, address||null, city||null, state||null, zip||null, phone||null, email||null, existingClient.id]
    )
    clientId = existingClient.id
  } else {
    // Cliente novo — insere
    const { rows: [newClient] } = await query(
      `INSERT INTO clients (name, trade_name, cnpj, address, city, state, zip, phone, email, rep_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [client_name, trade_name||null, cnpjClean, address||null, city||null, state||null, zip||null, phone||null, email||null, portal.rep_id]
    )
    if (!newClient) { res.status(500).json({ error: 'Erro ao criar cliente' }); return }
    clientId = newClient.id
  }

  // Status inicial
  const { rows: [initialStatus] } = await query('SELECT id FROM order_statuses WHERE is_initial=true AND active=true LIMIT 1')

  const discPct = parseFloat(discount_pct) || 0
  const { rows: [order] } = await query(
    `INSERT INTO orders (client_id, rep_id, factory_id, price_table_id, status_id, discount_pct, notes, freight_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'CIF') RETURNING *`,
    [clientId, portal.rep_id, factory_id, price_table_id, initialStatus?.id || null, discPct, notes||null]
  )

  // Insere itens
  let totalPieces = 0; let totalValue = 0
  for (const item of items) {
    const discountedPrice = item.unit_price * (1 - discPct/100)
    const pieces = item.total_pieces || 0
    const subtotal = discountedPrice * pieces
    totalPieces += pieces; totalValue += subtotal
    await query(
      `INSERT INTO order_items (order_id, product_id, reference, boxes_count, unit_price, total_pieces, subtotal, custom_grade)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [order.id, item.product_id, item.reference, item.boxes_count||1, item.unit_price, pieces, subtotal, JSON.stringify(item.grade||null)]
    )
  }

  await query('UPDATE orders SET total_pieces=$1, total_value=$2 WHERE id=$3', [totalPieces, totalValue, order.id])
  res.status(201).json({ order_id: order.id, order_number: order.order_number, total_value: totalValue })
}
