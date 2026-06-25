import { useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { clientsApi } from '../api/client'

interface MapClient {
  id: string
  name: string
  trade_name: string | null
  city: string | null
  state: string | null
  lat: number
  lng: number
  order_count: number
  total_value: number
}

const fmtR = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)

// Faixas de volume → cor + raio (px). Capilaridade: maior volume = bolha maior/quente.
const TIERS = [
  { min: 20000, color: '#16A34A', label: 'Acima de R$ 20 mil', r: 20 },
  { min: 10000, color: '#D97706', label: 'R$ 10 mil – 20 mil', r: 16 },
  { min: 2500,  color: '#4F46E5', label: 'R$ 2,5 mil – 10 mil', r: 12 },
  { min: 0,     color: '#94A3B8', label: 'Abaixo de R$ 2,5 mil / sem venda', r: 9 },
]
const tierFor = (v: number) => TIERS.find(t => v >= t.min) || TIERS[TIERS.length - 1]

// Jitter determinístico (a partir do id) p/ clientes na mesma cidade não sobreporem (~±1,5 km)
function jitter(id: string): [number, number] {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const dx = ((h % 1000) / 1000 - 0.5) * 0.03
  const dy = (((h >> 10) % 1000) / 1000 - 0.5) * 0.03
  return [dx, dy]
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useMemo(() => {
    if (points.length === 0) return
    if (points.length === 1) { map.setView(points[0], 11); return }
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50] })
  }, [points, map])
  return null
}

export function CarteiraMapa() {
  const { data, isLoading } = useQuery<MapClient[]>({
    queryKey: ['clients-map'],
    queryFn: () => clientsApi.map().then(r => r.data),
  })

  const clients = (data || []).map(c => {
    const [dx, dy] = jitter(c.id)
    return { ...c, total_value: Number(c.total_value), plat: Number(c.lat) + dx, plng: Number(c.lng) + dy }
  })
  const points: [number, number][] = clients.map(c => [c.plat, c.plng])
  const totalVendido = clients.reduce((s, c) => s + c.total_value, 0)
  const center: [number, number] = points[0] || [-14.235, -51.925] // Brasil

  return (
    <div className="pb-24 lg:pb-0">
      <div className="bg-white border-b border-outline-variant px-5 py-2.5 lg:px-8">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="font-display text-lg font-bold text-on-surface flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" /> Carteira no Mapa
            </h1>
            <p className="text-[12px] text-outline mt-0.5">
              {clients.length} clientes · {fmtR(totalVendido)} vendidos
            </p>
          </div>
          {/* Legenda */}
          <div className="flex flex-wrap gap-3">
            {TIERS.map(t => (
              <span key={t.label} className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
                <span className="inline-block rounded-full" style={{ width: 12, height: 12, backgroundColor: t.color }} />
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 lg:px-8">
        {isLoading ? (
          <div className="h-[70vh] flex items-center justify-center text-outline">Carregando mapa…</div>
        ) : clients.length === 0 ? (
          <div className="h-[60vh] flex flex-col items-center justify-center text-center text-outline gap-2">
            <MapPin className="h-10 w-10 text-outline/40" />
            <p className="font-medium">Nenhum cliente com localização ainda</p>
            <p className="text-[12px] max-w-sm">Os clientes aparecem no mapa após serem geocodificados (cidade no cadastro). Rode o backfill de geocoding ou cadastre um cliente com cidade.</p>
          </div>
        ) : (
          <div className="rounded-2xl overflow-hidden border border-outline-variant" style={{ height: '72vh' }}>
            <MapContainer center={center} zoom={5} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
              <TileLayer
                attribution='&copy; OpenStreetMap'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <FitBounds points={points} />
              {clients.map(c => {
                const tier = tierFor(c.total_value)
                return (
                  <CircleMarker
                    key={c.id}
                    center={[c.plat, c.plng]}
                    radius={tier.r}
                    pathOptions={{ color: '#fff', weight: 2, fillColor: tier.color, fillOpacity: 0.85 }}
                  >
                    <Popup>
                      <div style={{ minWidth: 180 }}>
                        <p style={{ fontWeight: 700, margin: 0 }}>{c.trade_name || c.name}</p>
                        {c.trade_name && <p style={{ margin: '2px 0', color: '#64748b', fontSize: 12 }}>{c.name}</p>}
                        <p style={{ margin: '2px 0', color: '#64748b', fontSize: 12 }}>{[c.city, c.state].filter(Boolean).join(' / ')}</p>
                        <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '6px 0' }} />
                        <p style={{ margin: 0, fontSize: 13 }}><b>{fmtR(c.total_value)}</b> em vendas</p>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{c.order_count} pedido{c.order_count !== 1 ? 's' : ''}</p>
                      </div>
                    </Popup>
                  </CircleMarker>
                )
              })}
            </MapContainer>
          </div>
        )}
      </div>
    </div>
  )
}
