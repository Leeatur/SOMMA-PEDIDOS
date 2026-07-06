import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ordersApi, factoriesApi, usersApi, apiClient } from '../api/client'
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

const COLS = [
  { key: 'data',       label: 'Data',             align: 'left'  },
  { key: 'doc',        label: 'Doc. Original',    align: 'left'  },
  { key: 'cliente',    label: 'Cliente',           align: 'left'  },
  { key: 'fabrica',    label: 'Fábrica',           align: 'left'  },
  { key: 'rep',        label: 'Representante',     align: 'left'  },
  { key: 'itens',      label: 'Itens',             align: 'right' },
  { key: 'valor',      label: 'Valor',             align: 'right' },
  { key: 'pctRep',     label: '% Rep',             align: 'right' },
  { key: 'pctEscrit',  label: '% Escrit.',         align: 'right' },
  { key: 'commRep',    label: 'Comissão Rep',      align: 'right' },
  { key: 'commEscrit', label: 'Comissão Escrit.',  align: 'right' },
  { key: 'condPgto',   label: 'Cond. Pgto',        align: 'left'  },
] as const

type ColKey = typeof COLS[number]['key']

const ALL_KEYS = COLS.map(c => c.key) as ColKey[]

const HEADER_BG = '#1e3a5f'

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR')
}

export default function SuasVendasHistorico() {
  const [repId, setRepId]         = useState('')
  const [factoryId, setFactoryId] = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [search, setSearch]       = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    imported: number; skipped: number; errors: number
    unmappedReps: string[]; unmappedFactories: string[]; errorDetails: string[]
  } | null>(null)
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(new Set(ALL_KEYS))
  const [colPickerOpen, setColPickerOpen] = useState(false)

  const fileInputRef  = useRef<HTMLInputElement>(null)
  const colPickerRef  = useRef<HTMLDivElement>(null)
  const queryClient   = useQueryClient()

  // Fecha o seletor de colunas ao clicar fora
  useEffect(() => {
    if (!colPickerOpen) return
    function handler(e: MouseEvent) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setColPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [colPickerOpen])

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
    queryFn: () => usersApi.list().then(
      r => (r.data as { id: string; name: string; role: string }[])
        .filter(u => u.role === 'representante' || u.role === 'admin')
    ),
  })

  const filteredOrders = useMemo(() => {
    if (!search.trim()) return orders
    const q = search.trim().toLowerCase()
    return orders.filter(o =>
      (o.client_trade_name || o.client_name).toLowerCase().includes(q) ||
      o.client_name.toLowerCase().includes(q) ||
      (o.industry_order_number ?? '').toLowerCase().includes(q) ||
      o.rep_name.toLowerCase().includes(q) ||
      o.factory_name.toLowerCase().includes(q) ||
      (o.payment_terms ?? '').toLowerCase().includes(q)
    )
  }, [orders, search])

  const totals = useMemo(() => ({
    valor:      filteredOrders.reduce((s, o) => s + Number(o.total_value), 0),
    commRep:    filteredOrders.reduce((s, o) => s + Number(o.rep_commission_value), 0),
    commEscrit: filteredOrders.reduce((s, o) => s + Number(o.office_commission_value), 0),
  }), [filteredOrders])

  const visibleColList = COLS.filter(c => visibleCols.has(c.key))

  function toggleCol(key: ColKey) {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) { if (next.size > 1) next.delete(key) }
      else next.add(key)
      return next
    })
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiClient.post('/orders/import-suasvendas', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300_000,
      })
      setImportResult(res.data)
      queryClient.invalidateQueries({ queryKey: ['orders-suasvendas'] })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error
        || (err as { message?: string })?.message
        || 'Erro desconhecido'
      setImportResult({ imported: 0, skipped: 0, errors: 1, unmappedReps: [], unmappedFactories: [msg], errorDetails: [] })
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

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
    const periodo = dateFrom && dateTo ? `_${dateFrom}_a_${dateTo}` : dateFrom ? `_a_partir_${dateFrom}` : ''
    XLSX.writeFile(wb, `historico_suasvendas${periodo}.xlsx`)
  }

  function cellValue(col: ColKey, o: Order): React.ReactNode {
    switch (col) {
      case 'data':       return <span className="text-muted-foreground">{fmtDate(o.created_at)}</span>
      case 'doc':        return <span className="font-mono">{o.industry_order_number ?? '—'}</span>
      case 'cliente':    return <span className="block max-w-[200px] truncate" title={o.client_name}>{o.client_trade_name || o.client_name}</span>
      case 'fabrica':    return o.factory_name
      case 'rep':        return o.rep_name
      case 'itens':      return o.total_pieces
      case 'valor':      return `R$ ${fmt(Number(o.total_value))}`
      case 'pctRep':     return `${Number(o.rep_commission_pct).toFixed(1)}%`
      case 'pctEscrit':  return `${Number(o.office_commission_pct).toFixed(1)}%`
      case 'commRep':    return <span className="text-emerald-700 font-medium">R$ {fmt(Number(o.rep_commission_value))}</span>
      case 'commEscrit': return <span className="text-blue-700 font-medium">R$ {fmt(Number(o.office_commission_value))}</span>
      case 'condPgto':   return <span className="text-muted-foreground">{o.payment_terms ?? '—'}</span>
    }
  }

  function footerValue(col: ColKey): React.ReactNode {
    switch (col) {
      case 'valor':      return `R$ ${fmt(totals.valor)}`
      case 'commRep':    return `R$ ${fmt(totals.commRep)}`
      case 'commEscrit': return `R$ ${fmt(totals.commEscrit)}`
      default:           return null
    }
  }

  const hiddenCount = ALL_KEYS.length - visibleCols.size

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
        <div className="flex items-center gap-2">
          {/* Seletor de colunas */}
          <div className="relative" ref={colPickerRef}>
            <button
              onClick={() => setColPickerOpen(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded hover:bg-muted transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
              </svg>
              Colunas
              {hiddenCount > 0 && (
                <span className="ml-0.5 bg-primary text-primary-foreground rounded-full text-[10px] w-4 h-4 flex items-center justify-center">
                  {hiddenCount}
                </span>
              )}
            </button>
            {colPickerOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[170px]">
                <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b border-border mb-1">
                  Mostrar colunas
                </div>
                {COLS.map(col => (
                  <label key={col.key} className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-muted/50 select-none">
                    <input
                      type="checkbox"
                      checked={visibleCols.has(col.key)}
                      onChange={() => toggleCol(col.key)}
                      className="h-3 w-3 rounded"
                    />
                    {col.label}
                  </label>
                ))}
                {hiddenCount > 0 && (
                  <div className="border-t border-border mt-1 pt-1 px-3 pb-1">
                    <button
                      onClick={() => setVisibleCols(new Set(ALL_KEYS))}
                      className="text-[10px] text-primary hover:underline"
                    >
                      Mostrar todas
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Importar */}
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            {importing ? 'Importando...' : 'Importar Excel'}
          </button>

          {/* Exportar */}
          <button
            onClick={exportExcel}
            disabled={orders.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Exportar Excel
          </button>
        </div>
      </div>

      {/* Resultado da importação */}
      {importResult && (
        <div className={`px-6 py-2.5 text-xs flex items-center justify-between border-b ${importResult.errors > 0 || importResult.unmappedFactories.length > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
          <span>
            ✓ <strong>{importResult.imported}</strong> importados &nbsp;·&nbsp;
            ⊘ <strong>{importResult.skipped}</strong> pulados (já existiam)
            {importResult.errors > 0 && <> &nbsp;·&nbsp; ✗ <strong>{importResult.errors}</strong> erros</>}
            {importResult.unmappedReps.length > 0 && <> &nbsp;·&nbsp; Reps sem mapeamento: {importResult.unmappedReps.join(', ')}</>}
            {importResult.unmappedFactories.length > 0 && <> &nbsp;·&nbsp; {importResult.unmappedFactories.join(', ')}</>}
            {importResult.errorDetails?.length > 0 && <> &nbsp;·&nbsp; 1º erro: {importResult.errorDetails[0]}</>}
          </span>
          <button onClick={() => setImportResult(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 px-6 py-3 border-b border-border bg-card/50">
        {/* Campo de busca */}
        <div className="relative">
          <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente, doc, rep..."
            className="text-xs border border-border rounded pl-7 pr-7 py-1.5 bg-background text-foreground outline-none focus:ring-1 focus:ring-primary w-52"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

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
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground outline-none focus:ring-1 focus:ring-primary" />
          <span className="text-xs text-muted-foreground">até</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground outline-none focus:ring-1 focus:ring-primary" />
        </div>
        {(search || repId || factoryId || dateFrom || dateTo) && (
          <button
            onClick={() => { setSearch(''); setRepId(''); setFactoryId(''); setDateFrom(''); setDateTo('') }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Totalizadores */}
      {filteredOrders.length > 0 && (
        <div className="flex gap-4 px-6 py-2 bg-muted/30 border-b border-border text-xs">
          <span className="text-muted-foreground">
            {filteredOrders.length}{search ? ` de ${orders.length}` : ''} pedidos
          </span>
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
          <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">Carregando...</div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
            <span className="text-4xl">📂</span>
            <p className="text-sm">Nenhum pedido importado encontrado</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
            <span className="text-4xl">🔍</span>
            <p className="text-sm">Nenhum resultado para "<strong>{search}</strong>"</p>
            <button onClick={() => setSearch('')} className="text-xs text-primary hover:underline">Limpar busca</button>
          </div>
        ) : (
          <table className="w-full text-xs border-separate border-spacing-0">
            {/* Cabeçalho azul escuro */}
            <thead className="sticky top-0 z-10" style={{ backgroundColor: HEADER_BG }}>
              <tr>
                {visibleColList.map(col => (
                  <th
                    key={col.key}
                    className={`px-3 py-2.5 font-semibold whitespace-nowrap border-b-2 border-white/20 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    style={{ color: '#ffffff' }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {filteredOrders.map((o, i) => (
                <tr key={o.id} className={`hover:bg-muted/40 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  {visibleColList.map(col => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 whitespace-nowrap border-b border-border/40 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    >
                      {cellValue(col.key, o)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>

            {/* Rodapé azul escuro */}
            <tfoot className="sticky bottom-0 z-10" style={{ backgroundColor: HEADER_BG }}>
              <tr>
                {visibleColList.map((col, idx) => {
                  const val = footerValue(col.key)
                  const isFirst = idx === 0
                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-2.5 border-t-2 border-white/20 font-semibold whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                      style={{ color: '#ffffff' }}
                    >
                      {isFirst ? 'TOTAL' : val ?? ''}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}
