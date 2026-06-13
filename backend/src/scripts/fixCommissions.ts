/**
 * fixCommissions.ts
 * Recalcula rep_commission_value e office_commission_value de todos os pedidos
 * que não têm ajuste manual (commission_manual_override = false).
 * Base: preço líquido (total_value = subtotal dos itens, após desconto).
 * Executa automaticamente no startup de produção.
 */
import { query } from '../config/database'

export async function fixCommissions() {
  console.log('[fixCommissions] Recalculando comissões dos pedidos...')

  const { rows: orders } = await query(`
    SELECT id, total_value, rep_commission_pct, office_commission_pct
    FROM orders
    WHERE deleted_at IS NULL
      AND commission_manual_override = FALSE
  `)

  let fixed = 0
  for (const o of orders) {
    const net = Math.round(Number(o.total_value) * 100) / 100
    const repVal = Math.round(net * Number(o.rep_commission_pct) / 100 * 100) / 100
    const offVal = Math.round(net * Number(o.office_commission_pct) / 100 * 100) / 100

    // Usa IS DISTINCT FROM para lidar corretamente com NULLs
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
