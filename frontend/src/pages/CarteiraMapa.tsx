import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { clientsApi, factoriesApi, priceTablesApi, statusesApi } from '../api/client'

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

interface Factory { id: string; name: string }
interface PriceTable { id: string; name: string; collection: string | null; factory_id: string }
interface Status { id: string; name: string; color: string }

const fmtR = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)

// Jitter determinístico para clientes na mesma cidade não sobreporem
function jitter(id: string): [number, number] {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return [((h % 1000) / 1000 - 0.5) * 0.03, (((h >> 10) % 1000) / 1000 - 0.5) * 0.03]
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useMemo(() => {
    if (!points.length) return
    if (points.length === 1) { map.setView(points[0], 11); return }
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50] })
  }, [points, map])
  return null
}

const PIN_COLOR = '#4F46E5'

export function CarteiraMapa() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]   = useState('')
  const [factoryId, setFactoryId]       = useState('')
  const [priceTableId, setPriceTableId] = useState('')
  const [statusId, setStatusId]         = useState('')

  const params = {
    ...(dateFrom    && { date_from: dateFrom }),
    ...(dateTo      && { date_to: dateTo }),
    ...(factoryId   && { factory_id: factoryId }),
    ...(priceTableId && { price_table_id: priceTableId }),
    ...(statusId    && { status_id: statusId }),
  }

  const { data, isLoading } = useQuery<MapClient[]>({
    queryKey: ['clients-map', params],
    queryFn: () => clientsApi.map(params).then(r => r.data),
  })

  const { data: factories } = useQuery<Factory[]>({
    queryKey: ['factories'],
    queryFn: () => factoriesApi.list().then(r => r.data),
  })

  const { data: priceTables } = useQuery<PriceTable[]>({
    queryKey: ['price-tables', factoryId],
    queryFn: () => priceTablesApi.list(factoryId || undefined).then(r => r.data),
  })

  const { data: statuses } = useQuery<Status[]>({
    queryKey: ['statuses'],
    queryFn: () => statusesApi.list().then(r => r.data),
  })

  const filteredTables = factoryId
    ? (priceTables || []).filter(pt => pt.factory_id === factoryId)
    : (priceTables || [])

  const clients = (data || []).map(c => {
    const [dx, dy] = jitter(c.id)
    return { ...c, total_value: Number(c.total_value), plat: Number(c.lat) + dx, plng: Number(c.lng) + dy }
  })

  const points: [number, number][] = clients.map(c => [c.plat, c.plng])
  const totalVendido = clients.reduce((s, c) => s + c.total_value, 0)
  const center: [number, number] = points[0] || [-14.235, -51.925]

  const selectCls = 'border border-outline-variant rounded-lg px-3 py-1.5 text-sm bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40'
  const inputCls  = 'border border-outline-variant rounded-lg px-3 py-1.5 text-sm bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40'

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-outline-variant px-5 py-2.5 lg:px-8">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="h-5 w-5 text-primary" />
          <h1 className="font-display text-lg font-bold text-on-surface">Capilaridade de Vendas</h1>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-outline whitespace-nowrap">De</span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-outline whitespace-nowrap">Até</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className={inputCls}
            />
          </div>

          <select
            value={factoryId}
            onChange={e => { setFactoryId(e.target.value); setPriceTableId('') }}
            className={selectCls}
          >
            <option value="">Todas as fábricas</option>
            {(factories || []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>

          <select
            value={priceTableId}
            onChange={e => setPriceTableId(e.target.value)}
            className={selectCls}
          >
            <option value="">Todas as tabelas</option>
            {filteredTables.map(pt => (
              <option key={pt.id} value={pt.id}>
                {pt.name}{pt.collection ? ` — ${pt.collection}` : ''}
              </option>
            ))}
          </select>

          <select
            value={statusId}
            onChange={e => setStatusId(e.target.value)}
            className={selectCls}
          >
            <option value="">Todos os status</option>
            {(statuses || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {(dateFrom || dateTo || factoryId || priceTableId || statusId) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setFactoryId(''); setPriceTableId(''); setStatusId('') }}
              className="text-xs text-outline hover:text-on-surface underline"
            >
              Limpar filtros
            </button>
          )}

          <span className="ml-auto text-xs text-outline">
            {isLoading ? 'Carregando…' : `${clients.length} clientes · ${fmtR(totalVendido)}`}
          </span>
        </div>
      </div>

      {/* Mapa */}
      <div className="px-4 py-3 lg:px-8">
        {isLoading ? (
          <div className="h-[70vh] flex items-center justify-center text-outline">Carregando mapa…</div>
        ) : clients.length === 0 ? (
          <div className="h-[60vh] flex flex-col items-center justify-center text-center text-outline gap-2">
            <MapPin className="h-10 w-10 text-outline/40" />
            <p className="font-medium">
              {Object.keys(params).length > 0
                ? 'Nenhum cliente com pedidos nesse filtro'
                : 'Nenhum cliente com localização ainda'}
            </p>
            {Object.keys(params).length === 0 && (
              <p className="text-[12px] max-w-sm text-outline/70">
                Execute <code className="bg-surface-variant px-1 rounded">npm run geocode:clients</code> no backend para geocodificar os clientes existentes.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-2xl overflow-hidden border border-outline-variant" style={{ height: '72vh' }}>
            <MapContainer center={center} zoom={5} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
              <TileLayer
                attribution='&copy; OpenStreetMap'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <FitBounds points={points} />
              {clients.map(c => (
                <CircleMarker
                  key={c.id}
                  center={[c.plat, c.plng]}
                  radius={9}
                  pathOptions={{ color: '#fff', weight: 2, fillColor: PIN_COLOR, fillOpacity: 0.85 }}
                >
                  <Popup>
                    <div style={{ minWidth: 180 }}>
                      <p style={{ fontWeight: 700, margin: 0 }}>{c.trade_name || c.name}</p>
                      {c.trade_name && (
                        <p style={{ margin: '2px 0', color: '#64748b', fontSize: 12 }}>{c.name}</p>
                      )}
                      <p style={{ margin: '2px 0', color: '#64748b', fontSize: 12 }}>
                        {[c.city, c.state].filter(Boolean).join(' / ')}
                      </p>
                      <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '6px 0' }} />
                      <p style={{ margin: 0, fontSize: 13 }}><b>{fmtR(c.total_value)}</b> em vendas</p>
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                        {c.order_count} pedido{c.order_count !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        )}
      </div>
    </div>
  )
}
