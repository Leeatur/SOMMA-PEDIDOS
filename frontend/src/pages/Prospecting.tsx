import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MapPin, Navigation, Search, Phone, Globe,
  Star, CheckCircle, Clock, XCircle, ChevronDown, Plus,
  FileText, RefreshCw, X, AlertCircle,
} from 'lucide-react'
import { prospectingApi } from '../api/client'

// Corrige ícone padrão do Leaflet no Vite
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const SEGMENTS = [
  { value: 'confeccao', label: 'Confecção' },
  { value: 'calcados', label: 'Calçados' },
  { value: 'acessorios', label: 'Acessórios' },
  { value: 'alimentacao', label: 'Alimentação' },
  { value: 'comercio_geral', label: 'Comércio Geral' },
]

const RADIUS_OPTIONS = [
  { value: 1000, label: '1 km' },
  { value: 2000, label: '2 km' },
  { value: 5000, label: '5 km' },
  { value: 10000, label: '10 km' },
  { value: 20000, label: '20 km' },
]

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  prospecto:        { label: 'Prospecto',         color: '#6D28D9', icon: <Star className="h-3.5 w-3.5" /> },
  contatado:        { label: 'Contatado',          color: '#2563EB', icon: <Phone className="h-3.5 w-3.5" /> },
  visita_agendada:  { label: 'Visita Agendada',   color: '#D97706', icon: <Clock className="h-3.5 w-3.5" /> },
  visitado:         { label: 'Visitado',           color: '#059669', icon: <CheckCircle className="h-3.5 w-3.5" /> },
  convertido:       { label: 'Convertido ✓',      color: '#16A34A', icon: <CheckCircle className="h-3.5 w-3.5" /> },
  descartado:       { label: 'Descartado',         color: '#9CA3AF', icon: <XCircle className="h-3.5 w-3.5" /> },
}

function makeIcon(color: string, saved: boolean) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36">
    <path d="M12 0C5.383 0 0 5.383 0 12c0 9 12 24 12 24s12-15 12-24C24 5.383 18.617 0 12 0z"
      fill="${color}" stroke="white" stroke-width="1.5"/>
    ${saved ? `<circle cx="12" cy="11" r="5" fill="white"/>` : `<circle cx="12" cy="11" r="4" fill="rgba(255,255,255,0.3)"/>`}
  </svg>`
  return L.divIcon({
    html: svg,
    iconSize: [24, 36],
    iconAnchor: [12, 36],
    popupAnchor: [0, -36],
    className: '',
  })
}

function userIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
    <circle cx="16" cy="16" r="14" fill="#1D4ED8" stroke="white" stroke-width="2"/>
    <circle cx="16" cy="16" r="5" fill="white"/>
  </svg>`
  return L.divIcon({ html: svg, iconSize: [32, 32], iconAnchor: [16, 16], className: '' })
}

function FlyTo({ coords }: { coords: [number, number] }) {
  const map = useMap()
  useEffect(() => { map.flyTo(coords, 15, { duration: 1.2 }) }, [coords, map])
  return null
}

interface Prospect {
  osm_id: string
  name: string
  address: string | null
  city: string | null
  phone: string | null
  website: string | null
  opening_hours: string | null
  lat: number
  lng: number
  segment: string
  saved_contact_id: string | null
  saved_status: string | null
}

interface CnpjData {
  cnpj: string
  name: string
  trade_name: string | null
  address: string
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  capital_social: number | null
  porte: string | null
  cnae_principal: string | null
  situacao: string | null
  data_abertura: string | null
  already_client: boolean
  client_id: string | null
}

interface SavedContact {
  id: string
  name: string
  city: string | null
  phone: string | null
  status: string
  segment: string | null
  notes: string | null
  created_at: string
}

export function Prospecting() {
  const qc = useQueryClient()

  const [userPos, setUserPos] = useState<[number, number] | null>(null)
  const [flyTo, setFlyTo] = useState<[number, number] | null>(null)
  const [segment, setSegment] = useState('confeccao')
  const [radius, setRadius] = useState(5000)
  const [activeTab, setActiveTab] = useState<'map' | 'contacts'>('map')
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null)
  const [cnpjInput, setCnpjInput] = useState('')
  const [cnpjData, setCnpjData] = useState<CnpjData | null>(null)
  const [cnpjLoading, setCnpjLoading] = useState(false)
  const [cnpjError, setCnpjError] = useState<string | null>(null)
  const [saveNotes, setSaveNotes] = useState('')
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  const { data: contactsData, isLoading: contactsLoading } = useQuery({
    queryKey: ['prospecting-contacts'],
    queryFn: () => prospectingApi.listContacts().then(r => r.data as SavedContact[]),
  })

  const createContact = useMutation({
    mutationFn: (data: Record<string, unknown>) => prospectingApi.createContact(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospecting-contacts'] })
    },
  })

  const updateContact = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      prospectingApi.updateContact(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospecting-contacts'] })
      doSearch()
    },
  })

  const deleteContact = useMutation({
    mutationFn: (id: string) => prospectingApi.deleteContact(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospecting-contacts'] })
      doSearch()
    },
  })

  function getLocation() {
    setGpsError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude]
        setUserPos(coords)
        setFlyTo(coords)
      },
      (err) => {
        setGpsError(`GPS indisponível: ${err.message}. Ative a localização no navegador.`)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const doSearch = useCallback(async () => {
    if (!userPos) { setGpsError('Permita o acesso à localização primeiro.'); return }
    setSearching(true)
    setSearchError(null)
    try {
      const res = await prospectingApi.searchNearby(userPos[0], userPos[1], radius, segment)
      setProspects(res.data.prospects)
    } catch {
      setSearchError('Erro ao buscar empresas. Verifique sua conexão e tente novamente.')
    } finally {
      setSearching(false)
    }
  }, [userPos, radius, segment])

  async function lookupCnpj() {
    const cnpj = cnpjInput.replace(/\D/g, '')
    if (cnpj.length !== 14) { setCnpjError('Digite 14 dígitos'); return }
    setCnpjLoading(true)
    setCnpjError(null)
    setCnpjData(null)
    try {
      const res = await prospectingApi.lookupCnpj(cnpj)
      setCnpjData(res.data)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      setCnpjError(e?.response?.data?.error || 'CNPJ não encontrado')
    } finally {
      setCnpjLoading(false)
    }
  }

  async function handleSaveProspect(p: Prospect) {
    if (p.saved_contact_id) return
    await createContact.mutateAsync({
      osm_id: p.osm_id,
      name: p.name,
      address: p.address,
      city: p.city,
      phone: p.phone,
      lat: p.lat,
      lng: p.lng,
      segment,
      notes: saveNotes,
      status: 'prospecto',
    })
    setSaveNotes('')
    doSearch()
  }

  async function handleSaveCnpj() {
    if (!cnpjData) return
    await createContact.mutateAsync({
      name: cnpjData.name,
      trade_name: cnpjData.trade_name,
      cnpj: cnpjData.cnpj,
      address: cnpjData.address,
      city: cnpjData.city,
      state: cnpjData.state,
      phone: cnpjData.phone,
      segment,
      notes: saveNotes,
      status: 'prospecto',
    })
    setSaveNotes('')
    setCnpjData(null)
    setCnpjInput('')
  }

  const defaultCenter: [number, number] = userPos || [-29.1684, -51.1794] // Caxias do Sul

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] lg:h-[calc(100vh-57px)]">

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <MapPin className="h-5 w-5 text-purple-600 flex-shrink-0" />
          <h1 className="text-lg font-bold text-gray-900">Prospecção</h1>
        </div>

        {/* Segment */}
        <div className="relative">
          <select
            value={segment}
            onChange={e => setSegment(e.target.value)}
            className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            {SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        </div>

        {/* Radius */}
        <div className="relative">
          <select
            value={radius}
            onChange={e => setRadius(Number(e.target.value))}
            className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            {RADIUS_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        </div>

        <button
          onClick={getLocation}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
        >
          <Navigation className="h-4 w-4" />
          <span className="hidden sm:inline">Minha localização</span>
        </button>

        <button
          onClick={doSearch}
          disabled={searching || !userPos}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {searching
            ? <RefreshCw className="h-4 w-4 animate-spin" />
            : <Search className="h-4 w-4" />
          }
          Buscar
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="bg-white border-b border-gray-200 flex">
        <button
          onClick={() => setActiveTab('map')}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
            activeTab === 'map' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Mapa  {prospects.length > 0 && `(${prospects.length})`}
        </button>
        <button
          onClick={() => setActiveTab('contacts')}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
            activeTab === 'contacts' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Meus Contatos {contactsData && `(${contactsData.length})`}
        </button>
      </div>

      {/* ── Alerts ── */}
      {(gpsError || searchError) && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-amber-800 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {gpsError || searchError}
        </div>
      )}

      {/* ════ TAB: MAPA ════ */}
      {activeTab === 'map' && (
        <div className="flex flex-1 overflow-hidden">

          {/* Map */}
          <div className="flex-1 relative">
            {!userPos && !searching && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50/80">
                <div className="text-center p-6">
                  <Navigation className="h-12 w-12 text-purple-400 mx-auto mb-3" />
                  <p className="text-gray-700 font-semibold mb-1">Ative sua localização</p>
                  <p className="text-gray-500 text-sm mb-4">Clique em "Minha localização" para começar</p>
                  <button
                    onClick={getLocation}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700"
                  >
                    Permitir localização
                  </button>
                </div>
              </div>
            )}

            <MapContainer
              center={defaultCenter}
              zoom={13}
              style={{ height: '100%', width: '100%' }}
              zoomControl={false}
            >
              <TileLayer
                attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {flyTo && <FlyTo coords={flyTo} />}

              {userPos && (
                <>
                  <Marker position={userPos} icon={userIcon()}>
                    <Popup>Você está aqui</Popup>
                  </Marker>
                  <Circle
                    center={userPos}
                    radius={radius}
                    pathOptions={{ color: '#7C3AED', fillColor: '#7C3AED', fillOpacity: 0.05, weight: 1.5, dashArray: '6 4' }}
                  />
                </>
              )}

              {prospects.map(p => {
                if (!p.lat || !p.lng) return null
                const statusKey = p.saved_status || 'prospecto'
                const color = p.saved_contact_id ? STATUS_CONFIG[statusKey]?.color || '#6D28D9' : '#6D28D9'
                return (
                  <Marker
                    key={p.osm_id}
                    position={[p.lat, p.lng]}
                    icon={makeIcon(color, !!p.saved_contact_id)}
                    eventHandlers={{ click: () => { setSelectedProspect(p); detailRef.current?.scrollTo(0, 0) } }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <p className="font-semibold">{p.name}</p>
                        {p.address && <p className="text-gray-500 text-xs">{p.address}</p>}
                      </div>
                    </Popup>
                  </Marker>
                )
              })}
            </MapContainer>

            {searching && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-white rounded-full shadow-lg px-4 py-2 flex items-center gap-2 text-sm text-gray-700">
                <RefreshCw className="h-4 w-4 animate-spin text-purple-600" />
                Buscando empresas...
              </div>
            )}
          </div>

          {/* Side panel */}
          {selectedProspect && (
            <div ref={detailRef} className="w-80 border-l border-gray-200 bg-white overflow-y-auto flex-shrink-0">
              <ProspectDetail
                prospect={selectedProspect}
                onClose={() => setSelectedProspect(null)}
                onSave={handleSaveProspect}
                onUpdateStatus={(id, status) => updateContact.mutate({ id, data: { status } })}
                onDelete={(id) => { deleteContact.mutate(id); setSelectedProspect(null) }}
                saveNotes={saveNotes}
                onNotesChange={setSaveNotes}
                saving={createContact.isPending}
              />
            </div>
          )}
        </div>
      )}

      {/* ════ TAB: CNPJ + CONTATOS ════ */}
      {activeTab === 'contacts' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-6">

          {/* CNPJ Lookup */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-purple-600" />
              Consultar CNPJ
            </h2>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Digite o CNPJ (14 dígitos)"
                value={cnpjInput}
                onChange={e => setCnpjInput(e.target.value.replace(/\D/g, '').slice(0, 14))}
                onKeyDown={e => e.key === 'Enter' && lookupCnpj()}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={lookupCnpj}
                disabled={cnpjLoading}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700 disabled:opacity-50"
              >
                {cnpjLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Consultar'}
              </button>
            </div>
            {cnpjError && <p className="text-red-500 text-xs mt-2">{cnpjError}</p>}

            {cnpjData && (
              <div className="mt-4 border border-gray-100 rounded-lg p-3 space-y-1.5">
                <p className="font-semibold text-gray-900">{cnpjData.name}</p>
                {cnpjData.trade_name && <p className="text-sm text-gray-600">{cnpjData.trade_name}</p>}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 mt-2">
                  {cnpjData.cnae_principal && <span className="col-span-2">📋 {cnpjData.cnae_principal}</span>}
                  {cnpjData.city && <span>📍 {cnpjData.city}/{cnpjData.state}</span>}
                  {cnpjData.phone && <span>📞 {cnpjData.phone}</span>}
                  {cnpjData.situacao && (
                    <span className={cnpjData.situacao.toLowerCase().includes('ativa') ? 'text-green-600' : 'text-red-500'}>
                      ● {cnpjData.situacao}
                    </span>
                  )}
                  {cnpjData.capital_social != null && (
                    <span>💰 {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(cnpjData.capital_social)}</span>
                  )}
                  {cnpjData.data_abertura && <span>📅 Desde {cnpjData.data_abertura}</span>}
                </div>
                {cnpjData.already_client && (
                  <p className="text-xs text-green-600 font-semibold mt-2">✓ Já é cliente no Somma</p>
                )}
                {!cnpjData.already_client && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      placeholder="Observações (opcional)"
                      value={saveNotes}
                      onChange={e => setSaveNotes(e.target.value)}
                      rows={2}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                    />
                    <button
                      onClick={handleSaveCnpj}
                      disabled={createContact.isPending}
                      className="w-full py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <Plus className="h-4 w-4" />
                      Adicionar à prospecção
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Contacts list */}
          <div>
            <h2 className="text-sm font-bold text-gray-800 mb-3">Meus prospectos</h2>
            {contactsLoading && <p className="text-gray-400 text-sm">Carregando...</p>}
            {!contactsLoading && (!contactsData || contactsData.length === 0) && (
              <p className="text-gray-400 text-sm">Nenhum prospecto salvo ainda.</p>
            )}
            <div className="space-y-2">
              {contactsData?.map(c => {
                const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.prospecto
                return (
                  <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: cfg.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-900 truncate">{c.name}</p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                        {c.city && <span>{c.city}</span>}
                        {c.phone && <span>{c.phone}</span>}
                      </div>
                      {c.notes && <p className="text-xs text-gray-400 mt-1 truncate">{c.notes}</p>}
                    </div>
                    <div className="flex-shrink-0">
                      <select
                        value={c.status}
                        onChange={e => updateContact.mutate({ id: c.id, data: { status: e.target.value } })}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none"
                        style={{ color: cfg.color }}
                      >
                        {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Painel de detalhe do prospecto no mapa ──
function ProspectDetail({
  prospect, onClose, onSave, onUpdateStatus, onDelete, saveNotes, onNotesChange, saving,
}: {
  prospect: Prospect
  onClose: () => void
  onSave: (p: Prospect) => void
  onUpdateStatus: (id: string, status: string) => void
  onDelete: (id: string) => void
  saveNotes: string
  onNotesChange: (v: string) => void
  saving: boolean
}) {
  const saved = !!prospect.saved_contact_id
  const cfg = saved ? STATUS_CONFIG[prospect.saved_status || 'prospecto'] : null
  const [cnpjInput, setCnpjInput] = useState('')
  const [cnpjData, setCnpjData] = useState<{name:string;trade_name:string|null;address:string;city:string|null;state:string|null;phone:string|null;email:string|null;cnpj:string;cnae_principal:string|null;situacao:string|null} | null>(null)
  const [cnpjLoading, setCnpjLoading] = useState(false)
  const [cnpjError, setCnpjError] = useState<string|null>(null)

  async function handleCnpjLookup() {
    const cnpj = cnpjInput.replace(/\D/g, '')
    if (cnpj.length !== 14) { setCnpjError('Digite 14 dígitos'); return }
    setCnpjLoading(true); setCnpjError(null)
    try {
      const { prospectingApi } = await import('../api/client')
      const res = await prospectingApi.lookupCnpj(cnpj)
      setCnpjData(res.data)
    } catch { setCnpjError('CNPJ não encontrado') }
    finally { setCnpjLoading(false) }
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto max-h-full">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 text-base leading-tight">{prospect.name}</h3>
          {prospect.city && <p className="text-xs text-gray-500 mt-0.5">{prospect.city}</p>}
        </div>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>

      {saved && cfg && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: cfg.color + '18', color: cfg.color }}>
          {cfg.icon}
          {cfg.label}
        </div>
      )}

      {/* Dados OSM */}
      <div className="space-y-1 text-sm text-gray-700">
        {prospect.address && (
          <div className="flex items-start gap-2">
            <MapPin className="h-3.5 w-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
            <span className="text-xs">{prospect.address}</span>
          </div>
        )}
        {prospect.phone && (
          <div className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
            <a href={`tel:${prospect.phone}`} className="text-blue-600 hover:underline text-xs">{prospect.phone}</a>
          </div>
        )}
        {prospect.website && (
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
            <a href={prospect.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate text-xs">{prospect.website}</a>
          </div>
        )}
        {prospect.opening_hours && (
          <div className="flex items-start gap-2">
            <Clock className="h-3.5 w-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
            <span className="text-xs">{prospect.opening_hours}</span>
          </div>
        )}
        {!prospect.address && !prospect.phone && !prospect.website && (
          <p className="text-xs text-gray-400 italic">Dados de contato não disponíveis no mapa.</p>
        )}
      </div>

      {/* CNPJ lookup inline */}
      <div className="border border-gray-100 rounded-lg p-3 space-y-2 bg-gray-50">
        <p className="text-xs font-semibold text-gray-600 flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" /> Enriquecer via CNPJ
        </p>
        <div className="flex gap-1.5">
          <input
            type="text"
            placeholder="00.000.000/0001-00"
            value={cnpjInput}
            onChange={e => setCnpjInput(e.target.value.replace(/\D/g,'').slice(0,14))}
            onKeyDown={e => e.key==='Enter' && handleCnpjLookup()}
            className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
          <button onClick={handleCnpjLookup} disabled={cnpjLoading}
            className="px-2.5 py-1 bg-purple-600 text-white rounded text-xs font-semibold disabled:opacity-50">
            {cnpjLoading ? '...' : 'OK'}
          </button>
        </div>
        {cnpjError && <p className="text-red-500 text-xs">{cnpjError}</p>}
        {cnpjData && (
          <div className="text-xs space-y-0.5 text-gray-700 pt-1 border-t border-gray-200">
            <p className="font-semibold">{cnpjData.trade_name || cnpjData.name}</p>
            {cnpjData.address && <p>📍 {cnpjData.address}, {cnpjData.city}/{cnpjData.state}</p>}
            {cnpjData.phone && <p>📞 {cnpjData.phone}</p>}
            {cnpjData.email && <p>✉️ {cnpjData.email}</p>}
            {cnpjData.cnae_principal && <p className="text-gray-400">📋 {cnpjData.cnae_principal}</p>}
            {cnpjData.situacao && <p className={cnpjData.situacao.toLowerCase().includes('ativa') ? 'text-green-600 font-semibold' : 'text-red-500'}>● {cnpjData.situacao}</p>}
          </div>
        )}
      </div>

      <a
        href={`https://www.google.com/maps/dir/?api=1&destination=${prospect.lat},${prospect.lng}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full py-2 text-sm font-semibold text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
      >
        <Navigation className="h-4 w-4" />
        Como chegar
      </a>

      {!saved ? (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-500 font-semibold">Adicionar à prospecção</p>
          <textarea
            placeholder="Observações (opcional)"
            value={saveNotes}
            onChange={e => onNotesChange(e.target.value)}
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
          />
          <button
            onClick={() => onSave(prospect)}
            disabled={saving}
            className="w-full py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            {saving ? 'Salvando...' : 'Salvar prospecto'}
          </button>
        </div>
      ) : (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-500 font-semibold">Atualizar status</p>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <button
                key={k}
                onClick={() => onUpdateStatus(prospect.saved_contact_id!, k)}
                className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1 ${
                  prospect.saved_status === k
                    ? 'text-white border-transparent'
                    : 'text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
                style={prospect.saved_status === k ? { background: v.color, borderColor: v.color } : {}}
              >
                {v.icon}
                {v.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => onDelete(prospect.saved_contact_id!)}
            className="w-full py-1.5 text-xs text-red-500 hover:text-red-700 border border-red-100 hover:border-red-200 rounded-lg transition-colors"
          >
            Remover da lista
          </button>
        </div>
      )}
    </div>
  )
}
