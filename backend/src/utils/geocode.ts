// Geocoding leve via Nominatim (OpenStreetMap, grátis). Usado p/ a "Carteira no Mapa".
// Política do Nominatim: máx ~1 req/s e User-Agent identificável. Cache em memória por chave.
const cache = new Map<string, { lat: number; lng: number } | null>()

const UA = 'SOMMA-ForcaVendas/1.0 (contato@sommatechnology.com.br)'

async function nominatim(q: string): Promise<{ lat: number; lng: number } | null> {
  const key = q.toLowerCase().trim()
  if (cache.has(key)) return cache.get(key)!
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' } })
    if (!res.ok) { cache.set(key, null); return null }
    const data = (await res.json()) as Array<{ lat: string; lon: string }>
    const hit = data[0]
    const out = hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null
    cache.set(key, out)
    return out
  } catch {
    cache.set(key, null)
    return null
  }
}

/** Geocodifica por cidade + UF (centroide). */
export function geocodeCity(city?: string | null, uf?: string | null) {
  if (!city) return Promise.resolve(null)
  const q = [city, uf, 'Brasil'].filter(Boolean).join(', ')
  return nominatim(q)
}

/** Geocodifica por endereço completo; cai pra cidade se não achar. */
export async function geocodeAddress(address?: string | null, city?: string | null, uf?: string | null) {
  if (address && city) {
    const hit = await nominatim([address, city, uf, 'Brasil'].filter(Boolean).join(', '))
    if (hit) return hit
  }
  return geocodeCity(city, uf)
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
