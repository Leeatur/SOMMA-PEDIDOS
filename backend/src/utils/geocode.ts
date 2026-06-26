import https from 'https'

export async function geocodeCity(city: string, state?: string | null): Promise<{ lat: number; lng: number } | null> {
  const q = [city, state, 'Brasil'].filter(Boolean).join(', ')
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&countrycodes=br`
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'SommaPedidos/1.0' } }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const results = JSON.parse(data)
          if (results.length > 0) resolve({ lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) })
          else resolve(null)
        } catch { resolve(null) }
      })
    }).on('error', () => resolve(null))
  })
}
