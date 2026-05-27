import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart2 } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { reportsApi, factoriesApi, usersApi } from '../api/client'
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

// ─── types ───────────────────────────────────────────────────────────────────

type Tab = 'orders' | 'commissions' | 'clients' | 'products'

interface OrderSummary {
  order_count: number; total_pieces: number
  total_value: number; rep_commission_value: number; office_commission_value: number
}
interface OrderDay {
  date: string; order_count: number; total_pieces: number; total_value: number
}
interface CommissionRow {
  rep_id: string; rep_name: string; order_count: number; total_pieces: number
  total_value: number; rep_commission_value: number; office_commission_value: number
}
interface ClientRow {
  id: string; name: string; trade_name: string; city: string; state: string
  order_count: number; total_pieces: number; total_value: number
}
interface ProductRow {
  reference: string; order_count: number; total_pieces: number; total_value: number
}
interface Factory { id: string; name: string }
interface User { id: string; name: string; role: string }

// ─── helpers ─────────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center py-16">
      <BarChart2 className="h-10 w-10 text-gray-200 mx-auto mb-3" />
      <p className="text-sm text-gray-400">{label}</p>
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-2.5 text-xs font-semibold text-gray-500 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, right, bold }: { children: React.ReactNode; right?: boolean; bold?: boolean }) {
  return (
    <td className={`px-4 py-3 text-sm ${right ? 'text-right' : ''} ${bold ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
      {children}
    </td>
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

  // ─── report queries ────────────────────────────────────────────────────────

  const ordersQ = useQuery<{ summary: OrderSummary; byDay: OrderDay[] }>({
    queryKey: ['rpt-orders', dateFrom, dateTo, factoryId, repId],
    queryFn: () => reportsApi.orders(baseParams).then(r => r.data),
    enabled: tab === 'orders',
  })

  const commissionsQ = useQuery<CommissionRow[]>({
    queryKey: ['rpt-commissions', dateFrom, dateTo, repId],
    queryFn: () => reportsApi.commissions({ date_from: dateFrom, date_to: dateTo, rep_id: repId || undefined }).then(r => r.data),
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

  // ─── tabs config ───────────────────────────────────────────────────────────

  const TABS: { id: Tab; label: string }[] = [
    { id: 'orders',      label: 'Visão Geral' },
    { id: 'commissions', label: 'Comissões' },
    { id: 'clients',     label: 'Clientes' },
    { id: 'products',    label: 'Produtos' },
  ]

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <div className="pb-24 lg:pb-0">

      {/* ── sticky header ── */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 lg:px-8 space-y-3">
        <div className="max-w-5xl mx-auto space-y-3">

          <div className="flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-indigo-500" />
            <h1 className="text-lg font-bold text-gray-900">Relatórios</h1>
          </div>

          {/* ── filters ── */}
          <div className="flex flex-wrap items-center gap-2">
            {/* date inputs */}
            <input
              type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-gray-400 text-sm">–</span>
            <input
              type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            {/* quick range buttons */}
            <div className="flex gap-1">
              {[{ label: '7d', d: 7 }, { label: '30d', d: 30 }, { label: '90d', d: 90 }].map(r => (
                <button
                  key={r.label} onClick={() => setRange(r.d)}
                  className="px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* factory filter (hidden on commissions tab) */}
            {tab !== 'commissions' && (
              <select
                value={factoryId} onChange={e => setFactoryId(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                <option value="">Todas as fábricas</option>
                {(factories || []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}

            {/* rep filter — admin only, hidden on products tab */}
            {isAdmin && tab !== 'products' && (
              <select
                value={repId} onChange={e => setRepId(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                <option value="">Todos os representantes</option>
                {reps.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
          </div>

          {/* ── tab bar ── */}
          <div className="flex gap-0 border-b border-gray-200">
            {TABS.map(t => (
              <button
                key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  tab === t.id
                    ? 'border-blue-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── tab content ── */}
      <div className="px-4 py-5 lg:px-8 max-w-5xl mx-auto">

        {/* ═══ VISÃO GERAL ══════════════════════════════════════════════════ */}
        {tab === 'orders' && (
          ordersQ.isLoading ? <PageSpinner /> :
          !ordersQ.data ? null :
          <div className="space-y-4">

            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Pedidos',     value: fmtN(ordersQ.data.summary.order_count),       color: 'bg-indigo-50',    text: 'text-indigo-600' },
                { label: 'Peças',       value: fmtN(ordersQ.data.summary.total_pieces),       color: 'bg-purple-50',  text: 'text-purple-700' },
                { label: 'Valor Total', value: fmtR(ordersQ.data.summary.total_value),         color: 'bg-gray-50',    text: 'text-gray-900' },
                { label: 'Com. Rep',    value: fmtR(ordersQ.data.summary.rep_commission_value), color: 'bg-emerald-50', text: 'text-emerald-700' },
              ].map(c => (
                <div key={c.label} className={`${c.color} rounded-xl border border-gray-100 p-4`}>
                  <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                  <p className={`text-xl font-bold ${c.text}`}>{c.value}</p>
                  {c.label === 'Com. Rep' && isAdmin && (
                    <p className="text-xs text-gray-400 mt-0.5">
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
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <p className="px-4 py-3 text-sm font-semibold text-gray-800 border-b border-gray-100">Por dia</p>
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <Th>Data</Th>
                          <Th right>Pedidos</Th>
                          <Th right>Peças</Th>
                          <Th right>Valor</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {ordersQ.data.byDay.map(d => (
                          <tr key={d.date} className="hover:bg-gray-50/50">
                            <Td>{new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</Td>
                            <Td right>{d.order_count}</Td>
                            <Td right>{fmtN(d.total_pieces)}</Td>
                            <Td right bold>{fmtR(d.total_value)}</Td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-50 border-t border-gray-200">
                          <td className="px-4 py-2.5 text-xs font-bold text-gray-700">Total</td>
                          <td className="px-4 py-2.5 text-right text-xs font-bold text-gray-700">
                            {ordersQ.data.byDay.reduce((s, d) => s + d.order_count, 0)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs font-bold text-gray-700">
                            {fmtN(ordersQ.data.byDay.reduce((s, d) => s + d.total_pieces, 0))}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs font-bold text-gray-900">
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
            : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <Th>Representante</Th>
                        <Th right>Pedidos</Th>
                        <Th right>Peças</Th>
                        <Th right>Valor Total</Th>
                        <Th right>Com. Rep</Th>
                        {isAdmin && <Th right>Com. Escritório</Th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {commissionsQ.data.map(r => (
                        <tr key={r.rep_id} className="hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-sm font-semibold text-gray-900">{r.rep_name}</td>
                          <Td right>{r.order_count}</Td>
                          <Td right>{fmtN(r.total_pieces)}</Td>
                          <Td right bold>{fmtR(r.total_value)}</Td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-emerald-700">
                            {fmtR(r.rep_commission_value)}
                          </td>
                          {isAdmin && (
                            <Td right>{fmtR(r.office_commission_value)}</Td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    {commissionsQ.data.length > 1 && (
                      <tfoot>
                        <tr className="bg-gray-50 border-t border-gray-200">
                          <td className="px-4 py-2.5 text-xs font-bold text-gray-700">Total</td>
                          <td className="px-4 py-2.5 text-right text-xs font-bold text-gray-700">
                            {commissionsQ.data.reduce((s, r) => s + r.order_count, 0)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs font-bold text-gray-700">
                            {fmtN(commissionsQ.data.reduce((s, r) => s + r.total_pieces, 0))}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs font-bold text-gray-900">
                            {fmtR(commissionsQ.data.reduce((s, r) => s + Number(r.total_value), 0))}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs font-bold text-emerald-700">
                            {fmtR(commissionsQ.data.reduce((s, r) => s + Number(r.rep_commission_value), 0))}
                          </td>
                          {isAdmin && (
                            <td className="px-4 py-2.5 text-right text-xs font-bold text-gray-700">
                              {fmtR(commissionsQ.data.reduce((s, r) => s + Number(r.office_commission_value), 0))}
                            </td>
                          )}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )
        )}

        {/* ═══ CLIENTES ═════════════════════════════════════════════════════ */}
        {tab === 'clients' && (
          clientsQ.isLoading ? <PageSpinner /> :
          !clientsQ.data ? null :
          clientsQ.data.length === 0
            ? <EmptyState label="Nenhum cliente no período" />
            : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
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
                        <tr key={c.id} className="hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-xs text-gray-400 w-8">{i + 1}</td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-semibold text-gray-900 truncate max-w-[220px]">
                              {c.trade_name || c.name}
                            </p>
                            {c.city && (
                              <p className="text-xs text-gray-400">
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

        {/* ═══ PRODUTOS ═════════════════════════════════════════════════════ */}
        {tab === 'products' && (
          productsQ.isLoading ? <PageSpinner /> :
          !productsQ.data ? null :
          productsQ.data.length === 0
            ? <EmptyState label="Nenhuma referência no período" />
            : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
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
                        <tr key={p.reference} className="hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-xs text-gray-400 w-8">{i + 1}</td>
                          <td className="px-4 py-3 font-mono text-sm font-bold text-gray-900">
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

      </div>
    </div>
  )
}
