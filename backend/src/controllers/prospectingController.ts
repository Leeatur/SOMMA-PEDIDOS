import { Response } from 'express'
import { query } from '../config/database'
import { AuthRequest } from '../middleware/auth'

// ─── Google Places API (provedor principal) ───────────────────────────────────
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY

const GOOGLE_SEGMENT_CONFIG: Record<string, { type: string; keyword: string }> = {
  confeccao:     { type: 'clothing_store', keyword: 'confecção moda roupa vestuário' },
  calcados:      { type: 'shoe_store',     keyword: 'calçado sapato sapataria' },
  acessorios:    { type: 'jewelry_store',  keyword: 'acessórios bijuteria joias' },
  alimentacao:   { type: 'restaurant',     keyword: 'restaurante café padaria lanchonete' },
  comercio_geral:{ type: 'store',          keyword: 'loja comércio varejo' },
}

async function searchGooglePlaces(lat: number, lng: number, radiusM: number, segment: string) {
  const cfg = GOOGLE_SEGMENT_CONFIG[segment] || GOOGLE_SEGMENT_CONFIG.comercio_geral
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${lat},${lng}&radius=${radiusM}&type=${cfg.type}` +
    `&keyword=${encodeURIComponent(cfg.keyword)}&language=pt-BR&key=${GOOGLE_KEY}`

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`Google Places error: ${res.status}`)
  const data = await res.json() as { status: string; results: GooglePlace[] }
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places status: ${data.status}`)
  }
  return data.results || []
}

interface GooglePlace {
  place_id: string
  name: string
  vicinity: string
  geometry: { location: { lat: number; lng: number } }
  types: string[]
  rating?: number
  opening_hours?: { open_now: boolean }
  business_status?: string
}

// ─── OpenStreetMap / Overpass (fallback quando não há chave Google) ───────────

function buildOverpassQuery(lat: number, lng: number, radiusM: number, segment: string): string {
  const r = radiusM
  const coord = `${lat},${lng}`

  // Confecção: lojas de roupa + qualquer comércio varejista (Brasil usa shop genérico)
  if (segment === 'confeccao') {
    return `[out:json][timeout:30];
(
  nwr["shop"~"clothes|fabric|tailor|fashion|wholesale|boutique|textil|moda|confec"](around:${r},${coord});
  nwr["shop"]["name"~"confec|roupa|moda|vestuário|boutique|textil|tecido|malha",i](around:${r},${coord});
  nwr["shop"~"yes|general|variety_store|gift|department_store"](around:${r},${coord});
);
out center;`
  }

  if (segment === 'calcados') {
    return `[out:json][timeout:30];
(
  nwr["shop"~"shoes|footwear|calcado|sapato|tenis"](around:${r},${coord});
  nwr["shop"]["name"~"calçado|sapato|tenis|chinelo|sapataria|shoe",i](around:${r},${coord});
);
out center;`
  }

  if (segment === 'acessorios') {
    return `[out:json][timeout:30];
(
  nwr["shop"~"jewelry|accessories|watches|gift|bag|leather"](around:${r},${coord});
  nwr["shop"]["name"~"joias|relogio|acessorio|bolsa|bijou|otica",i](around:${r},${coord});
);
out center;`
  }

  if (segment === 'alimentacao') {
    return `[out:json][timeout:30];
(
  nwr["amenity"~"restaurant|cafe|bar|fast_food|bakery|food_court"](around:${r},${coord});
  nwr["shop"~"bakery|butcher|food|supermarket|convenience"](around:${r},${coord});
);
out center;`
  }

  // comercio_geral — todos os estabelecimentos com nome
  return `[out:json][timeout:30];
(
  nwr["shop"](around:${r},${coord});
  nwr["amenity"~"marketplace|pharmacy|bank|hospital|clinic"](around:${r},${coord});
);
out center;`
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

  // Busca contatos já salvos por este rep
  const { rows: savedContacts } = await query(
    `SELECT osm_id, id, status FROM prospecting_contacts WHERE rep_id = $1`,
    [req.user!.id]
  )
  const savedOsmMap = new Map(savedContacts.map((c: { osm_id: string; id: string; status: string }) => [c.osm_id, c]))

  try {
    let prospects: unknown[]

    if (GOOGLE_KEY) {
      // ── Google Places API (dados ricos, cobertura excelente no Brasil) ──
      const places = await searchGooglePlaces(lat, lng, radius, segment)
      prospects = places
        .filter(p => p.business_status !== 'CLOSED_PERMANENTLY')
        .map(p => {
          const placeId = `google_${p.place_id}`
          const saved = savedOsmMap.get(placeId)
          return {
            osm_id: placeId,
            name: p.name,
            address: p.vicinity || null,
            city: null,
            phone: null,
            website: null,
            opening_hours: p.opening_hours?.open_now != null
              ? (p.opening_hours.open_now ? 'Aberto agora' : 'Fechado agora')
              : null,
            lat: p.geometry.location.lat,
            lng: p.geometry.location.lng,
            segment,
            rating: p.rating || null,
            saved_contact_id: saved?.id || null,
            saved_status: saved?.status || null,
          }
        })
    } else {
      // ── Fallback: OpenStreetMap / Overpass ──
      const overpassQuery = buildOverpassQuery(lat, lng, radius, segment)
      const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`
      const response = await fetch(overpassUrl, {
        headers: { 'User-Agent': 'SommaGestaoComercial/1.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(35000),
      })
      if (!response.ok) throw new Error(`Overpass error: ${response.status}`)
      const data = await response.json() as { elements: OverpassElement[] }
      const elements = data.elements || []
      prospects = elements.filter(el => el.tags?.name).map(el => {
        const elLat = el.type === 'node' ? el.lat : el.center?.lat
        const elLng = el.type === 'node' ? el.lon : el.center?.lon
        const saved = savedOsmMap.get(String(el.id))
        return {
          osm_id: String(el.id),
          name: el.tags.name,
          address: [el.tags['addr:street'], el.tags['addr:housenumber']].filter(Boolean).join(', ') || null,
          city: el.tags['addr:city'] || null,
          phone: el.tags.phone || el.tags['contact:phone'] || null,
          website: el.tags.website || el.tags['contact:website'] || null,
          opening_hours: el.tags.opening_hours || null,
          lat: elLat, lng: elLng, segment,
          saved_contact_id: saved?.id || null,
          saved_status: saved?.status || null,
        }
      })
    }

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
