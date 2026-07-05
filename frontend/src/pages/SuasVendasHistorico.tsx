import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ordersApi, factoriesApi, usersApi } from '../api/client'
import * as XLSX from 'xlsx'

interface Order {
  id: string
  created_at: string
  industry_order_number: string | null
  client_name: string
  client_trade_name: string | null
  factory_name: string
  rep_name: string
  total_pieces: number
  total_value: number
  rep_commission_pct: number
  office_commission_pct: number
  rep_commission_value: number
  office_commission_value: number
  payment_terms: string | null
  delivery_date: string | null
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.toLocaleDateString('pt-BR')
}

export default function SuasVendasHistorico() {
  const [repId, setRepId]         = useState('')
  const [factoryId, setFactoryId] = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders-suasvendas', repId, factoryId, dateFrom, dateTo],
    queryFn: () =>
      ordersApi.list({
        source: 'suasvendas',
        rep_id: repId || undefined,
        factory_id: factoryId || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }).then(r => r.data as Order[]),
  })

  const { data: factories = [] } = useQuery({
    queryKey: ['factories'],
    queryFn: () => factoriesApi.list().then(r => r.data as { id: string; name: string }[]),
  })

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => (r.data as { id: string; name: string; role: string }[]).filter(u => u.role === 'representante' || u.role === 'admin')),
  })

  const totals = useMemo(() => ({
    valor: orders.reduce((s, o) => s + Number(o.total_value), 0),
    commRep: orders.reduce((s, o) => s + Number(o.rep_commission_value), 0),
    commEscrit: orders.reduce((s, o) => s + Number(o.office_commission_value), 0),
  }), [orders])

  function exportExcel() {
    const rows = orders.map(o => ({
      'Data': fmtDate(o.created_at),
      'Doc. Original': o.industry_order_number ?? '',
      'Cliente': o.client_trade_name || o.client_name,
      'Razão Social': o.client_name,
      'Fábrica': o.factory_name,
      'Representante': o.rep_name,
      'Qtd Itens': o.total_pieces,
      'Valor (R$)': Number(o.total_value),
      '% Rep': Number(o.rep_commission_pct),
      '% Escrit.': Number(o.office_commission_pct),
      'Comissão Rep (R$)': Number(o.rep_commission_value),
      'Comissão Escrit. (R$)': Number(o.office_commission_value),
      'Cond. Pagamento': o.payment_terms ?? '',
      'Previsão Entrega': fmtDate(o.delivery_date),
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Histórico SuasVendas')
    const periodo = dateFrom && dateTo
      ? `_${dateFrom}_a_${dateTo}`
      : dateFrom ? `_a_partir_${dateFrom}` : ''
    XLSX.writeFile(wb, `historico_suasvendas${periodo}.xlsx`)
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Histórico SuasVendas</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pedidos importados do SuasVendas — somente leitura
          </p>
        </div>
        <button
          onClick={exportExcel}
          disabled={orders.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Exportar Excel
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 px-6 py-3 border-b border-border bg-card/50">
        <select
          value={repId}
          onChange={e => setRepId(e.target.value)}
          className="text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Todos os representantes</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>

        <select
          value={factoryId}
          onChange={e => setFactoryId(e.target.value)}
          className="text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Todas as fábricas</option>
          {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">De</span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {(repId || factoryId || dateFrom || dateTo) && (
          <button
            onClick={() => { setRepId(''); setFactoryId(''); setDateFrom(''); setDateTo('') }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Totalizadores */}
      {orders.length > 0 && (
        <div className="flex gap-4 px-6 py-2 bg-muted/30 border-b border-border text-xs">
          <span className="text-muted-foreground">{orders.length} pedidos</span>
          <span className="text-muted-foreground">·</span>
          <span>Valor total: <strong className="text-foreground">R$ {fmt(totals.valor)}</strong></span>
          <span className="text-muted-foreground">·</span>
          <span>Comissão rep: <strong className="text-foreground">R$ {fmt(totals.commRep)}</strong></span>
          <span className="text-muted-foreground">·</span>
          <span>Comissão escrit.: <strong className="text-foreground">R$ {fmt(totals.commEscrit)}</strong></span>
        </div>
      )}

      {/* Tabela */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
            Carregando...
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
            <span className="text-4xl">📂</span>
            <p className="text-sm">Nenhum pedido importado encontrado</p>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-card border-b border-border z-10">
              <tr>
                {['Data', 'Doc. Original', 'Cliente', 'Fábrica', 'Representante', 'Itens', 'Valor', '% Rep', '% Escrit.', 'Comissão Rep', 'Comissão Escrit.', 'Cond. Pgto'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <tr
                  key={o.id}
                  className={`border-b border-border/50 hover:bg-muted/40 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/20'}`}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(o.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono">{o.industry_order_number ?? '—'}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate" title={o.client_name}>
                    {o.client_trade_name || o.client_name}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{o.factory_name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{o.rep_name}</td>
                  <td className="px-3 py-2 text-right">{o.total_pieces}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">R$ {fmt(Number(o.total_value))}</td>
                  <td className="px-3 py-2 text-right">{Number(o.rep_commission_pct).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right">{Number(o.office_commission_pct).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-emerald-700 font-medium">
                    R$ {fmt(Number(o.rep_commission_value))}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-blue-700 font-medium">
                    R$ {fmt(Number(o.office_commission_value))}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{o.payment_terms ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-card border-t-2 border-border">
              <tr>
                <td colSpan={6} className="px-3 py-2 font-semibold text-right text-muted-foreground">TOTAL</td>
                <td className="px-3 py-2 text-right font-semibold">R$ {fmt(totals.valor)}</td>
                <td colSpan={2} />
                <td className="px-3 py-2 text-right font-semibold text-emerald-700">R$ {fmt(totals.commRep)}</td>
                <td className="px-3 py-2 text-right font-semibold text-blue-700">R$ {fmt(totals.commEscrit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}
