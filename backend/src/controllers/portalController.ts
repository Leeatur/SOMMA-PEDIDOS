import { Request, Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'
import crypto from 'crypto'

// ─── Rotas autenticadas (gerenciamento pelo rep) ──────────────────────────────

export async function listPortals(req: AuthRequest, res: Response) {
  const repId = req.user!.role === 'admin' ? req.query.rep_id || req.user!.id : req.user!.id
  const { rows } = await query(
    `SELECT cp.*, u.name as rep_name,
       array_agg(DISTINCT f.name) FILTER (WHERE f.id IS NOT NULL) AS factory_names,
       (
         SELECT json_agg(
           json_build_object('id', pt.id, 'name', pt.name, 'factory_name', f2.name)
           ORDER BY f2.name, pt.name
         )
         FROM price_tables pt
         JOIN factories f2 ON f2.id = pt.factory_id
         WHERE pt.id = ANY(cp.price_table_ids) AND pt.active = true
       ) AS price_table_info
     FROM customer_portals cp
     LEFT JOIN users u ON u.id = cp.rep_id
     LEFT JOIN unnest(cp.factory_ids) fid ON true
     LEFT JOIN factories f ON f.id = fid
     WHERE cp.rep_id = $1
       AND NOT EXISTS (SELECT 1 FROM pe_catalogs pe WHERE pe.portal_id = cp.id)
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
  const isAdmin = req.user!.role === 'admin'
  const { rows: [portal] } = await query(
    'SELECT id, rep_id FROM customer_portals WHERE id=$1', [req.params.id]
  )
  if (!portal) { res.status(404).json({ error: 'Catálogo não encontrado' }); return }
  if (!isAdmin && portal.rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Sem permissão' }); return
  }
  // Bloqueia exclusão de portais vinculados a PE (devem ser excluídos pela aba Pronta Entrega)
  const { rows: [pe] } = await query('SELECT id FROM pe_catalogs WHERE portal_id=$1', [portal.id])
  if (pe) { res.status(409).json({ error: 'Este link pertence a um catálogo de Pronta Entrega. Exclua pela aba Pronta Entrega.' }); return }

  await query('DELETE FROM customer_portals WHERE id=$1', [portal.id])
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

// Helper: busca produtos + grade_configs de uma lista de tableIds
async function fetchCatalogProducts(tableIds: string[]) {
  if (!tableIds.length) return []
  const { rows } = await query(
    `SELECT p.id, p.reference, p.product_name, p.model, p.size_range, p.base_price,
            p.type, p.image_url, p.observation, p.price_table_id, p.blocked_sizes,
            COALESCE(
              (SELECT json_agg(json_build_object('color',gc.color,'sizes',gc.sizes,'total_pieces',gc.total_pieces) ORDER BY gc.sort_order)
               FROM grade_configs gc WHERE gc.product_id = p.id),
              '[]'::json
            ) AS grade_configs
     FROM products p
     WHERE p.price_table_id = ANY($1) AND p.active = true
     ORDER BY p.reference`,
    [tableIds]
  )
  return rows
}

// GET /public/portal/:token — info do portal + catálogo completo em um único request
export async function getPortalInfo(req: Request, res: Response) {
  const portal = await getPortal(req.params.token)
  if (!portal) { res.status(404).json({ error: 'Link inválido ou expirado' }); return }

  // Catálogos de Pronta Entrega têm pedido mínimo de R$ 2.500,00 — links normais não têm mínimo
  const { rows: [pe] } = await query('SELECT id FROM pe_catalogs WHERE portal_id=$1', [portal.id])
  // Texto institucional (condições + política de troca) — reusa o "Rodapé do pedido" (company_settings.order_footer)
  const { rows: [footerRow] } = await query(`SELECT value FROM company_settings WHERE key='order_footer'`)
  const portalMeta = { id: portal.id, name: portal.name, rep_name: portal.rep_name, is_pe: !!pe, terms: footerRow?.value || null }

  // Fluxo principal: tabelas específicas → retorna catálogo completo de uma vez
  if (portal.price_table_ids?.length > 0) {
    const { rows: priceTables } = await query(
      `SELECT pt.id, pt.name, pt.collection, pt.season, pt.year,
              f.id as factory_id, f.name as factory_name, f.logo_url
       FROM price_tables pt JOIN factories f ON f.id = pt.factory_id
       WHERE pt.id = ANY($1) AND pt.active = true
       ORDER BY f.name, pt.name`,
      [portal.price_table_ids]
    )
    const products = await fetchCatalogProducts(priceTables.map((t: { id: string }) => t.id))
    const tables = priceTables.map((t: Record<string, unknown>) => ({
      ...t,
      products: products.filter((p: { price_table_id: string }) => p.price_table_id === t.id),
    }))
    res.json({ portal: portalMeta, price_tables: tables, factories: [] })
    return
  }

  // Fluxo legado: filtra por fábricas → retorna catálogo completo também
  const { rows: factories } = await query(
    portal.factory_ids?.length > 0
      ? `SELECT f.id, f.name, f.logo_url FROM factories f WHERE f.id = ANY($1) AND f.active=true ORDER BY f.name`
      : `SELECT f.id, f.name, f.logo_url FROM factories f WHERE f.active=true ORDER BY f.name`,
    portal.factory_ids?.length > 0 ? [portal.factory_ids] : []
  )

  // Busca tabelas e produtos das fábricas
  if (factories.length > 0) {
    const factoryIds = factories.map((f: { id: string }) => f.id)
    const { rows: priceTables } = await query(
      `SELECT pt.id, pt.name, pt.collection, pt.season, pt.year,
              f.id as factory_id, f.name as factory_name, f.logo_url
       FROM price_tables pt JOIN factories f ON f.id = pt.factory_id
       WHERE pt.factory_id = ANY($1) AND pt.active = true
       ORDER BY f.name, pt.name`,
      [factoryIds]
    )
    const products = await fetchCatalogProducts(priceTables.map((t: { id: string }) => t.id))
    const tables = priceTables.map((t: Record<string, unknown>) => ({
      ...t,
      products: products.filter((p: { price_table_id: string }) => p.price_table_id === t.id),
    }))
    res.json({ portal: portalMeta, factories, price_tables: tables })
    return
  }

  res.json({ portal: portalMeta, factories: [], price_tables: [] })
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
      headers: { 'User-Agent': 'SommaFV/1.0' },
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
            p.blocked_sizes,
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

  const { cnpj, client_name, trade_name, address, city, state, zip, phone, whatsapp, email,
          price_table_id, factory_id, discount_pct, notes, items, payment_terms } = req.body

  if (!cnpj || !client_name || !price_table_id || !factory_id || !items?.length) {
    res.status(400).json({ error: 'Dados obrigatórios faltando' }); return
  }
  // E-mail e WhatsApp obrigatórios no portal (cliente novo precisa deixar contato)
  if (!email || !whatsapp) {
    res.status(400).json({ error: 'E-mail e WhatsApp são obrigatórios' }); return
  }

  // Pedido mínimo (validação espelhada no backend): PE usa R$ 2.500 fixo;
  // catálogo normal usa MIN_ORDER_VALUE (env, por instância — NXO = 2500). Default 0 = sem mínimo.
  const PE_MIN_ORDER_VALUE = 2500
  const { rows: [peCatalog] } = await query('SELECT id FROM pe_catalogs WHERE portal_id=$1', [portal.id])
  const minOrderValue = peCatalog ? PE_MIN_ORDER_VALUE : (Number(process.env.MIN_ORDER_VALUE) || 0)
  if (minOrderValue > 0) {
    const cartSubtotal = items.reduce((s: number, it: { unit_price?: number; total_pieces?: number }) =>
      s + (Number(it.unit_price) || 0) * (Number(it.total_pieces) || 0), 0)
    if (cartSubtotal < minOrderValue) {
      res.status(400).json({ error: `Pedido mínimo de R$ ${minOrderValue.toFixed(2).replace('.', ',')}. Seu pedido está em R$ ${cartSubtotal.toFixed(2).replace('.', ',')}.` })
      return
    }
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
       phone=COALESCE($7, phone), whatsapp=COALESCE($8, whatsapp), email=COALESCE($9, email), updated_at=NOW() WHERE id=$10`,
      [client_name, trade_name||null, address||null, city||null, state||null, zip||null, phone||null, whatsapp||null, email||null, existingClient.id]
    )
    clientId = existingClient.id
  } else {
    // Cliente novo — insere
    const { rows: [newClient] } = await query(
      `INSERT INTO clients (name, trade_name, cnpj, address, city, state, zip, phone, whatsapp, email, rep_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [client_name, trade_name||null, cnpjClean, address||null, city||null, state||null, zip||null, phone||null, whatsapp||null, email||null, portal.rep_id]
    )
    if (!newClient) { res.status(500).json({ error: 'Erro ao criar cliente' }); return }
    clientId = newClient.id
  }

  // Status inicial
  const { rows: [initialStatus] } = await query('SELECT id FROM order_statuses WHERE is_initial=true AND active=true LIMIT 1')

  const discPct = parseFloat(discount_pct) || 0

  // Busca regra de comissão mais próxima do desconto aplicado
  const { rows: commRules } = await query(
    `SELECT * FROM discount_commission_rules WHERE price_table_id=$1
     ORDER BY ABS(discount_pct - $2) ASC LIMIT 1`,
    [price_table_id, discPct]
  )
  const commRule = commRules[0] || { total_commission_pct: 0, rep_commission_pct: 0, office_commission_pct: 0, guide_commission_pct: 0 }

  const { rows: [repUser] } = await query('SELECT role FROM users WHERE id=$1', [portal.rep_id])
  const isAdminRep = repUser?.role === 'admin'

  const { rows: [order] } = await query(
    `INSERT INTO orders (client_id, rep_id, factory_id, price_table_id, status_id, discount_pct, notes, freight_type,
       payment_terms, total_commission_pct, rep_commission_pct, office_commission_pct, guide_commission_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'CIF',$8,$9,$10,$11,$12) RETURNING *`,
    [clientId, portal.rep_id, factory_id, price_table_id, initialStatus?.id || null, discPct, notes||null,
     payment_terms || null,
     commRule.total_commission_pct,
     isAdminRep ? 0 : commRule.rep_commission_pct,
     isAdminRep ? commRule.total_commission_pct : commRule.office_commission_pct,
     isAdminRep ? 0 : (Number(commRule.guide_commission_pct) || 0)]
  )

  // Insere itens — comissão calculada sobre o preço CHEIO (sem desconto à vista)
  // unit_price/original_unit_price ficam com o preço de TABELA (cheio); o Desconto à Vista
  // (discount_pct, salvo no pedido) é aplicado depois no momento de exibir/imprimir —
  // exatamente a mesma lógica usada para pedidos normais (computeOrderTotals/createOrder).
  let totalPieces = 0; let totalValue = 0; let totalValueFull = 0
  for (const item of items) {
    const discountedPrice = item.unit_price * (1 - discPct/100)
    const pieces = item.total_pieces || 0
    const subtotal = Math.round(discountedPrice * pieces * 100) / 100
    const subtotalFull = Math.round(item.unit_price * pieces * 100) / 100
    totalPieces += pieces; totalValue += subtotal; totalValueFull += subtotalFull

    // Grade real escolhida pelo cliente: "sizes" (produto regular) ou "custom_grade" (pack)
    const sizesMap = item.sizes && typeof item.sizes === 'object' && Object.keys(item.sizes).length > 0
      ? item.sizes
      : null
    const customGradeArr = Array.isArray(item.grade) && item.grade.length > 0 ? item.grade : null

    await query(
      `INSERT INTO order_items (order_id, product_id, reference, boxes_count, unit_price, original_unit_price, total_pieces, subtotal, sizes, custom_grade)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9)`,
      [order.id, item.product_id, item.reference, item.boxes_count||1, item.unit_price, pieces, subtotal,
       sizesMap ? JSON.stringify(sizesMap) : null,
       customGradeArr ? JSON.stringify(customGradeArr) : null]
    )
  }

  // Comissão sobre preço cheio (sem desconto à vista)
  const repCommVal   = isAdminRep ? 0 : Math.round(totalValueFull * commRule.rep_commission_pct / 100 * 100) / 100
  const offCommVal   = isAdminRep
    ? Math.round(totalValueFull * commRule.total_commission_pct / 100 * 100) / 100
    : Math.round(totalValueFull * commRule.office_commission_pct / 100 * 100) / 100
  const guideCommVal = isAdminRep ? 0 : Math.round(totalValueFull * (Number(commRule.guide_commission_pct) || 0) / 100 * 100) / 100

  await query(
    `UPDATE orders SET total_pieces=$1, total_value=$2, rep_commission_value=$3, office_commission_value=$4, guide_commission_value=$5 WHERE id=$6`,
    [totalPieces, Math.round(totalValue * 100) / 100, repCommVal, offCommVal, guideCommVal, order.id]
  )
  res.status(201).json({ order_id: order.id, order_number: order.order_number, total_value: totalValue })
}
