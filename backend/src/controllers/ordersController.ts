import { Response } from 'express'
import { query, pool } from '../config/database'
import { AuthRequest } from '../middleware/auth'
import { PoolClient } from 'pg'

interface CustomGradeEntry { color: string | null; sizes: Record<string, number>; total_pieces: number }

interface OrderItem {
  product_id: string
  reference: string
  boxes_count: number
  unit_price: number
  sizes?: Record<string, number> | null
  custom_grade?: CustomGradeEntry[] | null
}

async function computeOrderTotals(
  items: OrderItem[],
  discountPct: number,
  priceTableId: string,
  client: PoolClient,
  commissionDiscountPct?: number  // desconto de prazo para lookup de comissão (opcional)
) {
  let totalPieces = 0
  let totalValue = 0       // valor com desconto à vista (o que o cliente paga)
  let totalValueFull = 0   // valor sem desconto (base de cálculo da comissão)
  const enrichedItems = []

  for (const item of items) {
    let itemPieces: number
    let subtotal: number
    let subtotalFull: number  // subtotal sem desconto à vista
    let finalBoxesCount: number
    let finalSizes: Record<string, number> | null

    const sizesMap = item.sizes && typeof item.sizes === 'object' ? item.sizes : {}
    const sizesTotal = Object.values(sizesMap).reduce((s: number, v: unknown) => s + Number(v || 0), 0)
    const discountedPrice = item.unit_price * (1 - discountPct / 100)
    const fullPrice = item.unit_price  // preço cheio para base de comissão

    if (sizesTotal > 0) {
      // Produto regular
      itemPieces = sizesTotal
      subtotal = discountedPrice * itemPieces
      subtotalFull = fullPrice * itemPieces
      finalBoxesCount = 1
      finalSizes = sizesMap
    } else if (item.custom_grade && Array.isArray(item.custom_grade) && item.custom_grade.length > 0) {
      // Pack com grade personalizada
      itemPieces = item.custom_grade.reduce((s, gc) =>
        s + Object.values(gc.sizes || {}).reduce((ss, v) => ss + Number(v || 0), 0), 0
      )
      subtotal = Math.round(discountedPrice * itemPieces * 100) / 100
      subtotalFull = Math.round(fullPrice * itemPieces * 100) / 100
      finalBoxesCount = 1
      finalSizes = null
    } else {
      // Pack padrão
      const { rows: grades } = await client.query(
        'SELECT total_pieces FROM grade_configs WHERE product_id=$1', [item.product_id]
      )
      const piecesPerBox = grades.reduce((sum: number, g: { total_pieces: number }) => sum + g.total_pieces, 0) || 1
      const boxCount = item.boxes_count || 1
      itemPieces = boxCount * piecesPerBox
      subtotal = Math.round(discountedPrice * itemPieces * 100) / 100
      subtotalFull = Math.round(fullPrice * itemPieces * 100) / 100
      finalBoxesCount = boxCount
      finalSizes = null
    }

    totalPieces += itemPieces
    totalValue += subtotal
    totalValueFull += subtotalFull
    enrichedItems.push({
      ...item,
      total_pieces: itemPieces,
      subtotal,
      unit_price: item.unit_price,
      sizes: finalSizes,
      boxes_count: finalBoxesCount,
    })
  }

  // Busca a regra de comissão pelo desconto de PRAZO (não inclui desconto à vista)
  // Se commissionDiscountPct não informado, usa discountPct (compatibilidade)
  const commPct = commissionDiscountPct !== undefined ? commissionDiscountPct : discountPct
  const { rows: rules } = await (client as any).query(
    `SELECT * FROM discount_commission_rules WHERE price_table_id=$1
     ORDER BY ABS(discount_pct - $2) ASC LIMIT 1`,
    [priceTableId, commPct]
  )
  // Comissão padrão para Pronta Entrega: 6% repres. + 4% escritório
  // Usada quando a tabela não possui regras de desconto/comissão cadastradas
  const PE_DEFAULT = { total_commission_pct: 10, rep_commission_pct: 6, office_commission_pct: 4 }
  let rule = rules[0] || null
  if (!rule) {
    const { rows: peRows } = await (client as any).query(
      'SELECT id FROM pe_catalogs WHERE price_table_id=$1 LIMIT 1', [priceTableId]
    )
    rule = peRows.length > 0
      ? PE_DEFAULT
      : { total_commission_pct: 0, rep_commission_pct: 0, office_commission_pct: 0 }
  }

  const netValue = Math.round(totalValue * 100) / 100  // preço líquido = base de comissão
  return {
    enrichedItems,
    totalPieces,
    totalValue: netValue,
    totalCommissionPct: rule.total_commission_pct,
    repCommissionPct: rule.rep_commission_pct,
    officeCommissionPct: rule.office_commission_pct,
    // Comissão sempre baseada no valor LÍQUIDO (após desconto)
    repCommissionValue: Math.round(netValue * rule.rep_commission_pct / 100 * 100) / 100,
    officeCommissionValue: Math.round(netValue * rule.office_commission_pct / 100 * 100) / 100,
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
    LEFT JOIN price_tables pt ON pt.id = o.price_table_id
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
    sql += ` AND (
      c.name ILIKE $${idx} OR c.trade_name ILIKE $${idx} OR
      f.name ILIKE $${idx} OR u.name ILIKE $${idx} OR
      o.industry_order_number ILIKE $${idx} OR
      o.payment_terms ILIKE $${idx} OR o.buyer_name ILIKE $${idx} OR
      o.order_number::text ILIKE $${idx}
    )`
    params.push(`%${search}%`)
    idx++
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
      u.name as rep_name, u.email as rep_email,
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
       p.product_name, p.model, p.type, p.image_url, p.size_range, p.blocked_sizes,
       json_agg(gc ORDER BY gc.sort_order) FILTER (WHERE gc.id IS NOT NULL) as grade_configs
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN grade_configs gc ON gc.product_id = oi.product_id
     WHERE oi.order_id = $1
     GROUP BY oi.id, p.product_name, p.model, p.type, p.image_url, p.size_range, p.blocked_sizes
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

  // Auto-correção silenciosa: se os totais da tabela orders divergem dos order_items, recalcula
  const order = rows[0]
  const realPcs  = items.reduce((s: number, it: { total_pieces: number }) => s + Number(it.total_pieces), 0)
  const realVal  = items.reduce((s: number, it: { subtotal: number }) => s + Number(it.subtotal), 0)
  const storedPcs = Number(order.total_pieces)
  const storedVal = Number(order.total_value)
  if (Math.abs(realPcs - storedPcs) > 0 || Math.abs(realVal - storedVal) > 0.01) {
    const realValFull = items.reduce((s: number, it: { unit_price: number; total_pieces: number }) => s + Number(it.unit_price) * Number(it.total_pieces), 0)
    const fixedVal = Math.round(realVal * 100) / 100
    if (order.commission_manual_override) {
      await query(`UPDATE orders SET total_pieces=$1, total_value=$2, updated_at=NOW() WHERE id=$3`,
        [realPcs, fixedVal, order.id])
    } else {
      await query(
        `UPDATE orders SET total_pieces=$1, total_value=$2, rep_commission_value=$3, office_commission_value=$4, updated_at=NOW() WHERE id=$5`,
        [realPcs, fixedVal,
         Math.round(fixedVal * order.rep_commission_pct / 100 * 100) / 100,
         Math.round(fixedVal * order.office_commission_pct / 100 * 100) / 100,
         order.id]
      )
    }
    order.total_pieces = realPcs
    order.total_value  = Math.round(realVal * 100) / 100
  }

  res.json({ ...order, items, history })
}

export async function createOrder(req: AuthRequest, res: Response) {
  const {
    client_id, factory_id, price_table_id, items, discount_pct, commission_discount_pct,
    cash_discount_pct, custom_discount,
    notes, offline_id, payment_terms, freight_type, delivery_date, industry_order_number, buyer_name,
  } = req.body
  if (!client_id || !factory_id || !price_table_id || !items?.length) {
    res.status(400).json({ error: 'Dados incompletos' }); return
  }

  // Valida limite de Desc. À Vista cadastrado na tabela de preços
  if (cash_discount_pct !== undefined) {
    const cashPct = parseFloat(cash_discount_pct) || 0
    if (cashPct > 0) {
      const { rows: [pt] } = await query(
        'SELECT max_cash_discount_pct FROM price_tables WHERE id=$1', [price_table_id]
      )
      const maxCash = pt?.max_cash_discount_pct !== null && pt?.max_cash_discount_pct !== undefined
        ? parseFloat(pt.max_cash_discount_pct) : null
      if (maxCash !== null && cashPct > maxCash) {
        res.status(422).json({
          error: `Desconto À Vista máximo permitido para esta tabela é ${maxCash.toFixed(2).replace('.', ',')}%`,
          max_cash_discount_pct: maxCash,
        })
        return
      }
    }
  }

  // Status inicial
  const { rows: [initStatus] } = await query(
    'SELECT id FROM order_statuses WHERE is_initial=true AND active=true ORDER BY sort_order LIMIT 1'
  )

  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    const disc = parseFloat(discount_pct) || 0
    // Bug fix: desconto de prazo (comercial) para lookup de comissão é separado do
    // desconto à vista. Se não informado, usa o desconto total (compatibilidade).
    const commDisc = commission_discount_pct !== undefined ? parseFloat(commission_discount_pct) || 0 : disc
    // Flag: pedido com DESC. ESPECIAL (fora das regras pré-cadastradas) deve ser revisado
    const needsReview = !!custom_discount
    const totals = await computeOrderTotals(items, disc, price_table_id, dbClient as any, commDisc)

    // Admin cria pedido: comissão 100% para o escritório, 0% para rep
    const isAdminOrder = req.user!.role === 'admin'
    const repCommPct   = isAdminOrder ? 0 : totals.repCommissionPct
    const offCommPct   = isAdminOrder ? totals.totalCommissionPct : totals.officeCommissionPct
    const repCommVal   = isAdminOrder ? 0 : totals.repCommissionValue
    // Admin: 100% da comissão vai para o escritório, calculada sobre preço LÍQUIDO
    const offCommVal   = isAdminOrder
      ? Math.round(totals.totalValue * totals.totalCommissionPct / 100 * 100) / 100
      : totals.officeCommissionValue

    const { rows: [order] } = await dbClient.query(
      `INSERT INTO orders
       (offline_id, client_id, rep_id, factory_id, price_table_id, status_id,
        discount_pct, total_commission_pct, rep_commission_pct, office_commission_pct,
        total_pieces, total_value, rep_commission_value, office_commission_value,
        notes, payment_terms, freight_type, delivery_date, industry_order_number, buyer_name,
        needs_review_discount, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
       RETURNING *`,
      [offline_id||null, client_id, req.user!.id, factory_id, price_table_id,
       initStatus?.id||null, disc,
       totals.totalCommissionPct, repCommPct, offCommPct,
       totals.totalPieces, totals.totalValue, repCommVal, offCommVal,
       notes||null, payment_terms||null, freight_type||'CIF',
       delivery_date||null, industry_order_number||null, buyer_name||null,
       needsReview]
    )

    for (const item of totals.enrichedItems) {
      await dbClient.query(
        `INSERT INTO order_items (order_id, product_id, reference, boxes_count, unit_price, original_unit_price, total_pieces, subtotal, sizes, custom_grade)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9)`,
        [order.id, item.product_id, item.reference, item.boxes_count, item.unit_price, item.total_pieces, item.subtotal,
         item.sizes ? JSON.stringify(item.sizes) : null,
         item.custom_grade && Array.isArray(item.custom_grade) && item.custom_grade.length > 0 ? JSON.stringify(item.custom_grade) : null]
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
    for (let i = 0; i < newTotals.enrichedItems.length; i++) {
      const item = newTotals.enrichedItems[i]
      const origItem = items[i]
      const customGradeJson = origItem.custom_grade && Array.isArray(origItem.custom_grade) && origItem.custom_grade.length > 0
        ? JSON.stringify(origItem.custom_grade) : null
      await dbClient.query(
        `INSERT INTO order_items (order_id, product_id, reference, boxes_count, unit_price, total_pieces, subtotal, sizes, custom_grade)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [orderId, item.product_id, item.reference, item.boxes_count, item.unit_price, item.total_pieces, item.subtotal,
         item.sizes ? JSON.stringify(item.sizes) : null, customGradeJson]
      )
    }

    // Recalcula totais com TODOS os itens (antigos + novos)
    const { rows: allItems } = await dbClient.query(
      'SELECT product_id, reference, boxes_count, unit_price, sizes FROM order_items WHERE order_id=$1',
      [orderId]
    )
    const allTotals = await computeOrderTotals(allItems, disc, order.price_table_id, dbClient as any)

    if (order.commission_manual_override) {
      // Comissão manual ativa → preserva valores de comissão, atualiza apenas peças/valor
      await dbClient.query(
        `UPDATE orders SET total_pieces=$1, total_value=$2, updated_at=NOW() WHERE id=$3`,
        [allTotals.totalPieces, allTotals.totalValue, orderId]
      )
    } else {
      // Bug fix: usa os % salvos no PEDIDO (que já respeitam admin vs. vendedor),
      // não os % da regra de desconto — evita que pedidos de admin tenham o rep recebendo
      // comissão indevidamente ao adicionar novos itens.
      const newRepVal = Math.round(allTotals.totalValue * Number(order.rep_commission_pct)    / 100 * 100) / 100
      const newOffVal = Math.round(allTotals.totalValue * Number(order.office_commission_pct) / 100 * 100) / 100
      await dbClient.query(
        `UPDATE orders SET
           total_pieces=$1, total_value=$2,
           rep_commission_value=$3, office_commission_value=$4,
           updated_at=NOW()
         WHERE id=$5`,
        [allTotals.totalPieces, allTotals.totalValue, newRepVal, newOffVal, orderId]
      )
    }

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

// Ajuste manual de comissão (admin only)
// Aceita pct (%) ou value (R$). Quando pct é fornecido, calcula value = total_value * pct / 100
// e atualiza ambos os campos (pct e value) na tabela orders.
export async function updateOrderCommission(req: AuthRequest, res: Response) {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Apenas admin pode ajustar comissão' }); return }
  const {
    rep_commission_value, office_commission_value,
    rep_commission_pct, office_commission_pct,
  } = req.body

  const { rows: [order] } = await query(
    'SELECT id, total_value, rep_commission_pct, office_commission_pct FROM orders WHERE id=$1 AND deleted_at IS NULL', [req.params.id]
  )
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado' }); return }

  const totalVal = Number(order.total_value) || 0

  // % informado tem prioridade; caso contrário usa o % atual do pedido no banco
  // Value é SEMPRE recalculado a partir do % efetivo (nunca usa valor do body diretamente)
  // Isso garante que editar rep_pct não zera o office_value (e vice-versa)
  const repPctIn = rep_commission_pct  !== undefined ? parseFloat(String(rep_commission_pct).replace(',','.'))  : null
  const offPctIn = office_commission_pct !== undefined ? parseFloat(String(office_commission_pct).replace(',','.')) : null
  const effectiveRepPct = (repPctIn !== null && !isNaN(repPctIn)) ? repPctIn : Number(order.rep_commission_pct  || 0)
  const effectiveOffPct = (offPctIn !== null && !isNaN(offPctIn)) ? offPctIn : Number(order.office_commission_pct || 0)
  const repVal = Math.round(totalVal * effectiveRepPct / 100 * 100) / 100
  const offVal = Math.round(totalVal * effectiveOffPct / 100 * 100) / 100
  const repPct = effectiveRepPct
  const offPct = effectiveOffPct

  // Constrói UPDATE dinâmico — id vai SEMPRE por último como $N final
  const sets: string[] = []
  const params: unknown[] = []

  const p = () => params.length  // índice atual após o push

  params.push(repVal);  sets.push(`rep_commission_value = $${p()}`)
  params.push(offVal);  sets.push(`office_commission_value = $${p()}`)
  params.push(repPct);  sets.push(`rep_commission_pct = $${p()}`)
  params.push(offPct);  sets.push(`office_commission_pct = $${p()}`)

  sets.push('commission_manual_override = TRUE')
  sets.push('updated_at = NOW()')

  params.push(req.params.id)  // id é sempre o último parâmetro
  const idIdx = p()

  const { rows: [updated] } = await query(
    `UPDATE orders SET ${sets.join(', ')} WHERE id = $${idIdx}
     RETURNING rep_commission_value, office_commission_value,
               rep_commission_pct, office_commission_pct, commission_manual_override`,
    params
  )
  res.json(updated)
}

// Reset da comissão manual — volta ao cálculo automático (admin only)
export async function resetOrderCommission(req: AuthRequest, res: Response) {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: 'Apenas admin pode resetar comissão' }); return }
  const { rows: [order] } = await query(
    `SELECT id, price_table_id, discount_pct, rep_commission_pct, office_commission_pct
     FROM orders WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]
  )
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado' }); return }

  // Recalcula a comissão com base no valor líquido (após desconto)
  const { rows: [totals] } = await query(
    `SELECT COALESCE(SUM(subtotal), 0) AS val_net FROM order_items WHERE order_id=$1`,
    [order.id]
  )
  const valNet = Math.round(Number(totals.val_net) * 100) / 100
  const newRep = Math.round(valNet * order.rep_commission_pct / 100 * 100) / 100
  const newOff = Math.round(valNet * order.office_commission_pct / 100 * 100) / 100

  const { rows: [updated] } = await query(
    `UPDATE orders SET
       rep_commission_value = $1,
       office_commission_value = $2,
       commission_manual_override = FALSE,
       updated_at = NOW()
     WHERE id = $3
     RETURNING rep_commission_value, office_commission_value, commission_manual_override`,
    [newRep, newOff, order.id]
  )
  res.json(updated)
}

// Atualiza campos de informação do pedido
export async function updateOrderInfo(req: AuthRequest, res: Response) {
  const { payment_terms, delivery_date, freight_type, notes, buyer_name, industry_order_number, client_id, rep_id, transportadora } = req.body
  const { rows: [order] } = await query(
    'SELECT rep_id, price_table_id, discount_pct, total_value, total_commission_pct, commission_manual_override FROM orders WHERE id=$1',
    [req.params.id]
  )
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado' }); return }
  const isAdmin = req.user!.role === 'admin'
  if (!isAdmin && order.rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Acesso negado' }); return
  }
  if (client_id) {
    const { rows: [cli] } = await query('SELECT id FROM clients WHERE id=$1 AND active=true', [client_id])
    if (!cli) { res.status(400).json({ error: 'Cliente não encontrado' }); return }
  }
  if (rep_id && isAdmin) {
    const { rows: [rep] } = await query('SELECT id FROM users WHERE id=$1 AND active=true', [rep_id])
    if (!rep) { res.status(400).json({ error: 'Representante não encontrado' }); return }
  }

  const sets: string[] = []
  const params: unknown[] = []
  let idx = 1

  sets.push(`payment_terms=$${idx++}`);         params.push(payment_terms ?? null)
  sets.push(`delivery_date=$${idx++}`);          params.push(delivery_date || null)
  sets.push(`freight_type=$${idx++}`);           params.push(freight_type || 'CIF')
  sets.push(`notes=$${idx++}`);                  params.push(notes ?? null)
  sets.push(`buyer_name=$${idx++}`);             params.push(buyer_name ?? null)
  sets.push(`industry_order_number=$${idx++}`);  params.push(industry_order_number ?? null)
  sets.push(`transportadora=$${idx++}`);         params.push(transportadora ?? null)
  if (client_id) { sets.push(`client_id=$${idx++}`);  params.push(client_id) }
  if (rep_id && isAdmin) { sets.push(`rep_id=$${idx++}`); params.push(rep_id) }

  // Bug fix: quando admin troca o rep, recalcula o split de comissão baseado no
  // papel do novo representante (admin → 0% rep + 100% escrit; vendedor → 6% rep + 4% escrit).
  // Só aplica se a comissão não estiver em modo manual e o rep estiver sendo alterado.
  if (rep_id && isAdmin && !order.commission_manual_override) {
    const { rows: [newRep] } = await query('SELECT role FROM users WHERE id=$1', [rep_id])
    const isRepAdmin = newRep?.role === 'admin'

    // Busca a regra de comissão pela tabela de preços e desconto do pedido
    const { rows: rules } = await query(
      `SELECT * FROM discount_commission_rules WHERE price_table_id=$1
       ORDER BY ABS(discount_pct - $2) ASC LIMIT 1`,
      [order.price_table_id, parseFloat(order.discount_pct) || 0]
    )
    const PE_DEFAULT = { total_commission_pct: 10, rep_commission_pct: 6, office_commission_pct: 4 }
    const rule = rules[0] || PE_DEFAULT
    const totalVal = Number(order.total_value) || 0

    const newRepPct = isRepAdmin ? 0 : rule.rep_commission_pct
    const newOffPct = isRepAdmin ? rule.total_commission_pct : rule.office_commission_pct
    const newRepVal = Math.round(totalVal * newRepPct / 100 * 100) / 100
    const newOffVal = Math.round(totalVal * newOffPct / 100 * 100) / 100

    sets.push(`rep_commission_pct=$${idx++}`);    params.push(newRepPct)
    sets.push(`office_commission_pct=$${idx++}`); params.push(newOffPct)
    sets.push(`rep_commission_value=$${idx++}`);  params.push(newRepVal)
    sets.push(`office_commission_value=$${idx++}`); params.push(newOffVal)
  }

  sets.push('updated_at=NOW()')

  params.push(req.params.id)
  await query(`UPDATE orders SET ${sets.join(', ')} WHERE id=$${idx}`, params)
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

  // Recalcula totais do pedido — comissão sobre preço líquido (subtotal)
  const { rows: [totals] } = await query(
    `SELECT COALESCE(SUM(total_pieces),0) AS pcs, COALESCE(SUM(subtotal),0) AS val
     FROM order_items WHERE order_id=$1`,
    [id]
  )
  const { rows: [o] } = await query('SELECT rep_commission_pct, office_commission_pct, commission_manual_override FROM orders WHERE id=$1', [id])
  const newValue = Math.round(Number(totals.val) * 100) / 100

  if (o.commission_manual_override) {
    await query(
      `UPDATE orders SET total_pieces=$1, total_value=$2, updated_at=NOW() WHERE id=$3`,
      [Number(totals.pcs), newValue, id]
    )
  } else {
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
  }
  res.json({ ok: true })
}

// Troca a tabela de preços do pedido e recalcula todos os valores
export async function changeOrderPriceTable(req: AuthRequest, res: Response) {
  const { price_table_id, discount_pct, commission_discount_pct } = req.body
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

  // Desconto usado para lookup de comissão (apenas desconto de prazo, sem desconto à vista)
  const commDisc = commission_discount_pct !== undefined && !isNaN(parseFloat(commission_discount_pct))
    ? parseFloat(commission_discount_pct)
    : disc

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
        // preço por PEÇA × total de peças
        subtotal = discountedPrice * itemPieces
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
    // disc = desconto total (prazo + à vista) para preço do cliente
    // commDisc = apenas desconto de prazo para lookup de comissão
    const totals = await computeOrderTotals(updatedItems, disc, price_table_id, dbClient as any, commDisc)

    // Verifica se o rep do pedido é admin → comissão 100% escritório
    const { rows: [repUser] } = await dbClient.query(
      'SELECT role FROM users WHERE id=(SELECT rep_id FROM orders WHERE id=$1)', [orderId]
    )
    const isAdminRep = repUser?.role === 'admin'
    const repCommPct2   = isAdminRep ? 0 : totals.repCommissionPct
    const offCommPct2   = isAdminRep ? totals.totalCommissionPct : totals.officeCommissionPct
    const repCommVal2   = isAdminRep ? 0 : totals.repCommissionValue
    const offCommVal2   = isAdminRep
      ? Math.round(totals.totalValue * totals.totalCommissionPct / 100 * 100) / 100
      : totals.officeCommissionValue

    await dbClient.query(
      `UPDATE orders SET
         price_table_id=$1, discount_pct=$2,
         total_commission_pct=$3, rep_commission_pct=$4, office_commission_pct=$5,
         total_pieces=$6, total_value=$7,
         rep_commission_value=$8, office_commission_value=$9,
         commission_manual_override=FALSE,
         updated_at=NOW()
       WHERE id=$10`,
      [
        price_table_id, disc,
        totals.totalCommissionPct, repCommPct2, offCommPct2,
        totals.totalPieces, totals.totalValue,
        repCommVal2, offCommVal2,
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

// Atualiza quantidades de um item (tamanhos para regular, caixas para pack) e recalcula totais
export async function updateOrderItem(req: AuthRequest, res: Response) {
  const { id, item_id } = req.params
  const { sizes, boxes_count, custom_grade, unit_price: newUnitPrice } = req.body

  const { rows: [order] } = await query(
    'SELECT * FROM orders WHERE id=$1 AND deleted_at IS NULL', [id]
  )
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado' }); return }

  const isAdmin = req.user!.role === 'admin'
  if (!isAdmin && order.rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Acesso negado' }); return
  }

  const { rows: [item] } = await query(
    `SELECT oi.*, p.type AS product_type
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.id=$1 AND oi.order_id=$2`,
    [item_id, id]
  )
  if (!item) { res.status(404).json({ error: 'Item não encontrado' }); return }

  // Usa o novo preço se fornecido, senão mantém o atual
  const effectiveUnitPrice = (newUnitPrice !== undefined && !isNaN(parseFloat(newUnitPrice)))
    ? parseFloat(newUnitPrice)
    : Number(item.unit_price)

  const disc = parseFloat(order.discount_pct) || 0
  const discountedPrice = effectiveUnitPrice * (1 - disc / 100)

  let newTotalPieces: number
  let newSubtotal: number
  let newSizes: Record<string, number> | null = null
  let newBoxesCount: number = Number(item.boxes_count)
  let newCustomGrade: string | null = null

  if (item.product_type === 'regular' && sizes && typeof sizes === 'object') {
    const sizesMap = sizes as Record<string, number>
    const sizesTotal = Object.values(sizesMap).reduce((s, v) => s + Number(v || 0), 0)
    if (sizesTotal === 0) {
      res.status(400).json({ error: 'Total de peças não pode ser zero' }); return
    }
    newTotalPieces = sizesTotal
    newSubtotal = Math.round(discountedPrice * newTotalPieces * 100) / 100
    newSizes = sizesMap
    newBoxesCount = 1
  } else if (item.product_type === 'pack') {
    if (custom_grade && Array.isArray(custom_grade) && custom_grade.length > 0) {
      // Grade personalizada por cor
      const customArr = custom_grade as CustomGradeEntry[]
      newTotalPieces = customArr.reduce((s, gc) =>
        s + Object.values(gc.sizes || {}).reduce((ss, v) => ss + Number(v || 0), 0), 0
      )
      if (newTotalPieces <= 0) {
        res.status(400).json({ error: 'Total de peças não pode ser zero' }); return
      }
      // preço por PEÇA × total de peças
      newSubtotal = Math.round(discountedPrice * newTotalPieces * 100) / 100
      newBoxesCount = 1
      newCustomGrade = JSON.stringify(customArr.map(gc => ({
        color: gc.color,
        sizes: gc.sizes,
        total_pieces: Object.values(gc.sizes || {}).reduce((s, v) => s + Number(v || 0), 0)
      })))
    } else {
      // Número de caixas padrão
      const newBoxes = parseInt(boxes_count) || 1
      if (newBoxes <= 0) {
        res.status(400).json({ error: 'Quantidade de caixas deve ser maior que zero' }); return
      }
      const { rows: grades } = await query(
        'SELECT total_pieces FROM grade_configs WHERE product_id=$1', [item.product_id]
      )
      const piecesPerBox = grades.reduce((s: number, g: { total_pieces: number }) => s + g.total_pieces, 0) || 1
      newTotalPieces = newBoxes * piecesPerBox
      // preço por PEÇA × total de peças
      newSubtotal = Math.round(discountedPrice * newTotalPieces * 100) / 100
      newBoxesCount = newBoxes
    }
  } else {
    res.status(400).json({ error: 'Dados inválidos' }); return
  }

  await query(
    `UPDATE order_items SET
       sizes=$1, boxes_count=$2, total_pieces=$3, subtotal=$4, custom_grade=$5, unit_price=$6
     WHERE id=$7`,
    [newSizes ? JSON.stringify(newSizes) : null, newBoxesCount, newTotalPieces, newSubtotal, newCustomGrade, effectiveUnitPrice, item_id]
  )

  // Recalcula totais — comissão sobre preço líquido (subtotal)
  const { rows: [totals] } = await query(
    `SELECT COALESCE(SUM(total_pieces),0) AS pcs, COALESCE(SUM(subtotal),0) AS val
     FROM order_items WHERE order_id=$1`,
    [id]
  )
  const newValue = Math.round(Number(totals.val) * 100) / 100

  if (order.commission_manual_override) {
    await query(
      `UPDATE orders SET total_pieces=$1, total_value=$2, updated_at=NOW() WHERE id=$3`,
      [Number(totals.pcs), newValue, id]
    )
  } else {
    await query(
      `UPDATE orders SET total_pieces=$1, total_value=$2,
         rep_commission_value=$3, office_commission_value=$4, updated_at=NOW()
       WHERE id=$5`,
      [
        Number(totals.pcs),
        newValue,
        Math.round(newValue * order.rep_commission_pct / 100 * 100) / 100,
        Math.round(newValue * order.office_commission_pct / 100 * 100) / 100,
        id,
      ]
    )
  }

  res.json({ ok: true, total_pieces: Number(totals.pcs), total_value: newValue })
}

// Recalcula totais de um pedido a partir dos order_items (corrige inconsistências)
export async function recalcOrderTotals(req: AuthRequest, res: Response) {
  const { id } = req.params
  const isAdmin = req.user!.role === 'admin'
  const { rows: [order] } = await query(
    'SELECT * FROM orders WHERE id=$1 AND deleted_at IS NULL', [id]
  )
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado' }); return }
  if (!isAdmin && order.rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Acesso negado' }); return
  }

  const { rows: [totals] } = await query(
    `SELECT COALESCE(SUM(total_pieces),0) AS pcs, COALESCE(SUM(subtotal),0) AS val
     FROM order_items WHERE order_id=$1`,
    [id]
  )
  const newValue = Math.round(Number(totals.val) * 100) / 100

  if (order.commission_manual_override) {
    await query(
      `UPDATE orders SET total_pieces=$1, total_value=$2, updated_at=NOW() WHERE id=$3`,
      [Number(totals.pcs), newValue, id]
    )
  } else {
    await query(
      `UPDATE orders SET total_pieces=$1, total_value=$2,
         rep_commission_value=$3, office_commission_value=$4, updated_at=NOW()
       WHERE id=$5`,
      [
        Number(totals.pcs),
        newValue,
        Math.round(newValue * order.rep_commission_pct / 100 * 100) / 100,
        Math.round(newValue * order.office_commission_pct / 100 * 100) / 100,
        id,
      ]
    )
  }
  res.json({ ok: true, total_pieces: Number(totals.pcs), total_value: newValue })
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

// Duplica um pedido: cria um novo pedido idêntico para edição
export async function duplicateOrder(req: AuthRequest, res: Response) {
  const { id } = req.params
  const isAdmin = req.user!.role === 'admin'

  // Busca o pedido original com todos os dados
  const { rows: [orig] } = await query(
    `SELECT o.*,
       COALESCE(
         array_agg(row_to_json(oi) ORDER BY oi.created_at) FILTER (WHERE oi.id IS NOT NULL),
         '{}'
       ) AS items
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.id=$1 AND o.deleted_at IS NULL
     GROUP BY o.id`,
    [id]
  )
  if (!orig) { res.status(404).json({ error: 'Pedido não encontrado' }); return }
  if (!isAdmin && orig.rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Acesso negado' }); return
  }

  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    // Status inicial
    const { rows: [initStatus] } = await dbClient.query(
      'SELECT id FROM order_statuses WHERE is_initial=true AND active=true ORDER BY sort_order LIMIT 1'
    )

    // Cria o novo pedido com os mesmos dados (sem os campos específicos do original)
    const { rows: [newOrder] } = await dbClient.query(
      `INSERT INTO orders
       (client_id, rep_id, factory_id, price_table_id, status_id,
        discount_pct, total_commission_pct, rep_commission_pct, office_commission_pct,
        total_pieces, total_value, rep_commission_value, office_commission_value,
        notes, payment_terms, freight_type, delivery_date, buyer_name,
        synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
       RETURNING id`,
      [
        orig.client_id, orig.rep_id, orig.factory_id, orig.price_table_id,
        initStatus?.id || null,
        orig.discount_pct,
        orig.total_commission_pct, orig.rep_commission_pct, orig.office_commission_pct,
        orig.total_pieces, orig.total_value,
        orig.rep_commission_value, orig.office_commission_value,
        orig.notes, orig.payment_terms, orig.freight_type || 'CIF',
        orig.delivery_date, orig.buyer_name,
      ]
    )

    // Copia os itens do pedido original
    for (const item of (orig.items as Record<string, unknown>[])) {
      await dbClient.query(
        `INSERT INTO order_items
         (order_id, product_id, reference, boxes_count, unit_price, total_pieces, subtotal, sizes, custom_grade)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          newOrder.id,
          item.product_id,
          item.reference,
          item.boxes_count,
          item.unit_price,
          item.total_pieces,
          item.subtotal,
          item.sizes ? JSON.stringify(item.sizes) : null,
          item.custom_grade ? JSON.stringify(item.custom_grade) : null,
        ]
      )
    }

    if (initStatus) {
      await dbClient.query(
        `INSERT INTO order_status_history (order_id, from_status_id, to_status_id, changed_by)
         VALUES ($1,NULL,$2,$3)`,
        [newOrder.id, initStatus.id, req.user!.id]
      )
    }

    await dbClient.query('COMMIT')
    res.status(201).json({ id: newOrder.id })
  } catch (err) {
    await dbClient.query('ROLLBACK')
    const msg = (err instanceof Error) ? err.message : String(err)
    console.error('[duplicateOrder]', msg)
    res.status(500).json({ error: `Erro ao duplicar pedido: ${msg}` })
  } finally {
    dbClient.release()
  }
}

// ── Resumo rápido de pedidos para a aba Orders ───────────────────────────────
export async function ordersSummary(req: AuthRequest, res: Response) {
  const { date_from, date_to, rep_id } = req.query
  const isAdmin = req.user!.role === 'admin'

  const params: unknown[] = []
  let where = `WHERE o.deleted_at IS NULL`

  if (!isAdmin) { params.push(req.user!.id); where += ` AND o.rep_id = $${params.length}` }
  else if (rep_id) { params.push(rep_id); where += ` AND o.rep_id = $${params.length}` }
  if (date_from) { params.push(date_from); where += ` AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') >= $${params.length}::date` }
  if (date_to)   { params.push(date_to);   where += ` AND DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') <= $${params.length}::date` }

  const base = `FROM orders o
    JOIN users u     ON u.id = o.rep_id
    JOIN factories f ON f.id = o.factory_id
    LEFT JOIN order_statuses s ON s.id = o.status_id
    ${where}`

  const [byDay, byRep, byFactory, byStatus] = await Promise.all([
    query(`SELECT DATE(o.created_at AT TIME ZONE 'America/Sao_Paulo') AS dia,
             COUNT(*)::int AS pedidos,
             COALESCE(SUM(o.total_value),0)::numeric AS total
           ${base} GROUP BY dia ORDER BY dia DESC LIMIT 30`, params),

    query(`SELECT u.name AS vendedor,
             COUNT(*)::int AS pedidos,
             COALESCE(SUM(o.total_value),0)::numeric AS total
           ${base} GROUP BY u.id, u.name ORDER BY total DESC`, params),

    query(`SELECT f.name AS fabrica,
             COUNT(*)::int AS pedidos,
             COALESCE(SUM(o.total_value),0)::numeric AS total
           ${base} GROUP BY f.id, f.name ORDER BY total DESC`, params),

    query(`SELECT COALESCE(s.name,'Sem status') AS status, s.color,
             COUNT(*)::int AS pedidos,
             COALESCE(SUM(o.total_value),0)::numeric AS total
           ${base} GROUP BY s.id, s.name, s.color ORDER BY total DESC`, params),
  ])

  res.json({
    by_day:     byDay.rows,
    by_rep:     byRep.rows,
    by_factory: byFactory.rows,
    by_status:  byStatus.rows,
  })
}

// ── Alertas de "aniversário" (a cada 15 dias desde a emissão) ─────────────────
// Lista pedidos cuja idade (dias desde created_at) atingiu um múltiplo de 15
// (15, 30, 45, 60...) e que ainda não foram dispensados PARA AQUELE MARCO
// específico — assim, se o pedido continuar parado, o alerta reaparece
// naturalmente no marco seguinte. Objetivo: cobrar a fábrica por pedidos
// atrasados na entrega.
export async function listOrderAlerts(req: AuthRequest, res: Response) {
  const isAdmin = req.user!.role === 'admin'

  const params: unknown[] = []
  let repFilter = ''
  if (!isAdmin) { params.push(req.user!.id); repFilter = ` AND oa.rep_id = $${params.length}` }

  const { rows } = await query(
    `WITH order_ages AS (
       SELECT o.*,
         GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400))::int AS age_days
       FROM orders o
       WHERE o.deleted_at IS NULL
     )
     SELECT
       oa.id, oa.order_number, oa.created_at, oa.delivery_date,
       oa.total_value, oa.total_pieces, oa.payment_terms,
       oa.age_days,
       (FLOOR(oa.age_days / 15) * 15)::int AS milestone_days,
       c.id AS client_id, c.name AS client_name, c.trade_name AS client_trade_name, c.city AS client_city,
       u.id AS rep_id, u.name AS rep_name,
       f.name AS factory_name,
       s.name AS status_name, s.color AS status_color
     FROM order_ages oa
     JOIN clients c ON c.id = oa.client_id
     JOIN users u ON u.id = oa.rep_id
     JOIN factories f ON f.id = oa.factory_id
     LEFT JOIN order_statuses s ON s.id = oa.status_id
     WHERE oa.age_days >= 15
       AND (s.is_final IS NOT TRUE)
       AND NOT EXISTS (
         SELECT 1 FROM order_alert_dismissals d
         WHERE d.order_id = oa.id AND d.milestone_days = (FLOOR(oa.age_days / 15) * 15)::int
       )
       ${repFilter}
     ORDER BY oa.age_days DESC, oa.created_at ASC`,
    params
  )
  res.json(rows)
}

// Dispensa o alerta de um pedido para o marco de dias informado (ex.: 15, 30, 45...).
// Por ser específico ao marco, o alerta volta a aparecer no marco seguinte caso
// o pedido continue parado — permitindo "excluir a notificação quando necessário"
// sem escondê-la para sempre.
export async function dismissOrderAlert(req: AuthRequest, res: Response) {
  const isAdmin = req.user!.role === 'admin'
  const milestoneDays = Number(req.body?.milestone_days)

  if (!Number.isInteger(milestoneDays) || milestoneDays < 15 || milestoneDays % 15 !== 0) {
    res.status(400).json({ error: 'milestone_days inválido' }); return
  }

  const { rows: [order] } = await query(
    'SELECT id, rep_id FROM orders WHERE id=$1 AND deleted_at IS NULL', [req.params.id]
  )
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado' }); return }
  if (!isAdmin && order.rep_id !== req.user!.id) {
    res.status(403).json({ error: 'Acesso negado' }); return
  }

  await query(
    `INSERT INTO order_alert_dismissals (order_id, milestone_days, dismissed_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (order_id, milestone_days) DO NOTHING`,
    [order.id, milestoneDays, req.user!.id]
  )
  res.json({ ok: true })
}
