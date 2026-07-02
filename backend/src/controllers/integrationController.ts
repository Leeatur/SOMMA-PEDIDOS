import { Request, Response } from 'express'
import crypto from 'crypto'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

// Token de integração guardado na company_settings
const TOKEN_KEY = 'integration_token'

async function lerToken(): Promise<string | null> {
  const { rows } = await query('SELECT value FROM company_settings WHERE key = $1', [TOKEN_KEY])
  return rows[0]?.value || null
}

// ── Admin: estado da integração ──
export async function getInfo(_req: AuthRequest, res: Response) {
  const { rows } = await query('SELECT value, updated_at FROM company_settings WHERE key = $1', [TOKEN_KEY])
  res.json({
    ativo: Boolean(rows[0]?.value),
    atualizado_em: rows[0]?.updated_at || null,
    instrucao: 'No SOMMA Maps → Integrações: cole a URL desta API + este token.',
  })
}

// ── Admin: gera (ou regenera) o token ──
export async function gerarToken(_req: AuthRequest, res: Response) {
  const token = 'fv_' + crypto.randomBytes(24).toString('hex')
  await query(
    `INSERT INTO company_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [TOKEN_KEY, token]
  )
  res.json({ token })
}

// ── Admin: revoga o token ──
export async function revogarToken(_req: AuthRequest, res: Response) {
  await query('DELETE FROM company_settings WHERE key = $1', [TOKEN_KEY])
  res.json({ ok: true })
}

// ── Público (autenticado por token): vendas pro SOMMA Maps ──
// Cada pedido COM status (não excluído) vira uma venda.
// Cidade = do cliente; fábrica = factories; status = coleção.
export async function getSales(req: Request, res: Response) {
  const token = String(req.headers['x-integration-token'] || req.query.token || '').trim()
  if (!token) { res.status(401).json({ error: 'Token de integração ausente' }); return }

  const tokenValido = await lerToken()
  if (!tokenValido || token !== tokenValido) {
    res.status(403).json({ error: 'Token de integração inválido' }); return
  }

  const since   = req.query.since   ? String(req.query.since)   : null
  const colecao = req.query.colecao ? String(req.query.colecao) : null
  const fabrica = req.query.fabrica ? String(req.query.fabrica) : null

  const params: unknown[] = [since]
  let extra = ''
  if (colecao) { extra += ` AND pt.name = $${params.push(colecao)}`   }
  if (fabrica) { extra += ` AND f.name  ILIKE $${params.push('%' + fabrica + '%')}` }

  const { rows } = await query(
    `SELECT o.created_at::date            AS data,
            u.name                        AS vendedor,
            c.city                        AS cidade,
            c.state                       AS uf,
            o.total_value                 AS valor,
            st.name                       AS status,
            f.name                        AS fabrica,
            pt.name                       AS colecao,
            o.id                          AS pedido_id,
            (SELECT string_agg(oi.reference, ', ')
               FROM order_items oi WHERE oi.order_id = o.id) AS itens
       FROM orders o
       JOIN clients c         ON c.id = o.client_id
       JOIN users u           ON u.id = o.rep_id
       JOIN order_statuses st  ON st.id = o.status_id
       LEFT JOIN factories f   ON f.id = o.factory_id
       LEFT JOIN order_items oi2 ON oi2.order_id = o.id
       LEFT JOIN products p    ON p.id = oi2.product_id
       LEFT JOIN price_tables pt ON pt.id = p.price_table_id
      WHERE o.deleted_at IS NULL
        AND ($1::timestamptz IS NULL OR o.created_at >= $1)
        ${extra}
      GROUP BY o.id, o.created_at, u.name, c.city, c.state,
               o.total_value, st.name, f.name, pt.name
      ORDER BY o.created_at DESC`,
    params
  )

  // Coleta coleções distintas para o Maps usar como opções de filtro
  const colecoes = [...new Set(rows.map((r: any) => r.colecao).filter(Boolean))].sort()

  res.json({
    gerado_em: new Date().toISOString(),
    total: rows.length,
    colecoes,
    vendas: rows.map((r: any) => ({
      data: r.data,
      vendedor: r.vendedor,
      cidade: r.cidade,
      uf: r.uf,
      valor: Number(r.valor),
      status: r.status,
      fabrica: r.fabrica,
      colecao: r.colecao || null,
      itens: r.itens || '',
      pedido_id: r.pedido_id,
    })),
  })
}
