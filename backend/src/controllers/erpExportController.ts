import { Response } from 'express'
import * as XLSX from 'xlsx'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

type CustomGradeEntry = { color: string; sizes: Record<string, number> }
type SkuMap = Record<string, Record<string, string>>

function findSku(skus: SkuMap, color: string, tam: string): string {
  if (color && skus[color]?.[tam]) return skus[color][tam]
  // fallback: procura em qualquer cor
  for (const cs of Object.values(skus)) {
    if (cs[tam]) return cs[tam]
  }
  return ''
}

interface RawItem {
  order_id: string
  reference: string
  product_name: string
  custom_grade: CustomGradeEntry[] | null
  sizes: Record<string, number> | null
  customer_skus: SkuMap | null
}

function expandItems(items: RawItem[]) {
  const rows: { ref: string; product: string; cor: string; tam: string; qty: number; cod: string }[] = []
  for (const item of items) {
    const skus = item.customer_skus || {}
    if (item.custom_grade?.length) {
      for (const cg of item.custom_grade) {
        for (const [tam, qty] of Object.entries(cg.sizes || {})) {
          if (Number(qty) <= 0) continue
          rows.push({ ref: item.reference, product: item.product_name, cor: cg.color, tam, qty: Number(qty), cod: findSku(skus, cg.color, tam) })
        }
      }
    } else if (item.sizes) {
      for (const [tam, qty] of Object.entries(item.sizes)) {
        if (Number(qty) <= 0) continue
        rows.push({ ref: item.reference, product: item.product_name, cor: '', tam, qty: Number(qty), cod: findSku(skus, '', tam) })
      }
    }
  }
  return rows
}

async function buildXlsx(orderIds: string[]) {
  if (!orderIds.length) return XLSX.write(XLSX.utils.book_new(), { type: 'buffer', bookType: 'xlsx' })

  const { rows: ordersRaw } = await query(
    `SELECT o.id, o.order_number, o.created_at, o.payment_terms, o.transportadora,
            c.name as client_name, c.trade_name, c.cnpj,
            c.address, c.address_number, c.complement, c.neighborhood, c.city, c.state, c.zip
     FROM orders o
     JOIN clients c ON c.id = o.client_id
     WHERE o.id = ANY($1) AND o.deleted_at IS NULL
     ORDER BY o.created_at, o.order_number`,
    [orderIds]
  )
  const orders = ordersRaw as {
    id: string; order_number: number; created_at: Date; payment_terms: string | null; transportadora: string | null
    client_name: string; trade_name: string | null; cnpj: string | null
    address: string | null; address_number: string | null; complement: string | null
    neighborhood: string | null; city: string | null; state: string | null; zip: string | null
  }[]

  const { rows: rawItems } = await query(
    `SELECT oi.order_id, oi.reference, oi.custom_grade, oi.sizes,
            p.product_name, p.customer_skus
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ANY($1)
     ORDER BY oi.created_at`,
    [orderIds]
  )

  const itemsByOrder: Record<string, RawItem[]> = {}
  for (const it of rawItems) (itemsByOrder[it.order_id] ||= []).push(it)

  const xlsxRows: Record<string, unknown>[] = []
  for (const o of orders) {
    const expanded = expandItems(itemsByOrder[o.id] || [])
    const date = new Date(o.created_at).toLocaleDateString('pt-BR')
    const num = String(o.order_number || '').padStart(4, '0')
    for (const r of expanded) {
      xlsxRows.push({
        'Pedido':        num,
        'Data':          date,
        'Cliente':       o.client_name,
        'Razão Social':  o.trade_name || o.client_name,
        'CNPJ':          o.cnpj || '',
        'Logradouro':    o.address || '',
        'Número':        o.address_number || '',
        'Complemento':   o.complement || '',
        'Bairro':        o.neighborhood || '',
        'CEP':           o.zip || '',
        'Cidade':        o.city || '',
        'UF':            o.state || '',
        'Cond. Pagto':   o.payment_terms || '',
        'Transportadora':o.transportadora || '',
        'Referência':    r.ref,
        'Produto':       r.product,
        'Cor':           r.cor,
        'Tamanho':       r.tam,
        'Qtd':           r.qty,
        'Cód. ERP':      r.cod,
      })
    }
  }

  const ws = XLSX.utils.json_to_sheet(xlsxRows.length ? xlsxRows : [{}])
  ws['!cols'] = [
    { wch: 7  }, { wch: 11 }, { wch: 30 }, { wch: 30 }, { wch: 18 },
    { wch: 30 }, { wch: 8  }, { wch: 15 }, { wch: 18 }, { wch: 10 },
    { wch: 18 }, { wch: 5  }, { wch: 20 }, { wch: 20 },
    { wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 8  }, { wch: 6  }, { wch: 12 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Pedidos ERP')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

// GET /api/orders/:id/erp-xlsx
export async function exportOrderErp(req: AuthRequest, res: Response) {
  const { id } = req.params
  const { rows: [order] } = await query('SELECT id, order_number FROM orders WHERE id=$1 AND deleted_at IS NULL', [id])
  if (!order) { res.status(404).json({ error: 'Pedido não encontrado' }); return }

  const buf = await buildXlsx([id])
  const num = String(order.order_number || '').padStart(4, '0')
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="pedido-${num}-erp.xlsx"`,
  })
  res.send(buf)
}

// GET /api/orders/erp-daily?date=YYYY-MM-DD
export async function exportDailyErp(req: AuthRequest, res: Response) {
  const dateParam = req.query.date as string | undefined
  const date = dateParam || new Date().toISOString().split('T')[0]

  const { rows } = await query(
    `SELECT id FROM orders
     WHERE deleted_at IS NULL
       AND created_at::date = $1::date
     ORDER BY created_at`,
    [date]
  )

  const ids = (rows as { id: string }[]).map(r => r.id)
  const buf = await buildXlsx(ids)

  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="pedidos-erp-${date}.xlsx"`,
  })
  res.send(buf)
}
