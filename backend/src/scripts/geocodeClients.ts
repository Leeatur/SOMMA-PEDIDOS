// Backfill de coordenadas dos clientes (Carteira no Mapa). Geocodifica quem está sem lat/lng.
// Rodar: cd backend && npm run geocode:clients:prod  (respeita ~1 req/s do Nominatim)
import { pool, query } from '../config/database'
import { geocodeAddress, sleep } from '../utils/geocode'

async function main() {
  console.log('🌍 Geocodificando clientes sem coordenadas...')
  const { rows } = await query(
    `SELECT id, name, address, city, state FROM clients
     WHERE active=true AND (lat IS NULL OR lng IS NULL) AND city IS NOT NULL AND city <> ''`
  )
  console.log(`   ${rows.length} clientes para geocodificar`)
  let ok = 0
  for (const c of rows) {
    const coords = await geocodeAddress(c.address, c.city, c.state)
    if (coords) {
      await query('UPDATE clients SET lat=$1, lng=$2 WHERE id=$3', [coords.lat, coords.lng, c.id])
      ok++
      console.log(`   ✓ ${c.name} (${c.city}/${c.state}) → ${coords.lat}, ${coords.lng}`)
    } else {
      console.log(`   ✗ ${c.name} (${c.city}/${c.state}) — não encontrado`)
    }
    await sleep(1100) // respeita o limite do Nominatim
  }
  console.log(`✅ ${ok}/${rows.length} clientes geocodificados.`)
  await pool.end()
}

main().catch(e => { console.error('❌ Erro:', e); process.exit(1) })
