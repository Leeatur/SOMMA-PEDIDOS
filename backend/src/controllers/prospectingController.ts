import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

// Configuração de segmentos → tags OSM
const SEGMENT_TAGS: Record<string, string[][]> = {
  confeccao: [
    ['shop', 'clothes'],
    ['shop', 'fabric'],
    ['craft', 'tailor'],
    ['shop', 'fashion'],
    ['shop', 'wholesale'],
  ],
  calcados: [
    ['shop', 'shoes'],
  ],
  acessorios: [
    ['shop', 'jewelry'],
    ['shop', 'accessories'],
    ['shop', 'watches'],
  ],
  comercio_geral: [
    ['shop', 'department_store'],
    ['shop', 'supermarket'],
    ['shop', 'mall'],
  ],
  alimentacao: [
    ['amenity', 'restaurant'],
    ['amenity', 'cafe'],
    ['shop', 'bakery'],
    ['shop', 'butcher'],
    ['shop', 'food'],
  ],
}

function buildOverpassQuery(lat: number, lng: number, radiusM: number, tags: string[][]): string {
  const filters = tags.map(([k, v]) =>
    `node["${k}"="${v}"](around:${radiusM},${lat},${lng});\n` +
    `way["${k}"="${v}"](around:${radiusM},${lat},${lng});`
  ).join('\n')

  return `[out:json][timeout:30];\n(\n${filters}\n);\nout center;`
}

// GET /api/prospecting/nearby?lat=&lng=&radius=&segment=
export async function searchNearby(req: AuthRequest, res: Response) {
  const lat = parseFloat(req.query.lat as string)
  const lng = parseFloat(req.query.lng as string)
  const radius = Math.min(parseInt(req.query.radius as string) || 5000, 20000)
  const segment = (req.query.segment as string) || 'confeccao'

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: 'lat e lng são obrigatórios' })
    return
  }

  const tags = SEGMENT_TAGS[segment] || SEGMENT_TAGS.confeccao
  const overpassQuery = buildOverpassQuery(lat, lng, radius, tags)

  try {
    // Overpass API requer User-Agent — GET é mais compatível que POST para evitar 406
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`
    const response = await fetch(overpassUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'SommaGestaoComercial/1.0 (contato@sommagestao.com.br)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(35000),
    })

    if (!response.ok) throw new Error(`Overpass error: ${response.status}`)
    const data = await response.json() as { elements: OverpassElement[] }

    // Busca CNPJs já cadastrados como clientes para cross-reference
    const { rows: existingClients } = await query(
      `SELECT id, name, trade_name, cnpj, city FROM clients WHERE active = true AND cnpj IS NOT NULL`
    )
    const clientCnpjMap = new Map(existingClients.map(c => [c.cnpj?.replace(/\D/g, ''), c]))

    // Busca contatos de prospecção já salvos por este rep
    const { rows: savedContacts } = await query(
      `SELECT osm_id, id, status FROM prospecting_contacts WHERE rep_id = $1`,
      [req.user!.id]
    )
    const savedOsmMap = new Map(savedContacts.map(c => [c.osm_id, c]))

    const elements = data.elements || []
    const prospects = elements
      .filter(el => el.tags?.name)
      .map(el => {
        const elLat = el.type === 'node' ? el.lat : el.center?.lat
        const elLng = el.type === 'node' ? el.lon : el.center?.lon
        const savedContact = savedOsmMap.get(String(el.id))

        return {
          osm_id: String(el.id),
          name: el.tags.name,
          address: [el.tags['addr:street'], el.tags['addr:housenumber']].filter(Boolean).join(', ') || null,
          city: el.tags['addr:city'] || null,
          phone: el.tags.phone || el.tags['contact:phone'] || null,
          website: el.tags.website || el.tags['contact:website'] || null,
          opening_hours: el.tags.opening_hours || null,
          lat: elLat,
          lng: elLng,
          segment,
          already_client: false,
          client_id: null as string | null,
          saved_contact_id: savedContact?.id || null,
          saved_status: savedContact?.status || null,
        }
      })

    res.json({ prospects, total: prospects.length })
  } catch (err) {
    console.error('Overpass error:', err)
    res.status(502).json({ error: 'Erro ao buscar empresas no mapa. Tente novamente.' })
  }
}

// GET /api/prospecting/cnpj/:cnpj
export async function lookupCnpj(req: AuthRequest, res: Response) {
  const cnpj = req.params.cnpj.replace(/\D/g, '')
  if (cnpj.length !== 14) {
    res.status(400).json({ error: 'CNPJ inválido' })
    return
  }

  try {
    const apiRes = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      signal: AbortSignal.timeout(10000),
    })

    if (apiRes.status === 404) {
      res.status(404).json({ error: 'CNPJ não encontrado na Receita Federal' })
      return
    }
    if (!apiRes.ok) throw new Error(`BrasilAPI error: ${apiRes.status}`)

    const data = await apiRes.json() as BrasilApiCnpj

    // Verifica se já é cliente
    const { rows: [existingClient] } = await query(
      `SELECT id, name FROM clients WHERE cnpj ILIKE $1 AND active = true LIMIT 1`,
      [`%${cnpj}%`]
    )

    res.json({
      cnpj: data.cnpj,
      name: data.razao_social,
      trade_name: data.nome_fantasia || null,
      address: [data.logradouro, data.numero].filter(Boolean).join(', '),
      neighborhood: data.bairro || null,
      city: data.municipio || null,
      state: data.uf || null,
      zip: data.cep || null,
      phone: data.ddd_telefone_1 ? `(${data.ddd_telefone_1}) ${data.telefone_1}` : null,
      email: data.email || null,
      capital_social: data.capital_social || null,
      porte: data.porte || null,
      cnae_principal: data.cnae_fiscal_descricao || null,
      situacao: data.descricao_situacao_cadastral || null,
      data_abertura: data.data_inicio_atividade || null,
      already_client: !!existingClient,
      client_id: existingClient?.id || null,
    })
  } catch (err) {
    console.error('BrasilAPI error:', err)
    res.status(502).json({ error: 'Erro ao consultar CNPJ. Tente novamente.' })
  }
}

// GET /api/prospecting/contacts
export async function listContacts(req: AuthRequest, res: Response) {
  const isAdmin = req.user!.role === 'admin'
  const sql = isAdmin
    ? `SELECT pc.*, u.name as rep_name FROM prospecting_contacts pc
       LEFT JOIN users u ON u.id = pc.rep_id
       ORDER BY pc.created_at DESC`
    : `SELECT pc.*, u.name as rep_name FROM prospecting_contacts pc
       LEFT JOIN users u ON u.id = pc.rep_id
       WHERE pc.rep_id = $1
       ORDER BY pc.created_at DESC`

  const params = isAdmin ? [] : [req.user!.id]
  const { rows } = await query(sql, params)
  res.json(rows)
}

// POST /api/prospecting/contacts
export async function createContact(req: AuthRequest, res: Response) {
  const {
    osm_id, name, trade_name, cnpj, address, city, state,
    phone, lat, lng, segment, notes, status,
  } = req.body

  if (!name) { res.status(400).json({ error: 'Nome é obrigatório' }); return }

  const { rows: [existing] } = await query(
    `SELECT id FROM prospecting_contacts WHERE rep_id = $1 AND osm_id = $2 LIMIT 1`,
    [req.user!.id, osm_id || null]
  )

  if (existing && osm_id) {
    res.status(409).json({ error: 'Empresa já está na sua lista de prospecção', id: existing.id })
    return
  }

  const { rows: [row] } = await query(
    `INSERT INTO prospecting_contacts
     (rep_id, osm_id, name, trade_name, cnpj, address, city, state, phone, lat, lng, segment, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      req.user!.id, osm_id || null, name, trade_name || null, cnpj || null,
      address || null, city || null, state || null, phone || null,
      lat || null, lng || null, segment || null, notes || null,
      status || 'prospecto',
    ]
  )
  res.status(201).json(row)
}

// PATCH /api/prospecting/contacts/:id
export async function updateContact(req: AuthRequest, res: Response) {
  const { status, notes, cnpj, phone, contacted_at, client_id } = req.body
  const { rows: [existing] } = await query(
    `SELECT id, rep_id FROM prospecting_contacts WHERE id = $1`,
    [req.params.id]
  )
  if (!existing) { res.status(404).json({ error: 'Contato não encontrado' }); return }
  if (existing.rep_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Sem permissão' }); return
  }

  const { rows: [row] } = await query(
    `UPDATE prospecting_contacts SET
       status = COALESCE($1, status),
       notes = COALESCE($2, notes),
       cnpj = COALESCE($3, cnpj),
       phone = COALESCE($4, phone),
       contacted_at = COALESCE($5, contacted_at),
       client_id = COALESCE($6, client_id),
       updated_at = NOW()
     WHERE id = $7 RETURNING *`,
    [status, notes, cnpj, phone, contacted_at, client_id, req.params.id]
  )
  res.json(row)
}

// DELETE /api/prospecting/contacts/:id
export async function deleteContact(req: AuthRequest, res: Response) {
  const { rows: [existing] } = await query(
    `SELECT rep_id FROM prospecting_contacts WHERE id = $1`,
    [req.params.id]
  )
  if (!existing) { res.status(404).json({ error: 'Contato não encontrado' }); return }
  if (existing.rep_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Sem permissão' }); return
  }
  await query(`DELETE FROM prospecting_contacts WHERE id = $1`, [req.params.id])
  res.status(204).send()
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags: Record<string, string>
}

interface BrasilApiCnpj {
  cnpj: string
  razao_social: string
  nome_fantasia: string
  logradouro: string
  numero: string
  bairro: string
  municipio: string
  uf: string
  cep: string
  ddd_telefone_1: string
  telefone_1: string
  email: string
  capital_social: number
  porte: string
  cnae_fiscal_descricao: string
  descricao_situacao_cadastral: string
  data_inicio_atividade: string
}
