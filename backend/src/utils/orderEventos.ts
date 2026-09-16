import { query } from '../config/database'

// Linha do tempo do pedido: quem fez o quê e quando (criou, duplicou, alterou,
// faturou, excluiu…). Mudança de status continua em order_status_history — a tela
// junta as duas. Grava DEPOIS da ação dar certo e nunca derruba a ação: um
// histórico que falha não pode travar o pedido.
export async function registrarEvento(
  orderId: string, userId: string | undefined, tipo: string, descricao: string,
) {
  try {
    await query(
      `INSERT INTO order_eventos (order_id, user_id, tipo, descricao) VALUES ($1, $2, $3, $4)`,
      [orderId, userId ?? null, tipo, descricao],
    )
  } catch (err) {
    console.error('[order_eventos]', tipo, orderId, err instanceof Error ? err.message : err)
  }
}

export const brl = (v: unknown) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)

export const numPedido = (n: unknown) => `#${String(n ?? '').padStart(4, '0')}`

export const dataBR = (iso: unknown) => {
  const s = String(iso ?? '').substring(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  return s.split('-').reverse().join('/')
}

// Grade comparável: ignora ordem das chaves e tamanhos zerados, para não registrar
// "alterou" quando a tela só reenviou a mesma grade.
export function chaveGrade(sizes: unknown, customGrade: unknown): string {
  const parse = (v: unknown) => {
    if (typeof v !== 'string') return v
    try { return JSON.parse(v) } catch { return null }
  }
  const tam = (obj: unknown) => Object.entries((obj as Record<string, unknown>) || {})
    .filter(([, q]) => Number(q) > 0)
    .map(([k, q]) => `${k}:${Number(q)}`)
    .sort()
    .join(',')
  const cg = parse(customGrade)
  if (Array.isArray(cg) && cg.length) {
    return cg
      .map((g: { color?: string | null; sizes?: unknown }) => `${g.color ?? ''}[${tam(g.sizes)}]`)
      .sort()
      .join('|')
  }
  return tam(parse(sizes))
}
