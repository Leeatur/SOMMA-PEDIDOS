import { Response } from 'express'
import { query, pool } from '../config/database'
import { AuthRequest } from '../middleware/auth'
import { PoolClient } from 'pg'

interface OrderItem {
  product_id: string
  reference: string
  boxes_count: number
  unit_price: number
  sizes?: Record<string, number> | null
}

async function computeOrderTotals(
  items: OrderItem[],
  discountPct: number,
  priceTableId: string,
  client: PoolClient
) {
  let totalPieces = 0
  let totalValue = 0
  const enrichedItems = []

  for (const item of items) {
    let itemPieces: number
    const sizesMap = item.sizes && typeof item.sizes === 'object' ? item.sizes : {}
    const sizesTotal = Object.values(sizesMap).reduce((s: number, v: unknown) => s + Number(v || 0), 0)

    let subtotal: number
    const discountedPrice = item.unit_price * (1 - discountPct / 100)

    if (sizesTotal > 0) {
      // Produto regular: qtde de peças = soma dos tamanhos escolhidos
      itemPieces = sizesTotal
      subtotal = discountedPrice * itemPieces
    } else {
      // Pack: unit_price é o preço da CAIXA; subtotal = preço_caixa × qtd_caixas
      // total_pieces = total de peças físicas (para exibição)
      const { rows: grades } = await client.query(
        'SELECT total_pieces FROM grade_configs WHERE product_id=$1', [item.product_id]
      )
      const piecesPerBox = grades.reduce((sum: number, g: { total_pieces: number }) => sum + g.total_pieces, 0) || 1
      const boxCount = item.boxes_count || 1
      itemPieces = boxCount * piecesPerBox
      subtotal = discountedPrice * boxCount  // preço da caixa × nº de caixas
    }

    totalPieces += itemPieces
    totalValue += subtotal
    enrichedItems.push({
      ...item,
      total_pieces: itemPieces,
      subtotal,
      unit_price: item.unit_price,
      sizes: sizesTotal > 0 ? sizesMap : null,
      boxes_count: sizesTotal > 0 ? 1 : (item.boxes_count || 1),
    })
  }

  // Comissão baseada na regra mais próxima
  const { rows: rules } = await (client as any).query(
    `SELECT * FROM discount_commission_rules WHERE price_table_id=$1
     ORDER BY ABS(discount_pct - $2) LIMIT 1`,
    [priceTableId, discountPct]
  )
  const rule = rules[0] || { total_commission_pct: 0, rep_commission_pct: 0, office_commission_pct: 0 }

  return {
    enrichedItems,
    totalPieces,
    totalValue: Math.round(totalValue * 100) / 100,
    totalCommissionPct: rule.total_commission_pct,
    repCommissionPct: rule.rep_commission_pct,
    officeCommissionPct: rule.office_commission_pct,
    repCommissionValue: Math.round(totalValue * rule.rep_commission_pct / 100 * 100) / 100,
    officeCommissionValue: Math.round(totalValue * rule.office_commission_pct / 100 * 100) / 100,
  }
}

export async function listOrders(req: AuthRequest, res: Response) {
  const { status_id, factory_id, rep_id, date_from, date_to, search } = req.query
  const isAdmin = req.user!.role === 'admin'

  let sql = `
    SELECT o.*,
      c.name as client_name, c.trade_name as client_trade_name, c.city as client_city,
      u.name as rep_name,
      f.name as factory_name,
      pt.name as price_table_name,
      s.name as status_name, s.color as status_color
    FROM orders o
    JOIN clients c ON c.id = o.client_id
    JOIN users u ON u.id = o.rep_id
    JOIN factories f ON f.id = o.factory_id
    JOIN price_tables pt ON pt.id = o.price_table_id
    LEFT JOIN order_statuses s ON s.id = o.status_id
    WHERE o.deleted_at IS NULL
  `
  const params: unknown[] = []
  let idx = 1
  if (!isAdmin) { sql += ` AND o.rep_id = $${idx++}`; params.push(req.user!.id) }
  if (status_id) { sql += ` AND o.status_id = $${idx++}`; params.push(status_id) }
  if (factory_id) { sql += ` AND o.factory_id = $${idx++}`; params.push(factory_id) }
  if (rep_id && isAdmin) { sql += ` AND o.rep_id = $${idx++}`; params.push(rep_id) }
  if (date_from) { sql += ` AND o.created_at >= $${idx++}`; params.push(date_from) }
  if (date_to) { sql += ` AND o.created_at <= $${idx++}`; params.push(date_to) }
  if (search) {
    sql += ` AND (c.name ILIKE $${idx} OR o.order_number::text = $${idx+1})`
    params.push(`%${search}%`, search)
    idx += 2
  }
  sql += ' ORDER BY o.created_at DESC'
  const { rows } = await query(sql, params)
  res.json(rows)
}

export async function getOrder(req: AuthRequest, res: Response) {
  const { rows } = await query(
    `SELECT o.*,
      c.name as client_name, c.trade_name as client_trade_name,
      c.city as client_city, c.state as client_state,
      c.phone as client_phone, c.whatsapp as client_whatsapp,
      c.email as client_email, c.cnpj as client_cnpj,
      c.address as client_address, c.zip as client_zip,
      c.state_registration as client_state_registration,
      u.name as rep_name,
      f.name as factory_name, f.contact as factory_contact,
      pt.name as price_table_name,
      s.name as status_name, s.color as status_color
     FROM orders o
     JOIN clients c ON c.id = o.client_id
     JOIN users u ON u.id = o.rep_id
     JOIN factories f ON f.id = o.factory_id
     JOIN price_tables pt ON pt.id = o.price_table_id
     LEFT JOIN order_statuses s ON s.id = o.status_id
     WHERE o.id = $1`,
    [req.params.id]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Pedido não encontrado' }); return }
  const isAdmin = req.user!.role === 'admin'
  if (!isAdmin && rows[0].rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Acesso negado' }); return
  }

  const { rows: items } = await query(
    `SELECT oi.*,
       p.product_name, p.model, p.type, p.image_url,
       json_agg(gc ORDER BY gc.sort_order) FILTER (WHERE gc.id IS NOT NULL) as grade_configs
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN grade_configs gc ON gc.product_id = oi.product_id
     WHERE oi.order_id = $1
     GROUP BY oi.id, p.product_name, p.model, p.type, p.image_url
     ORDER BY oi.created_at`,
    [req.params.id]
  )

  const { rows: history } = await query(
    `SELECT h.*, u.name as changed_by_name,
       fs.name as from_status_name, ts.name as to_status_name, ts.color as to_status_color
     FROM order_status_history h
     JOIN users u ON u.id = h.changed_by
     LEFT JOIN order_statuses fs ON fs.id = h.from_status_id
     JOIN order_statuses ts ON ts.id = h.to_status_id
     WHERE h.order_id = $1 ORDER BY h.created_at DESC`,
    [req.params.id]
  )

  res.json({ ...rows[0], items, history })
}

export async function createOrder(req: AuthRequest, res: Response) {
  const {
    client_id, factory_id, price_table_id, items, discount_pct, notes, offline_id,
    payment_terms, freight_type, delivery_date, industry_order_number, buyer_name,
  } = req.body
  if (!client_id || !factory_id || !price_table_id || !items?.length) {
    res.status(400).json({ error: 'Dados incompletos' }); return
  }

  // Status inicial
  const { rows: [initStatus] } = await query(
    'SELECT id FROM order_statuses WHERE is_initial=true AND active=true ORDER BY sort_order LIMIT 1'
  )

  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    const disc = parseFloat(discount_pct) || 0
    const totals = await computeOrderTotals(items, disc, price_table_id, dbClient as any)

    const { rows: [order] } = await dbClient.query(
      `INSERT INTO orders
       (offline_id, client_id, rep_id, factory_id, price_table_id, status_id,
        discount_pct, total_commission_pct, rep_commission_pct, office_commission_pct,
        total_pieces, total_value, rep_commission_value, office_commission_value,
        notes, payment_terms, freight_type, delivery_date, industry_order_number, buyer_name,
        synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
       RETURNING *`,
      [offline_id||null, client_id, req.user!.id, factory_id, price_table_id,
       initStatus?.id||null, disc,
       totals.totalCommissionPct, totals.repCommissionPct, totals.officeCommissionPct,
       totals.totalPieces, totals.totalValue, totals.repCommissionValue, totals.officeCommissionValue,
       notes||null, payment_terms||null, freight_type||'CIF',
       delivery_date||null, industry_order_number||null, buyer_name||null]
    )

    for (const item of totals.enrichedItems) {
      await dbClient.query(
        `INSERT INTO order_items (order_id, product_id, reference, boxes_count, unit_price, total_pieces, subtotal, sizes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [order.id, item.product_id, item.reference, item.boxes_count, item.unit_price, item.total_pieces, item.subtotal,
         item.sizes ? JSON.stringify(item.sizes) : null]
      )
    }

    if (initStatus) {
      await dbClient.query(
        `INSERT INTO order_status_history (order_id, from_status_id, to_status_id, changed_by)
         VALUES ($1,NULL,$2,$3)`,
        [order.id, initStatus.id, req.user!.id]
      )
    }

    await dbClient.query('COMMIT')
    res.status(201).json(order)
  } catch (err) {
    await dbClient.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Erro ao criar pedido' })
  } finally {
    dbClient.release()
  }
}

export async function updateOrderStatus(req: AuthRequest, res: Response) {
  const { status_id, notes } = req.body
  if (!status_id) { res.status(400).json({ error: 'status_id obrigatório' }); return }

  const { rows: [order] } = await query('SELECT * FROM orders WHERE id=$1', [req.params.id])
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado' }); return }

  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')
    await dbClient.query(
      'UPDATE orders SET status_id=$1, updated_at=NOW() WHERE id=$2',
      [status_id, req.params.id]
    )
    await dbClient.query(
      `INSERT INTO order_status_history (order_id, from_status_id, to_status_id, changed_by, notes)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, order.status_id, status_id, req.user!.id, notes||null]
    )
    await dbClient.query('COMMIT')
    res.json({ message: 'Status atualizado' })
  } catch (err) {
    await dbClient.query('ROLLBACK')
    res.status(500).json({ error: 'Erro ao atualizar status' })
  } finally {
    dbClient.release()
  }
}

// Adiciona itens a um pedido existente e recalcula totais
export async function addOrderItems(req: AuthRequest, res: Response) {
  const { items } = req.body as { items: OrderItem[] }
  const orderId = req.params.id

  if (!items?.length) { res.status(400).json({ error: 'Nenhum item informado' }); return }

  const { rows: [order] } = await query('SELECT * FROM orders WHERE id=$1', [orderId])
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado' }); return }

  const isAdmin = req.user!.role === 'admin'
  if (!isAdmin && order.rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Acesso negado' }); return
  }

  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    // Insere os novos itens
    const disc = parseFloat(order.discount_pct) || 0
    const newTotals = await computeOrderTotals(items, disc, order.price_table_id, dbClient as any)
    for (const item of newTotals.enrichedItems) {
      await dbClient.query(
        `INSERT INTO order_items (order_id, product_id, reference, boxes_count, unit_price, total_pieces, subtotal, sizes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [orderId, item.product_id, item.reference, item.boxes_count, item.unit_price, item.total_pieces, item.subtotal,
         item.sizes ? JSON.stringify(item.sizes) : null]
      )
    }

    // Recalcula totais com TODOS os itens (antigos + novos)
    const { rows: allItems } = await dbClient.query(
      'SELECT product_id, reference, boxes_count, unit_price, sizes FROM order_items WHERE order_id=$1',
      [orderId]
    )
    const allTotals = await computeOrderTotals(allItems, disc, order.price_table_id, dbClient as any)

    await dbClient.query(
      `UPDATE orders SET
         total_pieces=$1, total_value=$2,
         rep_commission_value=$3, office_commission_value=$4,
         updated_at=NOW()
       WHERE id=$5`,
      [allTotals.totalPieces, allTotals.totalValue,
       allTotals.repCommissionValue, allTotals.officeCommissionValue, orderId]
    )

    await dbClient.query('COMMIT')
    res.json({ message: 'Itens adicionados', total_pieces: allTotals.totalPieces, total_value: allTotals.totalValue })
  } catch (err) {
    await dbClient.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Erro ao adicionar itens' })
  } finally {
    dbClient.release()
  }
}

// Atualiza campos de informação do pedido
export async function updateOrderInfo(req: AuthRequest, res: Response) {
  const { payment_terms, delivery_date, freight_type, notes, buyer_name, industry_order_number, client_id } = req.body
  const { rows: [order] } = await query('SELECT rep_id FROM orders WHERE id=$1', [req.params.id])
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado' }); return }
  const isAdmin = req.user!.role === 'admin'
  if (!isAdmin && order.rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Acesso negado' }); return
  }
  // Valida client_id se informado
  if (client_id) {
    const { rows: [cli] } = await query('SELECT id FROM clients WHERE id=$1 AND active=true', [client_id])
    if (!cli) { res.status(400).json({ error: 'Cliente não encontrado' }); return }
  }
  await query(
    `UPDATE orders SET
       payment_terms=$1, delivery_date=$2, freight_type=$3,
       notes=$4, buyer_name=$5, industry_order_number=$6,
       ${client_id ? 'client_id=$8,' : ''}
       updated_at=NOW()
     WHERE id=$7`,
    [
      payment_terms ?? null,
      delivery_date || null,
      freight_type || 'CIF',
      notes ?? null,
      buyer_name ?? null,
      industry_order_number ?? null,
      req.params.id,
      ...(client_id ? [client_id] : []),
    ]
  )
  res.json({ ok: true })
}

// Remove um item específico de um pedido e recalcula totais
export async function removeOrderItem(req: AuthRequest, res: Response) {
  const { id, item_id } = req.params
  const { rows: [order] } = await query('SELECT rep_id FROM orders WHERE id=$1 AND deleted_at IS NULL', [id])
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado' }); return }
  const isAdmin = req.user!.role === 'admin'
  if (!isAdmin && order.rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Acesso negado' }); return
  }
  const { rows: [item] } = await query('SELECT id FROM order_items WHERE id=$1 AND order_id=$2', [item_id, id])
  if (!item) { res.status(404).json({ error: 'Item não encontrado' }); return }

  await query('DELETE FROM order_items WHERE id=$1', [item_id])

  // Recalcula totais do pedido
  const { rows: [totals] } = await query(
    `SELECT COALESCE(SUM(total_pieces),0) AS pcs, COALESCE(SUM(subtotal),0) AS val
     FROM order_items WHERE order_id=$1`,
    [id]
  )
  const { rows: [o] } = await query('SELECT rep_commission_pct, office_commission_pct FROM orders WHERE id=$1', [id])
  const newValue = Number(totals.val)
  await query(
    `UPDATE orders SET total_pieces=$1, total_value=$2,
       rep_commission_value=$3, office_commission_value=$4, updated_at=NOW()
     WHERE id=$5`,
    [
      Number(totals.pcs),
      newValue,
      Math.round(newValue * o.rep_commission_pct / 100 * 100) / 100,
      Math.round(newValue * o.office_commission_pct / 100 * 100) / 100,
      id,
    ]
  )
  res.json({ ok: true })
}

// Troca a tabela de preços do pedido e recalcula todos os valores
export async function changeOrderPriceTable(req: AuthRequest, res: Response) {
  const { price_table_id, discount_pct } = req.body
  const orderId = req.params.id
  if (!price_table_id) { res.status(400).json({ error: 'price_table_id obrigatório' }); return }

  const { rows: [order] } = await query(
    'SELECT * FROM orders WHERE id=$1 AND deleted_at IS NULL', [orderId]
  )
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado' }); return }

  const isAdmin = req.user!.role === 'admin'
  if (!isAdmin && order.rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Acesso negado' }); return
  }

  // Valida que a nova tabela pertence à mesma fábrica
  const { rows: [pt] } = await query(
    'SELECT id, factory_id FROM price_tables WHERE id=$1 AND active=true', [price_table_id]
  )
  if (!pt) { res.status(400).json({ error: 'Tabela de preços não encontrada' }); return }
  if (pt.factory_id !== order.factory_id) {
    res.status(400).json({ error: 'A tabela deve ser da mesma fábrica do pedido' }); return
  }

  const disc = parseFloat(discount_pct) !== undefined && !isNaN(parseFloat(discount_pct))
    ? parseFloat(discount_pct)
    : parseFloat(order.discount_pct) || 0

  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    // Busca itens atuais
    const { rows: currentItems } = await dbClient.query(
      'SELECT id, reference, boxes_count, sizes, product_id FROM order_items WHERE order_id=$1',
      [orderId]
    )

    // Para cada item, busca o preço base na nova tabela (pela referência)
    const notFound: string[] = []
    for (const item of currentItems) {
      const { rows: [newProduct] } = await dbClient.query(
        'SELECT id, base_price FROM products WHERE price_table_id=$1 AND reference=$2',
        [price_table_id, item.reference]
      )
      if (!newProduct) {
        notFound.push(item.reference)
        continue
      }
      const newUnitPrice = Number(newProduct.base_price)
      const discountedPrice = newUnitPrice * (1 - disc / 100)
      const sizesMap = item.sizes && typeof item.sizes === 'object' ? item.sizes as Record<string,number> : {}
      const sizesTotal = Object.values(sizesMap).reduce((s, v) => s + Number(v || 0), 0)

      let itemPieces: number
      let subtotal: number
      if (sizesTotal > 0) {
        itemPieces = sizesTotal
        subtotal = discountedPrice * itemPieces
      } else {
        const { rows: grades } = await dbClient.query(
          'SELECT total_pieces FROM grade_configs WHERE product_id=$1', [newProduct.id]
        )
        const piecesPerBox = grades.reduce((s: number, g: {total_pieces:number}) => s + g.total_pieces, 0) || 1
        itemPieces = (item.boxes_count || 1) * piecesPerBox
        subtotal = discountedPrice * (item.boxes_count || 1)
      }

      await dbClient.query(
        `UPDATE order_items SET
           product_id=$1, unit_price=$2, subtotal=$3, total_pieces=$4
         WHERE id=$5`,
        [newProduct.id, newUnitPrice, Math.round(subtotal * 100) / 100, itemPieces, item.id]
      )
    }

    if (notFound.length > 0) {
      await dbClient.query('ROLLBACK')
      res.status(422).json({
        error: 'Alguns produtos não existem na nova tabela',
        missing: notFound,
      })
      return
    }

    // Recalcula totais do pedido com os novos preços
    const { rows: updatedItems } = await dbClient.query(
      'SELECT product_id, reference, boxes_count, unit_price, sizes FROM order_items WHERE order_id=$1',
      [orderId]
    )
    const totals = await computeOrderTotals(updatedItems, disc, price_table_id, dbClient as any)

    await dbClient.query(
      `UPDATE orders SET
         price_table_id=$1, discount_pct=$2,
         total_commission_pct=$3, rep_commission_pct=$4, office_commission_pct=$5,
         total_pieces=$6, total_value=$7,
         rep_commission_value=$8, office_commission_value=$9,
         updated_at=NOW()
       WHERE id=$10`,
      [
        price_table_id, disc,
        totals.totalCommissionPct, totals.repCommissionPct, totals.officeCommissionPct,
        totals.totalPieces, totals.totalValue,
        totals.repCommissionValue, totals.officeCommissionValue,
        orderId,
      ]
    )

    await dbClient.query('COMMIT')
    res.json({ ok: true, total_value: totals.totalValue, total_pieces: totals.totalPieces })
  } catch (err) {
    await dbClient.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Erro ao trocar tabela de preços' })
  } finally {
    dbClient.release()
  }
}

// Exclui um pedido (admin ou rep dono do pedido)
export async function deleteOrder(req: AuthRequest, res: Response) {
  const isAdmin = req.user!.role === 'admin'
  const { rows: [order] } = await query('SELECT rep_id FROM orders WHERE id=$1 AND deleted_at IS NULL', [req.params.id])
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado' }); return }
  if (!isAdmin && order.rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Acesso negado' }); return
  }
  // Soft delete — move para a lixeira em vez de apagar
  await query('UPDATE orders SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1', [req.params.id])
  res.json({ ok: true })
}

// Lista pedidos na lixeira (admin only)
export async function listTrashedOrders(req: AuthRequest, res: Response) {
  const { rows } = await query(
    `SELECT o.id, o.order_number, o.total_value, o.total_pieces, o.deleted_at, o.created_at,
       c.name as client_name, c.city as client_city,
       u.name as rep_name,
       f.name as factory_name
     FROM orders o
     JOIN clients c ON c.id = o.client_id
     JOIN users u ON u.id = o.rep_id
     JOIN factories f ON f.id = o.factory_id
     WHERE o.deleted_at IS NOT NULL
     ORDER BY o.deleted_at DESC`,
    []
  )
  res.json(rows)
}

// Restaura um pedido da lixeira (admin only)
export async function restoreOrder(req: AuthRequest, res: Response) {
  const { rows: [order] } = await query(
    'SELECT id FROM orders WHERE id=$1 AND deleted_at IS NOT NULL', [req.params.id]
  )
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado na lixeira' }); return }
  await query('UPDATE orders SET deleted_at=NULL, updated_at=NOW() WHERE id=$1', [req.params.id])
  res.json({ ok: true })
}

// Sync offline: recebe array de pedidos criados offline
export async function syncOfflineOrders(req: AuthRequest, res: Response) {
  const { orders: offlineOrders } = req.body
  if (!Array.isArray(offlineOrders)) {
    res.status(400).json({ error: 'orders deve ser um array' }); return
  }
  const results = []
  for (const ord of offlineOrders) {
    // Evita duplicatas via offline_id
    const { rows: [existing] } = await query(
      'SELECT id FROM orders WHERE offline_id=$1', [ord.offline_id]
    )
    if (existing) {
      results.push({ offline_id: ord.offline_id, synced: false, reason: 'Já sincronizado', order_id: existing.id })
      continue
    }
    // Cria o pedido normalmente
    const fakeReq = { ...req, body: ord } as AuthRequest
    let created = false
    await createOrder(fakeReq, {
      status: (code: number) => ({ json: (data: unknown) => { if (code < 300) { results.push({ offline_id: ord.offline_id, synced: true, ...data as object }); created = true } } }),
      json: (data: unknown) => { results.push({ offline_id: ord.offline_id, synced: true, ...data as object }); created = true },
    } as unknown as Response)
    if (!created) results.push({ offline_id: ord.offline_id, synced: false, reason: 'Erro ao criar' })
  }
  res.json({ results })
}
