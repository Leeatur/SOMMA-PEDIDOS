/**
 * fixCommissions.ts
 *
 * fixAllCommissionPcts() — re-executa o lookup completo de regras de comissão
 *   (discount_commission_rules + pe_catalogs) para todos os pedidos sem override
 *   manual, atualizando rep_commission_pct, office_commission_pct e os valores.
 *   Resolve o caso em que pedidos foram criados antes das regras existirem no BD.
 *
 * fixCommissions() — recalcula apenas os _value a partir dos _pct já armazenados.
 *   Útil como complemento após fixAllCommissionPcts.
 *
 * Ambas executam no startup da aplicação em produção.
 */
import { query } from '../config/database'

const PE_DEFAULT = {
  total_commission_pct: 10,
  rep_commission_pct:    6,
  office_commission_pct: 4,
}

/** Re-executa o lookup de regras para corrigir os próprios percentuais */
export async function fixAllCommissionPcts() {
  console.log('[fixAllCommissionPcts] Re-calculando percentuais de comissão a partir das regras...')

  const { rows: orders } = await query(`
    SELECT o.id,
           o.price_table_id,
           o.discount_pct,
           o.commission_discount_pct,
           o.total_value,
           o.rep_commission_pct,
           o.office_commission_pct,
           u.role AS rep_role
    FROM orders o
    JOIN users u ON u.id = o.rep_id
    WHERE o.deleted_at IS NULL
      AND o.commission_manual_override = FALSE
  `)

  let updated = 0
  for (const o of orders) {
    const commDiscPct = o.commission_discount_pct !== null
      ? Number(o.commission_discount_pct)
      : Number(o.discount_pct)
    const isRepAdmin = o.rep_role === 'admin'
    const net = Math.round(Number(o.total_value) * 100) / 100

    // 1. Busca regra mais próxima do desconto de prazo (mesma lógica do lookupCommission)
    const { rows: rules } = await query(
      `SELECT * FROM discount_commission_rules
       WHERE price_table_id = $1
       ORDER BY ABS(discount_pct - $2) ASC LIMIT 1`,
      [o.price_table_id, commDiscPct]
    )

    let rule = rules[0] || null

    // 2. Sem regra → verifica se é PE catalog (usa PE_DEFAULT) ou outro (0%)
    if (!rule) {
      const { rows: peRows } = await query(
        'SELECT id FROM pe_catalogs WHERE price_table_id = $1 LIMIT 1',
        [o.price_table_id]
      )
      rule = peRows.length > 0
        ? PE_DEFAULT
        : { total_commission_pct: 0, rep_commission_pct: 0, office_commission_pct: 0 }
    }

    // 3. Admin: rep_pct = 0, office_pct = total (escritório fica com tudo)
    const repPct = isRepAdmin ? 0 : Number(rule.rep_commission_pct)
    const offPct = isRepAdmin
      ? Number(rule.total_commission_pct)
      : Number(rule.office_commission_pct)

    const repVal = Math.round(net * repPct / 100 * 100) / 100
    const offVal = Math.round(net * offPct / 100 * 100) / 100

    // Só atualiza se algo mudou
    await query(
      `UPDATE orders
       SET rep_commission_pct    = $1,
           office_commission_pct = $2,
           rep_commission_value   = $3,
           office_commission_value = $4
       WHERE id = $5
         AND (
           rep_commission_pct    IS DISTINCT FROM $1 OR
           office_commission_pct IS DISTINCT FROM $2 OR
           rep_commission_value   IS DISTINCT FROM $3 OR
           office_commission_value IS DISTINCT FROM $4
         )`,
      [repPct, offPct, repVal, offVal, o.id]
    )
    updated++
  }

  console.log(`[fixAllCommissionPcts] Concluído — ${updated} pedidos verificados.`)
}

/** Recalcula _value a partir dos _pct já armazenados (complemento rápido) */
export async function fixCommissions() {
  console.log('[fixCommissions] Recalculando valores de comissão a partir dos percentuais...')

  const { rows: orders } = await query(`
    SELECT id, total_value, rep_commission_pct, office_commission_pct
    FROM orders
    WHERE deleted_at IS NULL
      AND commission_manual_override = FALSE
  `)

  let fixed = 0
  for (const o of orders) {
    const net    = Math.round(Number(o.total_value) * 100) / 100
    const repVal = Math.round(net * Number(o.rep_commission_pct)    / 100 * 100) / 100
    const offVal = Math.round(net * Number(o.office_commission_pct) / 100 * 100) / 100

    await query(
      `UPDATE orders
       SET rep_commission_value = $1, office_commission_value = $2
       WHERE id = $3
         AND (rep_commission_value IS DISTINCT FROM $1 OR office_commission_value IS DISTINCT FROM $2)`,
      [repVal, offVal, o.id]
    )
    fixed++
  }

  console.log(`[fixCommissions] Concluído — ${fixed} pedidos verificados.`)
}
