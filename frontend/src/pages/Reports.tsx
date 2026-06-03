import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart2, ChevronDown, ChevronRight } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { reportsApi, factoriesApi, priceTablesApi, usersApi, ordersApi } from '../api/client'
import { PageSpinner } from '../components/ui/Spinner'

// ─── formatters ──────────────────────────────────────────────────────────────

const fmtR = (v: number | string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)

const fmtN = (v: number | string) =>
  new Intl.NumberFormat('pt-BR').format(Number(v) || 0)

function todayStr() { return new Date().toISOString().split('T')[0] }
function daysAgoStr(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]
}
// Handles both "YYYY-MM-DD" strings and ISO timestamps returned by pg
function fmtDatePtBR(d: string | Date): string {
  const iso = typeof d === 'string' ? d : (d as Date).toISOString()
  const [y, m, day] = iso.substring(0, 10).split('-')
  return `${day}/${m}/${y}`
}

// ─── types ───────────────────────────────────────────────────────────────────

type Tab = 'orders' | 'commissions' | 'clients' | 'products' | 'collections' | 'catalog'

interface OrderSummary {
  order_count: number; total_pieces: number
  total_value: number; rep_commission_value: number; office_commission_value: number
}
interface OrderDay {
  date: string; order_count: number; total_pieces: number; total_value: number
}
interface CommissionRow {
  id: string
  order_number: number
  data_venda: string
  industria: string
  vendedor: string
  nr_ped_fabrica: string | null
  razao_social: string
  cliente: string | null
  cidade: string | null
  uf: string | null
  items_refs: string | null
  items_count: number
  total_pieces: number
  total_value: number
  discount_pct: number
  rep_commission_value: number
  rep_commission_pct: number
  office_commission_value: number
  office_commission_pct: number
  valor_faturado: number
  falta_faturar: number
  status_name: string | null
  status_color: string | null
}
interface ClientRow {
  id: string; name: string; trade_name: string; city: string; state: string
  order_count: number; total_pieces: number; total_value: number
}
interface ProductRow {
  reference: string; order_count: number; total_pieces: number; total_value: number
}
interface CollectionProduct {
  product_id: string; reference: string; product_name: string; type: string
  order_count: number; total_pieces: number; total_value: number
}
interface CollectionRow {
  price_table_id: string; factory_name: string; table_name: string
  collection: string; season: string; year: number | null
  products: CollectionProduct[]
}
interface Factory { id: string; name: string }
interface PriceTableMeta { id: string; name: string; collection: string; season: string; year: number | null; factory_name: string }
interface User { id: string; name: string; role: string }

interface CatalogGradeConfig { color: string | null; sizes: Record<string, number>; total_pieces: number }
interface CatalogProduct {
  product_id: string; reference: string; product_name: string | null; model: string | null
  size_range: string | null; base_price: number; type: 'regular' | 'pack'
  observation: string | null; image_url: string | null; grade_configs: CatalogGradeConfig[]
}
interface CatalogRow {
  price_table_id: string; factory_name: string; table_name: string
  collection: string; season: string; year: number | null
  products: CatalogProduct[]
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center py-16">
      <BarChart2 className="h-10 w-10 text-gray-200 mx-auto mb-3" />
      <p className="text-[12px] text-outline/70">{label}</p>
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-1.5 text-[12px] font-semibold text-outline ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, right, bold }: { children: React.ReactNode; right?: boolean; bold?: boolean }) {
  return (
    <td className={`px-4 py-2 text-[12px] ${right ? 'text-right' : ''} ${bold ? 'font-bold text-on-surface' : 'text-on-surface-variant'}`}>
      {children}
    </td>
  )
}

// ─── Size helpers ─────────────────────────────────────────────────────────────

const CAT_SIZE_ORDER = [
  'RN','PP','XP','P','M','G','GG','XG','EXG','XGG','2XG','3XG','4XG',
  '34','36','38','40','42','44','46','48','50','52','54','56','58','60',
  '1','2','4','6','8','10','12','14','16','18','U',
]

function catExpandSize(key: string): string[] {
  const m = key.match(/^([A-Za-z0-9]+)-([A-Za-z0-9]+)$/)
  if (m) {
    const s = CAT_SIZE_ORDER.indexOf(m[1].toUpperCase())
    const e = CAT_SIZE_ORDER.indexOf(m[2].toUpperCase())
    if (s >= 0 && e >= s) return CAT_SIZE_ORDER.slice(s, e + 1)
  }
  return [key]
}

function catSortSizes(sizes: string[]) {
  return [...sizes].sort((a, b) => {
    const ai = CAT_SIZE_ORDER.indexOf(a.toUpperCase())
    const bi = CAT_SIZE_ORDER.indexOf(b.toUpperCase())
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1; if (bi === -1) return -1
    return ai - bi
  })
}

function catGetSizes(p: CatalogProduct): string[] {
  if (p.size_range) {
    const expanded = catExpandSize(p.size_range)
    if (expanded.length > 1) return expanded
  }
  const keys = p.grade_configs.flatMap(gc => Object.keys(gc.sizes)).flatMap(catExpandSize)
  return catSortSizes(Array.from(new Set(keys)))
}

// ─── CatalogTab ───────────────────────────────────────────────────────────────

function CatalogTab({ data }: { data: CatalogRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  function toggle(id: string) {
    setExpanded(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const q = search.toLowerCase().trim()

  const filtered = data.map(row => ({
    ...row,
    products: q
      ? row.products.filter(p =>
          p.reference.toLowerCase().includes(q) ||
          (p.product_name || '').toLowerCase().includes(q) ||
          (p.model || '').toLowerCase().includes(q))
      : row.products,
  })).filter(row => !q || row.products.length > 0)

  const allIds = filtered.map(r => r.price_table_id)
  const allExpanded = allIds.every(id => expanded.has(id))

  function toggleAll() {
    if (allExpanded) setExpanded(new Set())
    else setExpanded(new Set(allIds))
  }

  return (
    <div className="space-y-1.5">
      {/* Search + expand all */}
      <div className="flex gap-2 items-center">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar referência, nome..."
          className="flex-1 border border-outline-variant rounded-lg px-3 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          onClick={toggleAll}
          className="text-[12px] text-primary underline whitespace-nowrap"
        >
          {allExpanded ? 'Recolher tudo' : 'Expandir tudo'}
        </button>
      </div>

      {filtered.length === 0 && <EmptyState label="Nenhum produto encontrado" />}

      {filtered.map(row => {
        const isOpen = expanded.has(row.price_table_id) || !!q
        const label = [row.collection, row.season, row.year].filter(Boolean).join(' · ')
        return (
          <div key={row.price_table_id} className="bg-white rounded-xl border border-outline-variant overflow-hidden">
            {/* Header */}
            <button
              className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-surface-container-low transition-colors"
              onClick={() => toggle(row.price_table_id)}
            >
              {isOpen
                ? <ChevronDown className="h-4 w-4 text-outline/70 flex-shrink-0" />
                : <ChevronRight className="h-4 w-4 text-outline/70 flex-shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-on-surface text-[12px]">{row.table_name}</span>
                  <span className="text-[12px] text-primary font-medium bg-primary/10 px-2 py-0.5 rounded-full">{row.factory_name}</span>
                  {label && <span className="text-[12px] text-outline">{label}</span>}
                </div>
              </div>
              <span className="text-[12px] text-outline/70 flex-shrink-0">{row.products.length} ref.</span>
            </button>

            {/* Product Cards */}
            {isOpen && (
              <div className="border-t border-outline-variant/50 p-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {row.products.map(p => {
                    const sizes = catGetSizes(p)
                    return (
                      <div key={p.product_id} className="bg-white border border-outline-variant/60 rounded-xl overflow-hidden hover:shadow-md transition-shadow">
                        {/* Imagem */}
                        <div className="aspect-square bg-surface-container-low flex items-center justify-center overflow-hidden">
                          {p.image_url
                            ? <img src={p.image_url} alt={p.reference} className="w-full h-full object-cover" loading="lazy" />
                            : <div className="flex flex-col items-center gap-1 text-outline/30">
                                <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                <span className="text-[12px]">Sem foto</span>
                              </div>
                          }
                        </div>
                        {/* Info */}
                        <div className="p-2">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className="font-mono text-[12px] font-bold text-on-surface truncate">{p.reference}</span>
                            {p.type === 'pack'
                              ? <span className="text-[12px] font-bold bg-orange-100 text-orange-700 px-1 rounded flex-shrink-0">PACK</span>
                              : <span className="text-[12px] font-bold bg-blue-50 text-blue-600 px-1 rounded flex-shrink-0">REG</span>
                            }
                          </div>
                          {p.product_name && <p className="text-[12px] text-on-surface-variant leading-tight line-clamp-2">{p.product_name}</p>}
                          {p.model && <p className="text-[12px] text-outline mt-0.5 truncate">{p.model}</p>}
                          <p className="text-[12px] font-bold text-primary mt-1">{fmtR(p.base_price)}</p>
                          {sizes.length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-1">
                              {sizes.slice(0, 8).map(s => (
                                <span key={s} className="px-1 py-0.5 text-[12px] font-semibold bg-primary/10 text-primary rounded">{s}</span>
                              ))}
                              {sizes.length > 8 && <span className="text-[12px] text-outline">+{sizes.length - 8}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── CollectionsTab ───────────────────────────────────────────────────────────

function CollectionsTab({ data }: { data: CollectionRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  function toggle(id: string) {
    setExpanded(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const q = search.toLowerCase().trim()

  return (
    <div className="space-y-1.5">
      {/* busca rápida por referência */}
      <input
        type="text"
        placeholder="Buscar referência..."
        value={search}
        onChange={e => {
          setSearch(e.target.value)
          // expande todas as coleções quando busca ativa
          if (e.target.value) setExpanded(new Set(data.map(c => c.price_table_id)))
          else setExpanded(new Set())
        }}
        className="w-full border border-outline-variant rounded-lg px-3 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />

      {data.map(col => {
        const products = q
          ? col.products.filter(p =>
              p.reference.toLowerCase().includes(q) ||
              (p.product_name || '').toLowerCase().includes(q)
            )
          : col.products
        if (q && products.length === 0) return null

        const soldCount  = products.filter(p => p.total_pieces > 0).length
        const totalPcs   = products.reduce((s, p) => s + p.total_pieces, 0)
        const totalVal   = products.reduce((s, p) => s + Number(p.total_value), 0)
        const isOpen     = expanded.has(col.price_table_id)

        return (
          <div key={col.price_table_id} className="bg-white rounded-xl border border-outline-variant overflow-hidden">

            {/* ── Cabeçalho da coleção ── */}
            <button
              onClick={() => toggle(col.price_table_id)}
              className="w-full flex items-center gap-3 px-4 py-2 hover:bg-surface-container-low transition-colors text-left"
            >
              {isOpen
                ? <ChevronDown className="h-4 w-4 text-outline/70 flex-shrink-0" />
                : <ChevronRight className="h-4 w-4 text-outline/70 flex-shrink-0" />}

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[12px] font-bold text-on-surface">{col.factory_name}</span>
                  <span className="text-[12px] text-outline/70">—</span>
                  <span className="text-[12px] text-on-surface-variant truncate">{col.collection}</span>
                  {col.season && (
                    <span className="text-[12px] text-primary font-medium">
                      {col.season}{col.year ? ` ${col.year}` : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* totais resumo */}
              <div className="hidden sm:flex items-center gap-4 flex-shrink-0">
                <div className="text-right">
                  <p className="text-[12px] text-outline/70">Refs vendidas</p>
                  <p className="text-[12px] font-bold text-on-surface-variant">
                    {soldCount}
                    <span className="text-[12px] text-outline/70 font-normal"> / {products.length}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[12px] text-outline/70">Peças</p>
                  <p className="text-[12px] font-bold text-on-surface-variant">{fmtN(totalPcs)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[12px] text-outline/70">Valor</p>
                  <p className="text-[12px] font-bold text-primary">{fmtR(totalVal)}</p>
                </div>
              </div>
            </button>

            {/* ── Linha de totais mobile ── */}
            {!isOpen && (
              <div className="sm:hidden flex items-center gap-4 px-11 pb-2 text-[12px] text-outline">
                <span>{soldCount}/{products.length} refs</span>
                <span>{fmtN(totalPcs)} pç</span>
                <span className="font-semibold text-primary">{fmtR(totalVal)}</span>
              </div>
            )}

            {/* ── Tabela de referências (expandida) ── */}
            {isOpen && (
              <div className="border-t border-outline-variant/50">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-surface-container-low">
                      <tr>
                        <Th>Referência</Th>
                        <Th>Produto</Th>
                        <Th right>Pedidos</Th>
                        <Th right>Peças</Th>
                        <Th right>Valor</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {products.map(p => (
                        <tr
                          key={p.product_id}
                          className={`hover:bg-surface-container-low/50 ${p.total_pieces === 0 ? 'opacity-50' : ''}`}
                        >
                          <td className="px-4 py-1.5 font-mono text-[12px] font-bold text-on-surface whitespace-nowrap">
                            {p.reference}
                            {p.type === 'pack' && (
                              <span className="ml-1 text-[12px] text-amber-600 font-sans font-medium bg-amber-50 px-1 rounded">pack</span>
                            )}
                          </td>
                          <td className="px-4 py-1.5 text-[12px] text-on-surface-variant max-w-[200px] truncate">
                            {p.product_name || '—'}
                          </td>
                          <Td right>{p.order_count > 0 ? p.order_count : '—'}</Td>
                          <Td right bold={p.total_pieces > 0}>{p.total_pieces > 0 ? fmtN(p.total_pieces) : '—'}</Td>
                          <Td right>{p.total_value > 0 ? fmtR(p.total_value) : '—'}</Td>
                        </tr>
                      ))}
                    </tbody>
                    {totalPcs > 0 && (
                      <tfoot>
                        <tr className="bg-surface-container-low border-t border-outline-variant">
                          <td colSpan={2} className="px-4 py-1 text-[12px] font-bold text-on-surface-variant">
                            {soldCount} ref{soldCount !== 1 ? 's' : ''} vendida{soldCount !== 1 ? 's' : ''} de {products.length}
                          </td>
                          <td className="px-4 py-1 text-right text-[12px] font-bold text-on-surface-variant">
                            {products.reduce((s, p) => s + p.order_count, 0)}
                          </td>
                          <td className="px-4 py-1 text-right text-[12px] font-bold text-on-surface-variant">{fmtN(totalPcs)}</td>
                          <td className="px-4 py-1 text-right text-[12px] font-bold text-primary">{fmtR(totalVal)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

export function Reports() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [tab, setTab] = useState<Tab>('orders')
  const [dateFrom, setDateFrom] = useState(daysAgoStr(29))
  const [dateTo, setDateTo] = useState(todayStr())
  const [factoryId, setFactoryId] = useState('')
  const [repId, setRepId] = useState('')

  // Catalog-specific filters
  const [catalogFactoryId, setCatalogFactoryId] = useState('')
  const [catalogPriceTableId, setCatalogPriceTableId] = useState('')

  function setRange(days: number) {
    setDateFrom(daysAgoStr(days - 1))
    setDateTo(todayStr())
  }

  // ─── shared filter params ──────────────────────────────────────────────────

  const baseParams = {
    date_from: dateFrom,
    date_to: dateTo,
    factory_id: factoryId || undefined,
    rep_id: repId || undefined,
  }

  // ─── support queries ───────────────────────────────────────────────────────

  const { data: factories } = useQuery<Factory[]>({
    queryKey: ['factories'],
    queryFn: () => factoriesApi.list().then(r => r.data),
  })

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
    enabled: isAdmin,
  })

  const reps = (allUsers || []).filter(u => u.role === 'representante')

  // For non-admins: derive catalog factory list from their own orders
  const { data: repOrders } = useQuery<Array<{ factory_id: string; factory_name: string }>>({
    queryKey: ['orders'],
    queryFn: () => ordersApi.list().then(r => r.data),
    enabled: !isAdmin,
  })

  const catalogFactories = useMemo(() => {
    if (isAdmin) return factories || []
    const seen = new Map<string, Factory>()
    for (const o of repOrders || []) {
      if (o.factory_id && !seen.has(o.factory_id))
        seen.set(o.factory_id, { id: o.factory_id, name: o.factory_name })
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [isAdmin, repOrders, factories])

  // ─── report queries ────────────────────────────────────────────────────────

  const ordersQ = useQuery<{ summary: OrderSummary; byDay: OrderDay[] }>({
    queryKey: ['rpt-orders', dateFrom, dateTo, factoryId, repId],
    queryFn: () => reportsApi.orders(baseParams).then(r => r.data),
    enabled: tab === 'orders',
  })

  const commissionsQ = useQuery<CommissionRow[]>({
    queryKey: ['rpt-commissions', dateFrom, dateTo, repId, factoryId],
    queryFn: () => reportsApi.commissions({ date_from: dateFrom, date_to: dateTo, rep_id: repId || undefined, factory_id: factoryId || undefined }).then(r => r.data),
    enabled: tab === 'commissions',
  })

  const clientsQ = useQuery<ClientRow[]>({
    queryKey: ['rpt-clients', dateFrom, dateTo, factoryId, repId],
    queryFn: () => reportsApi.clients(baseParams).then(r => r.data),
    enabled: tab === 'clients',
  })

  const productsQ = useQuery<ProductRow[]>({
    queryKey: ['rpt-products', dateFrom, dateTo, factoryId, repId],
    queryFn: () => reportsApi.products(baseParams).then(r => r.data),
    enabled: tab === 'products',
  })

  const collectionsQ = useQuery<CollectionRow[]>({
    queryKey: ['rpt-collections', dateFrom, dateTo, factoryId, repId],
    queryFn: () => reportsApi.collections(baseParams).then(r => r.data),
    enabled: tab === 'collections',
  })

  const { data: catalogPriceTables } = useQuery<PriceTableMeta[]>({
    queryKey: ['price-tables', catalogFactoryId],
    queryFn: () => priceTablesApi.list(catalogFactoryId || undefined).then(r => r.data),
    enabled: tab === 'catalog',
  })

  const catalogQ = useQuery<CatalogRow[]>({
    queryKey: ['rpt-catalog', catalogFactoryId, catalogPriceTableId],
    queryFn: () => reportsApi.catalog({
      price_table_id: catalogPriceTableId || undefined,
      factory_id: catalogPriceTableId ? undefined : (catalogFactoryId || undefined),
    }).then(r => r.data),
    enabled: tab === 'catalog',
  })

  // ─── tabs config ───────────────────────────────────────────────────────────

  const ALL_TABS: { id: Tab; label: string; adminOnly?: boolean }[] = [
    { id: 'orders',      label: 'Visão Geral' },
    { id: 'commissions', label: 'Comissões' },
    { id: 'clients',     label: 'Clientes' },
    { id: 'collections', label: 'Curva ABC de Produtos' },
    { id: 'catalog',     label: 'Catálogo de Coleção' },
  ]
  const TABS = ALL_TABS.filter(t => !t.adminOnly || isAdmin)

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <div className="pb-24 lg:pb-0">

      {/* ── sticky header ── */}
      <div className="bg-white border-b border-outline-variant px-4 py-2.5 lg:px-8 space-y-1.5">
        <div className="w-full space-y-1.5">

          <div className="flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold text-on-surface">Relatórios</h1>
          </div>

          {/* ── filters ── */}
          <div className="flex flex-wrap items-center gap-2">
            {/* date inputs */}
            <input
              type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-outline-variant rounded-lg px-3 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-outline/70 text-[12px]">–</span>
            <input
              type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-outline-variant rounded-lg px-3 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary"
            />

            {/* quick range buttons */}
            <div className="flex gap-1">
              {[{ label: '7d', d: 7 }, { label: '30d', d: 30 }, { label: '90d', d: 90 }].map(r => (
                <button
                  key={r.label} onClick={() => setRange(r.d)}
                  className="px-2.5 py-1.5 text-[12px] font-medium text-on-surface-variant bg-surface-container hover:bg-surface-container-high rounded-lg transition-colors"
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* factory filter */}
            {(
              <select
                value={factoryId} onChange={e => setFactoryId(e.target.value)}
                className="border border-outline-variant rounded-lg px-3 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              >
                <option value="">Todas as fábricas</option>
                {(factories || []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}

            {/* rep filter — admin only, hidden on products tab */}
            {isAdmin && tab !== 'products' && (
              <select
                value={repId} onChange={e => setRepId(e.target.value)}
                className="border border-outline-variant rounded-lg px-3 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              >
                <option value="">Todos os representantes</option>
                {reps.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
          </div>

          {/* ── tab bar ── */}
          <div className="flex gap-0 border-b border-outline-variant">
            {TABS.map(t => (
              <button
                key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 text-[12px] font-medium border-b-2 transition-colors -mb-px ${
                  tab === t.id
                    ? 'border-blue-600 text-primary'
                    : 'border-transparent text-outline hover:text-on-surface-variant'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── tab content ── */}
      <div className={`px-4 py-3 lg:px-6`}>

        {/* ═══ VISÃO GERAL ══════════════════════════════════════════════════ */}
        {tab === 'orders' && (
          ordersQ.isLoading ? <PageSpinner /> :
          !ordersQ.data ? null :
          <div className="space-y-1">

            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Pedidos',     value: fmtN(ordersQ.data.summary.order_count),       color: 'bg-primary/10',    text: 'text-primary' },
                { label: 'Peças',       value: fmtN(ordersQ.data.summary.total_pieces),       color: 'bg-purple-50',  text: 'text-purple-700' },
                { label: 'Valor Total', value: fmtR(ordersQ.data.summary.total_value),         color: 'bg-surface-container-low',    text: 'text-on-surface' },
                { label: 'Com. Rep',    value: fmtR(ordersQ.data.summary.rep_commission_value), color: 'bg-emerald-50', text: 'text-emerald-700' },
              ].map(c => (
                <div key={c.label} className={`${c.color} rounded-xl border border-outline-variant/50 p-4`}>
                  <p className="text-[12px] text-outline mb-1">{c.label}</p>
                  <p className={`text-[12px] font-bold ${c.text}`}>{c.value}</p>
                  {c.label === 'Com. Rep' && isAdmin && (
                    <p className="text-[12px] text-outline/70 mt-0.5">
                      Esc: {fmtR(ordersQ.data.summary.office_commission_value)}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* By-day table */}
            {ordersQ.data.byDay.length === 0
              ? <EmptyState label="Nenhum pedido no período" />
              : (
                <div className="bg-white rounded-xl border border-outline-variant overflow-hidden">
                  <p className="px-4 py-2 text-[12px] font-semibold text-on-surface border-b border-outline-variant/50">Por dia</p>
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="bg-surface-container-low">
                        <tr>
                          <Th>Data</Th>
                          <Th right>Pedidos</Th>
                          <Th right>Peças</Th>
                          <Th right>Valor</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {ordersQ.data.byDay.map(d => (
                          <tr key={d.date} className="hover:bg-surface-container-low/50">
                            <Td>{fmtDatePtBR(d.date)}</Td>
                            <Td right>{d.order_count}</Td>
                            <Td right>{fmtN(d.total_pieces)}</Td>
                            <Td right bold>{fmtR(d.total_value)}</Td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-surface-container-low border-t border-outline-variant">
                          <td className="px-4 py-1.5 text-[12px] font-bold text-on-surface-variant">Total</td>
                          <td className="px-4 py-1.5 text-right text-[12px] font-bold text-on-surface-variant">
                            {ordersQ.data.byDay.reduce((s, d) => s + d.order_count, 0)}
                          </td>
                          <td className="px-4 py-1.5 text-right text-[12px] font-bold text-on-surface-variant">
                            {fmtN(ordersQ.data.byDay.reduce((s, d) => s + d.total_pieces, 0))}
                          </td>
                          <td className="px-4 py-1.5 text-right text-[12px] font-bold text-on-surface">
                            {fmtR(ordersQ.data.byDay.reduce((s, d) => s + Number(d.total_value), 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )
            }
          </div>
        )}

        {/* ═══ COMISSÕES ════════════════════════════════════════════════════ */}
        {tab === 'commissions' && (
          commissionsQ.isLoading ? <PageSpinner /> :
          !commissionsQ.data ? null :
          commissionsQ.data.length === 0
            ? <EmptyState label="Nenhum dado de comissão no período" />
            : (() => {
                const rows = commissionsQ.data
                const sum = (key: keyof CommissionRow) =>
                  rows.reduce((s, r) => s + Number(r[key] || 0), 0)
                const fmtDate = (d: string) => fmtDatePtBR(d)
                const fmtPct = (v: number) => `${Number(v || 0).toFixed(2).replace('.', ',')}%`
                return (
                  <div className="bg-white rounded-xl border border-outline-variant overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="text-[12px]" style={{ minWidth: 1100 }}>
                        <thead className="bg-surface-container-low">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-semibold text-on-surface-variant whitespace-nowrap">Data</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-on-surface-variant whitespace-nowrap">Vendedor</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-on-surface-variant whitespace-nowrap">Indústria</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-on-surface-variant whitespace-nowrap">Nr. Fábrica</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-on-surface-variant">Razão Social</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-on-surface-variant">Nome Fantasia</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-on-surface-variant whitespace-nowrap">Cidade</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-on-surface-variant whitespace-nowrap">UF</th>
                            <th className="px-2 py-1.5 text-right font-semibold text-on-surface-variant whitespace-nowrap">Valor</th>
                            <th className="px-2 py-1.5 text-right font-semibold text-emerald-700 whitespace-nowrap">Com. Rep</th>
                            {isAdmin && <th className="px-2 py-1.5 text-right font-semibold text-blue-700 whitespace-nowrap">Com. Escr.</th>}
                            <th className="px-2 py-1.5 text-right font-semibold text-on-surface-variant whitespace-nowrap">Faturado</th>
                            <th className="px-2 py-1.5 text-right font-semibold text-orange-600 whitespace-nowrap">A Faturar</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {rows.map(r => (
                            <tr key={r.id} className="hover:bg-surface-container-low/50 cursor-pointer" onClick={() => window.open(`/orders/${r.id}`, '_self')}>
                              <td className="px-2 py-1 whitespace-nowrap text-on-surface-variant">{fmtDate(r.data_venda)}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-on-surface-variant">{r.vendedor}</td>
                              <td className="px-2 py-1 whitespace-nowrap font-medium text-on-surface">{r.industria}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-on-surface-variant">{r.nr_ped_fabrica || '—'}</td>
                              <td className="px-2 py-1 max-w-[160px]">
                                <span className="block truncate text-on-surface font-medium" title={r.razao_social}>{r.razao_social}</span>
                              </td>
                              <td className="px-2 py-1 max-w-[130px]">
                                <span className="block truncate text-on-surface-variant" title={r.cliente || ''}>{r.cliente || '—'}</span>
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-on-surface-variant">{r.cidade || '—'}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-on-surface-variant">{r.uf || '—'}</td>
                              <td className="px-2 py-1 text-right whitespace-nowrap font-bold text-on-surface">{fmtR(r.total_value)}</td>
                              <td className="px-2 py-1 text-right whitespace-nowrap">
                                <span className="font-bold text-emerald-700">{fmtR(r.rep_commission_value)}</span>
                                <span className="text-emerald-600/70 ml-0.5 text-[12px]">({fmtPct(r.rep_commission_pct)})</span>
                              </td>
                              {isAdmin && (
                                <td className="px-2 py-1 text-right whitespace-nowrap">
                                  <span className="font-bold text-blue-700">{fmtR(r.office_commission_value)}</span>
                                  <span className="text-blue-600/70 ml-0.5 text-[12px]">({fmtPct(r.office_commission_pct)})</span>
                                </td>
                              )}
                              <td className="px-2 py-1 text-right whitespace-nowrap font-medium text-on-surface-variant">{fmtR(r.valor_faturado)}</td>
                              <td className="px-2 py-1 text-right whitespace-nowrap">
                                {Number(r.falta_faturar) > 0
                                  ? <span className="font-bold text-orange-600">{fmtR(r.falta_faturar)}</span>
                                  : <span className="text-on-surface-variant/50">—</span>
                                }
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-surface-container-low border-t-2 border-outline-variant font-bold">
                            <td className="px-2 py-1.5 text-on-surface-variant" colSpan={isAdmin ? 10 : 9}>Total — {rows.length} pedido{rows.length !== 1 ? 's' : ''}</td>
                            <td className="px-2 py-1.5 text-right text-on-surface">{fmtR(sum('total_value'))}</td>
                            <td className="px-2 py-1.5 text-right text-emerald-700">{fmtR(sum('rep_commission_value'))}</td>
                            {isAdmin && <td className="px-2 py-1.5 text-right text-blue-700">{fmtR(sum('office_commission_value'))}</td>}
                            <td className="px-2 py-1.5 text-right text-on-surface-variant">{fmtR(sum('valor_faturado'))}</td>
                            <td className="px-2 py-1.5 text-right text-orange-600">{fmtR(sum('falta_faturar'))}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <div className="px-4 py-1.5 bg-surface-container-lowest border-t border-outline-variant/50 text-[12px] text-outline/70">
                      * Valor Faturado = pedidos com status <strong>final</strong>. Falta Faturar = demais pedidos.
                    </div>
                  </div>
                )
              })()
        )}

        {/* ═══ CLIENTES ═════════════════════════════════════════════════════ */}
        {tab === 'clients' && (
          clientsQ.isLoading ? <PageSpinner /> :
          !clientsQ.data ? null :
          clientsQ.data.length === 0
            ? <EmptyState label="Nenhum cliente no período" />
            : (
              <div className="bg-white rounded-xl border border-outline-variant overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-surface-container-low">
                      <tr>
                        <Th>#</Th>
                        <Th>Cliente</Th>
                        <Th right>Pedidos</Th>
                        <Th right>Peças</Th>
                        <Th right>Valor</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {clientsQ.data.map((c, i) => (
                        <tr key={c.id} className="hover:bg-surface-container-low/50">
                          <td className="px-4 py-2 text-[12px] text-outline/70 w-8">{i + 1}</td>
                          <td className="px-4 py-2">
                            <p className="text-[12px] font-semibold text-on-surface truncate max-w-[220px]">
                              {c.trade_name || c.name}
                            </p>
                            {c.city && (
                              <p className="text-[12px] text-outline/70">
                                {c.city}{c.state ? ` / ${c.state}` : ''}
                              </p>
                            )}
                          </td>
                          <Td right>{c.order_count}</Td>
                          <Td right>{fmtN(c.total_pieces)}</Td>
                          <Td right bold>{fmtR(c.total_value)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
        )}

        {/* ═══ COLEÇÕES ═════════════════════════════════════════════════════ */}
        {tab === 'collections' && (
          collectionsQ.isLoading ? <PageSpinner /> :
          !collectionsQ.data ? null :
          collectionsQ.data.length === 0
            ? <EmptyState label="Nenhuma tabela de preços ativa" />
            : <CollectionsTab data={collectionsQ.data} />
        )}

        {/* ═══ PRODUTOS ═════════════════════════════════════════════════════ */}
        {tab === 'products' && (
          productsQ.isLoading ? <PageSpinner /> :
          !productsQ.data ? null :
          productsQ.data.length === 0
            ? <EmptyState label="Nenhuma referência no período" />
            : (
              <div className="bg-white rounded-xl border border-outline-variant overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-surface-container-low">
                      <tr>
                        <Th>#</Th>
                        <Th>Referência</Th>
                        <Th right>Pedidos</Th>
                        <Th right>Peças</Th>
                        <Th right>Valor</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {productsQ.data.map((p, i) => (
                        <tr key={p.reference} className="hover:bg-surface-container-low/50">
                          <td className="px-4 py-2 text-[12px] text-outline/70 w-8">{i + 1}</td>
                          <td className="px-4 py-2 font-mono text-[12px] font-bold text-on-surface">
                            {p.reference}
                          </td>
                          <Td right>{p.order_count}</Td>
                          <Td right bold>{fmtN(p.total_pieces)}</Td>
                          <Td right>{fmtR(p.total_value)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
        )}

        {/* ═══ CATÁLOGO ═════════════════════════════════════════════════════ */}
        {tab === 'catalog' && (
          <div className="space-y-1">
            {/* Catalog-specific filters */}
            <div className="bg-white rounded-xl border border-outline-variant px-4 py-2 flex flex-wrap gap-3 items-center">
              <select
                value={catalogFactoryId}
                onChange={e => { setCatalogFactoryId(e.target.value); setCatalogPriceTableId('') }}
                className="border border-outline-variant rounded-lg px-3 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              >
                <option value="">Todas as indústrias</option>
                {catalogFactories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <select
                value={catalogPriceTableId}
                onChange={e => setCatalogPriceTableId(e.target.value)}
                className="border border-outline-variant rounded-lg px-3 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              >
                <option value="">Todas as coleções</option>
                {(catalogPriceTables || []).map(pt => (
                  <option key={pt.id} value={pt.id}>
                    {pt.name}{pt.collection ? ` — ${pt.collection}` : ''}{pt.season ? ` ${pt.season}` : ''}{pt.year ? ` ${pt.year}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {catalogQ.isLoading ? <PageSpinner /> :
             !catalogQ.data ? null :
             catalogQ.data.length === 0
               ? <EmptyState label="Nenhum produto encontrado" />
               : <CatalogTab data={catalogQ.data} />
            }
          </div>
        )}

      </div>
    </div>
  )
}
