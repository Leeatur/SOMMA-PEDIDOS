import { query } from '../config/database'
import { geocodeCity } from '../utils/geocode'
import dotenv from 'dotenv'

dotenv.config()

async function run() {
  const { rows } = await query(
    `SELECT id, city, state FROM clients WHERE active=true AND lat IS NULL AND city IS NOT NULL`,
    []
  )
  console.log(`Geocoding ${rows.length} clientes sem coordenadas...`)
  for (const c of rows) {
    const coords = await geocodeCity(c.city, c.state)
    if (coords) {
      await query('UPDATE clients SET lat=$1, lng=$2 WHERE id=$3', [coords.lat, coords.lng, c.id])
      console.log(`✓ ${c.city}/${c.state} → ${coords.lat}, ${coords.lng}`)
    } else {
      console.log(`✗ ${c.city}/${c.state} — não encontrado`)
    }
    await new Promise(r => setTimeout(r, 1100)) // Nominatim: 1 req/s
  }
  process.exit(0)
}

run().catch(e => { console.error(e); process.exit(1) })
