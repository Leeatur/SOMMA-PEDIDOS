import { useState, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart2, ChevronDown, ChevronRight, ChevronLeft, Printer, Download, TrendingUp, Users, Package, Award } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { reportsApi, factoriesApi, priceTablesApi, usersApi, ordersApi } from '../api/client'
import { PageSpinner } from '../components/ui/Spinner'
import { ColumnDef, ColumnConfigButton, useColumnConfig } from '../components/ui/ColumnConfig'
import { useColumnResize } from '../components/ui/useColumnResize.tsx'

// ─── formatters ──────────────────────────────────────────────────────────────

const fmtR = (v: number | string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)

const fmtN = (v: number | string) =>
  new Intl.NumberFormat('pt-BR').format(Number(v) || 0)

// Sempre em horário de Brasília — evita UTC→local (após 21h no Brasil o UTC já é o dia seguinte)
const spFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' })
function todayStr() { return spFmt.format(new Date()) }
function daysAgoStr(n: number) {
  return spFmt.format(new Date(Date.now() - n * 86400000))
}
function monthStartStr() {
  const d = new Date()
  d.setDate(1)
  return spFmt.format(d)
}
// Handles both "YYYY-MM-DD" strings and ISO timestamps returned by pg
function fmtDatePtBR(d: string | Date): string {
  const iso = typeof d === 'string' ? d : (d as Date).toISOString()
  const [y, m, day] = iso.substring(0, 10).split('-')
  return `${day}/${m}/${y}`
}

// ─── types ───────────────────────────────────────────────────────────────────

type Tab = 'orders' | 'commissions' | 'clients' | 'products' | 'collections' | 'catalog' | 'evolution' | 'inactive' | 'repperformance' | 'abc' | 'comparison' | 'region' | 'projection'

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
  commission_manual_override: boolean
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

// ─── Definições de colunas — Comissões ───────────────────────────────────────
const COMM_COL_DEFS: ColumnDef[] = [
  { id: 'data',           label: 'Data',          alwaysVisible: true },
  { id: 'vendedor',       label: 'Vendedor' },
  { id: 'industria',      label: 'Indústria' },
  { id: 'nr_fabrica',     label: 'Nr. Fábrica' },
  { id: 'razao_social',   label: 'Razão Social',  alwaysVisible: true },
  { id: 'nome_fantasia',  label: 'Nome Fantasia' },
  { id: 'cidade',         label: 'Cidade' },
  { id: 'uf',             label: 'UF' },
  { id: 'valor',          label: 'Valor',         alwaysVisible: true },
  { id: 'politica',       label: 'Desc. Coml.' },
  { id: 'com_rep',        label: 'Com. Rep' },
  { id: 'com_escr',       label: 'Com. Escr.' },
  { id: 'faturado',       label: 'Faturado' },
  { id: 'a_faturar',      label: 'A Faturar' },
]

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

// ─── CSV export ──────────────────────────────────────────────────────────────
// Gera CSV com BOM UTF-8 (abre direto no Excel com acentos corretos)

function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename + '.csv'; a.click()
  URL.revokeObjectURL(url)
}

async function exportXlsx(filename: string, headers: string[], rows: (string | number)[][]) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dados')
  XLSX.writeFile(wb, filename + '.xlsx')
}

// ─── CSS de impressão ─────────────────────────────────────────────────────────

const PRINT_CSS = `
  @media print {
    header, nav, .no-print { display: none !important; }
    .reports-sidebar { display: none !important; }
    .main-content { overflow: visible !important; }
    .reports-content { padding: 0 !important; }
    body { font-size: 11pt; background: white !important; }
    @page { margin: 1.5cm; size: A4 landscape; }
    table { border-collapse: collapse; width: 100%; font-size: 10pt; }
    th, td { border: 1px solid #ddd; padding: 4px 8px; }
    th { background-color: #f3f4f6 !important; print-color-adjust: exact; }
    .print-title { font-size: 16pt; font-weight: bold; margin-bottom: 4px; }
    .print-subtitle { font-size: 10pt; color: #555; margin-bottom: 12px; }
    .print-period { font-size: 9pt; color: #888; margin-bottom: 16px; }
  }
`

// ─── Metadados dos relatórios ─────────────────────────────────────────────────

interface ReportMeta { id: Tab; title: string; description: string; group: string }

const REPORT_META: ReportMeta[] = [
  // Vendas
  { id: 'orders',         group: 'vendas',    title: 'Resumo de Vendas',          description: 'Totais de pedidos, valor e comissões no período selecionado, com evolução diária.' },
  { id: 'evolution',      group: 'vendas',    title: 'Evolução Mensal',            description: 'Crescimento mês a mês: número de pedidos, valor total e clientes atendidos.' },
  { id: 'comparison',     group: 'vendas',    title: 'Comparativo de Períodos',    description: 'Compare o período selecionado com o período imediatamente anterior.' },
  // Clientes
  { id: 'clients',        group: 'clientes',  title: 'Por Cliente',                description: 'Ranking de clientes por valor comprado no período, com total de pedidos e unidades.' },
  { id: 'abc',            group: 'clientes',  title: 'Curva ABC de Clientes',      description: 'Classifica clientes em A (80% da receita), B (15%) e C (5%) — foco no que importa.' },
  { id: 'inactive',       group: 'clientes',  title: 'Clientes Inativos',          description: 'Clientes que não fizeram pedidos nos últimos X dias. Identifique quem precisa de contato.' },
  { id: 'region',         group: 'clientes',  title: 'Por Região / UF',            description: 'Distribuição geográfica das vendas por estado e cidade.' },
  // Produtos
  { id: 'products',       group: 'produtos',  title: 'Produtos Mais Vendidos',     description: 'Referências com maior volume de vendas no período — em quantidade e valor.' },
  { id: 'collections',    group: 'produtos',  title: 'Curva ABC de Produtos',      description: 'Quais coleções e produtos concentram o maior faturamento.' },
  // Equipe
  { id: 'commissions',    group: 'equipe',    title: 'Comissões por Pedido',       description: 'Detalhamento de comissões por vendedor e pedido, com status de faturamento.' },
  { id: 'repperformance', group: 'equipe',    title: 'Performance da Equipe',      description: 'Ranking comparativo de desempenho entre vendedores no período.' },
  { id: 'projection',     group: 'equipe',    title: 'Projeção de Comissões',      description: 'Comissões em aberto (a faturar) por vendedor — previsão de recebimento.' },
]

const GROUPS = [
  { id: 'vendas',    label: 'Vendas',    icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { id: 'clientes',  label: 'Clientes',  icon: <Users className="h-3.5 w-3.5" /> },
  { id: 'produtos',  label: 'Produtos',  icon: <Package className="h-3.5 w-3.5" /> },
  { id: 'equipe',    label: 'Equipe',    icon: <Award className="h-3.5 w-3.5" /> },
]

// ─── main component ───────────────────────────────────────────────────────────

export function Reports() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [tab, setTab] = useState<Tab>('orders')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [dateFrom, setDateFrom] = useState(monthStartStr())
  const [dateTo, setDateTo] = useState(todayStr())
  const [factoryId, setFactoryId] = useState('')
  const [repId, setRepId] = useState('')

  // Edição inline de comissão no relatório (edição por %)
  const qc = useQueryClient()
  const [editingComm, setEditingComm] = useState<{
    orderId: string
    field: 'rep' | 'office'
    pctText: string          // texto digitado no campo %
    totalValue: number       // total do pedido para preview
    currentRepPct: number    // % atual do outro campo (para manter ao salvar)
    currentOffPct: number
  } | null>(null)
  const commInputRef = useRef<HTMLInputElement>(null)

  // calcula preview em R$ a partir do % digitado
  function previewValue(pctText: string, totalValue: number): number | null {
    const p = parseFloat(pctText.replace(',', '.'))
    if (isNaN(p) || p < 0) return null
    return Math.round(totalValue * p / 100 * 100) / 100
  }

  async function saveInlineCommission() {
    if (!editingComm) return
    const pct = parseFloat(editingComm.pctText.replace(',', '.'))
    if (isNaN(pct) || pct < 0) { setEditingComm(null); return }
    if (editingComm.field === 'rep') {
      await ordersApi.updateCommission(editingComm.orderId, { rep_commission_pct: pct })
    } else {
      await ordersApi.updateCommission(editingComm.orderId, { office_commission_pct: pct })
    }
    qc.invalidateQueries({ queryKey: ['rpt-commissions'], refetchType: 'all' })
    setEditingComm(null)
  }

  // Configuração de colunas — Comissões
  const commColDefs = COMM_COL_DEFS.filter(c => c.id !== 'com_escr' || isAdmin)
  const { orderedDefs: commCols, config: commConfig, save: saveCommCols, reset: resetCommCols } = useColumnConfig('report-commissions', commColDefs)

  // Busca no relatório de comissões
  const [commSearch, setCommSearch] = useState('')

  // Resize das colunas de comissões
  const COMM_DEFAULT_WIDTHS: Record<string, number> = {
    data: 80, vendedor: 110, industria: 90, nr_fabrica: 90,
    razao_social: 160, nome_fantasia: 130, cidade: 100, uf: 45,
    valor: 110, politica: 80, com_rep: 130, com_escr: 120, faturado: 100, a_faturar: 100,
  }
  const { widths: commWidths, save: saveCommWidths } = useColumnResize('report-commissions-widths', COMM_DEFAULT_WIDTHS)

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

  // ─── Novos relatórios ─────────────────────────────────────────────────────
  const [evolutionMonths, setEvolutionMonths] = useState(12)
  const [inactiveDays, setInactiveDays] = useState(60)

  const evolutionQ = useQuery({
    queryKey: ['rpt-evolution', evolutionMonths, factoryId, repId],
    queryFn: () => reportsApi.salesEvolution({ months: evolutionMonths, factory_id: factoryId || undefined, rep_id: repId || undefined }).then(r => r.data),
    enabled: tab === 'evolution',
  })

  const inactiveQ = useQuery({
    queryKey: ['rpt-inactive', inactiveDays, factoryId, repId],
    queryFn: () => reportsApi.inactiveClients({ days: inactiveDays, factory_id: factoryId || undefined, rep_id: repId || undefined }).then(r => r.data),
    enabled: tab === 'inactive',
  })

  const repPerfQ = useQuery({
    queryKey: ['rpt-rep-perf', dateFrom, dateTo, factoryId],
    queryFn: () => reportsApi.repPerformance({ date_from: dateFrom, date_to: dateTo, factory_id: factoryId || undefined }).then(r => r.data),
    enabled: tab === 'repperformance' && isAdmin,
  })

  const abcQ = useQuery({
    queryKey: ['rpt-abc', dateFrom, dateTo, factoryId, repId],
    queryFn: () => reportsApi.abcClients({ date_from: dateFrom, date_to: dateTo, factory_id: factoryId||undefined, rep_id: repId||undefined }).then(r => r.data),
    enabled: tab === 'abc',
  })
  const comparisonQ = useQuery({
    queryKey: ['rpt-comparison', dateFrom, dateTo, factoryId, repId],
    queryFn: () => reportsApi.periodComparison({ date_from: dateFrom, date_to: dateTo, factory_id: factoryId||undefined, rep_id: repId||undefined }).then(r => r.data),
    enabled: tab === 'comparison',
  })
  const regionQ = useQuery({
    queryKey: ['rpt-region', dateFrom, dateTo, factoryId, repId],
    queryFn: () => reportsApi.region({ date_from: dateFrom, date_to: dateTo, factory_id: factoryId||undefined, rep_id: repId||undefined }).then(r => r.data),
    enabled: tab === 'region',
  })
  const projectionQ = useQuery({
    queryKey: ['rpt-projection', factoryId, repId],
    queryFn: () => reportsApi.commissionProjection({ factory_id: factoryId||undefined, rep_id: repId||undefined }).then(r => r.data),
    enabled: tab === 'projection',
  })

  // ─── tabs config ───────────────────────────────────────────────────────────

  // ─── Relatórios visíveis para este usuário ────────────────────────────────
  const VISIBLE_META = REPORT_META.filter(r =>
    r.id !== 'repperformance' || isAdmin
  )
  const currentMeta = VISIBLE_META.find(r => r.id === tab) ?? VISIBLE_META[0]

  // ─── Export CSV por relatório ─────────────────────────────────────────────
  function handleExport() {
    const period = `${dateFrom}_${dateTo}`
    if (tab === 'orders' && ordersQ.data) {
      exportCsv(`resumo-vendas-${period}`, ['Data','Pedidos','Peças','Valor Total'],
        ordersQ.data.byDay.map(r => [fmtDatePtBR(r.date), r.order_count, r.total_pieces, fmtR(r.total_value)]))
    } else if (tab === 'commissions' && commissionsQ.data) {
      const commRows = commSearch.trim()
        ? commissionsQ.data.filter(r => [r.vendedor,r.industria,r.razao_social,r.cliente,r.nr_ped_fabrica,r.status_name].some(v=>String(v||'').toLowerCase().includes(commSearch.toLowerCase())))
        : commissionsQ.data
      exportXlsx(`comissoes-${period}`,
        ['Data','Vendedor','Fornecedor','Nº Fábrica','Razão Social','Cidade','UF','Valor','Desc. Com. %','Com. Rep','% Rep','Com. Escr.','% Escr.','Status'],
        commRows.map(r => [
          fmtDatePtBR(r.data_venda), r.vendedor, r.industria, r.nr_ped_fabrica||'', r.razao_social, r.cidade||'', r.uf||'',
          Number(r.total_value),
          Number(r.discount_pct||0),
          Number(r.rep_commission_value),
          Number(r.rep_commission_pct||0),
          Number(r.office_commission_value),
          Number(r.office_commission_pct||0),
          r.status_name||'',
        ]))
    } else if (tab === 'clients' && clientsQ.data) {
      exportCsv(`clientes-${period}`,['Cliente','Cidade','UF','Pedidos','Peças','Valor Total'],
        clientsQ.data.map(r=>[r.name, r.city, r.state, r.order_count, r.total_pieces, fmtR(r.total_value)]))
    } else if (tab === 'products' && productsQ.data) {
      exportCsv(`produtos-${period}`,['Referência','Pedidos','Peças','Valor Total'],
        productsQ.data.map(r=>[r.reference, r.order_count, r.total_pieces, fmtR(r.total_value)]))
    } else if (tab === 'evolution' && evolutionQ.data) {
      exportCsv(`evolucao-mensal`, ['Mês','Pedidos','Valor Total','Clientes Atendidos','Peças'],
        (evolutionQ.data as any[]).map(r=>[r.mes||r.month||'', r.total_pedidos, fmtR(r.total_value), r.clientes_atendidos, r.total_pieces]))
    } else if (tab === 'inactive' && inactiveQ.data) {
      exportCsv(`clientes-inativos`, ['Cliente','Cidade','UF','Vendedor','Último Pedido','Dias Inativo'],
        (inactiveQ.data as any[]).map(r=>[r.client_name, r.city||'', r.state||'', r.rep_name||'', fmtDatePtBR(r.last_order_date), r.days_inactive]))
    } else if (tab === 'region' && regionQ.data) {
      exportCsv(`por-regiao-${period}`, ['UF','Pedidos','Clientes','Valor Total'],
        (regionQ.data as any[]).map(r=>[r.state, r.pedidos, r.clientes, fmtR(r.total_value)]))
    } else if (tab === 'abc' && abcQ.data) {
      exportCsv(`abc-clientes-${period}`, ['Classe','Cliente','Cidade','Pedidos','Valor Total','% Acumulado'],
        (abcQ.data as any[]).map(r=>[r.classe, r.name, r.city||'', r.order_count, fmtR(r.total_value), `${Number(r.pct_acumulado||0).toFixed(1)}%`]))
    } else if (tab === 'repperformance' && repPerfQ.data) {
      exportCsv(`performance-equipe-${period}`, ['Vendedor','Pedidos','Peças','Valor Total','Com. Rep'],
        (repPerfQ.data as any[]).map(r=>[r.rep_name, r.total_pedidos, r.total_pieces, fmtR(r.total_value), fmtR(r.comissao_rep)]))
    } else if (tab === 'comparison' && comparisonQ.data) {
      exportCsv(`comparativo-${period}`, ['Métrica','Período Atual','Período Anterior','Variação'],
        [
          ['Valor Total', fmtR((comparisonQ.data as any).current?.total_value||0), fmtR((comparisonQ.data as any).previous?.total_value||0), ''],
          ['Pedidos', (comparisonQ.data as any).current?.total_pedidos||0, (comparisonQ.data as any).previous?.total_pedidos||0, ''],
          ['Peças', (comparisonQ.data as any).current?.total_pieces||0, (comparisonQ.data as any).previous?.total_pieces||0, ''],
        ])
    } else if (tab === 'projection' && projectionQ.data) {
      exportCsv(`projecao-comissoes`, ['Vendedor','Status','Pedidos','Valor Pedidos','Com. Rep','Com. Escr.'],
        (projectionQ.data as any[]).map(r=>[r.rep_name, r.situacao, r.pedidos, fmtR(r.total_value), fmtR(r.comissao_rep), fmtR(r.comissao_escritorio)]))
    } else {
      alert('Carregue o relatório antes de exportar.')
    }
  }

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <div className="pb-24 lg:pb-0 reports-page">
      <style>{PRINT_CSS}</style>

      {/* ══ HEADER FIXO: título + filtros (visível na tela, oculto na impressão) ══ */}
      <div className="no-print bg-white border-b border-outline-variant px-4 py-2.5 lg:px-8">
        <div className="flex items-center gap-2 mb-2">
          <BarChart2 className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-on-surface">Relatórios</h1>
          <span className="text-[12px] text-outline ml-1">— selecione um relatório na barra lateral</span>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-outline-variant rounded-lg px-3 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary" />
          <span className="text-outline/70 text-[12px]">–</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-outline-variant rounded-lg px-3 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary" />
          <div className="flex gap-1">
            <button onClick={() => { setDateFrom(monthStartStr()); setDateTo(todayStr()) }}
              className="px-2.5 py-1 text-[11px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors border border-primary/20">
              Este mês
            </button>
            {[{ label: 'Hoje', d: 1 }, { label: '7d', d: 7 }, { label: '30d', d: 30 }, { label: '90d', d: 90 }].map(r => (
              <button key={r.label} onClick={() => setRange(r.d)}
                className="px-2.5 py-1 text-[11px] font-medium text-on-surface-variant bg-surface-container hover:bg-surface-container-high rounded-lg transition-colors">
                {r.label}
              </button>
            ))}
          </div>
          <select value={factoryId} onChange={e => setFactoryId(e.target.value)}
            className="border border-outline-variant rounded-lg px-3 py-1 text-[12px] bg-white focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="">Todos os fornecedores</option>
            {(factories || []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {isAdmin && tab !== 'products' && (
            <select value={repId} onChange={e => setRepId(e.target.value)}
              className="border border-outline-variant rounded-lg px-3 py-1 text-[12px] bg-white focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">Todos os vendedores</option>
              {reps.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
        </div>

        {/* Tabs mobile (scroll horizontal) */}
        <div className="lg:hidden flex gap-0 overflow-x-auto scrollbar-hide border-b border-outline-variant mt-2 -mb-[1px]">
          {VISIBLE_META.map(r => (
            <button key={r.id} onClick={() => setTab(r.id as Tab)}
              className={`px-4 py-1.5 text-[11px] font-medium border-b-2 whitespace-nowrap transition-colors -mb-px ${
                tab === r.id ? 'border-primary text-primary' : 'border-transparent text-outline hover:text-on-surface-variant'}`}>
              {r.title}
            </button>
          ))}
        </div>
      </div>

      {/* ══ CORPO: sidebar lateral (desktop) + conteúdo ══ */}
      <div className="flex">

        {/* ── Sidebar lateral (desktop only) — wrapper relativo para o botão flutuante ── */}
        <div className={`reports-sidebar no-print hidden lg:block relative flex-shrink-0 transition-all duration-200 ${sidebarCollapsed ? 'w-10' : 'w-56'}`}>

          {/* Botão flutuante na borda direita — sempre visível, estilo VS Code */}
          <button
            onClick={() => setSidebarCollapsed(v => !v)}
            title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
            className="absolute top-5 -right-3 z-20 w-6 h-6 flex items-center justify-center bg-white border-2 border-gray-300 rounded-full shadow-md text-gray-500 hover:text-primary hover:border-primary transition-colors"
          >
            {sidebarCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>

          <aside className="flex flex-col w-full h-[calc(100vh-100px)] border-r border-outline-variant bg-white sticky top-[52px] overflow-y-auto py-3">
            {!sidebarCollapsed && GROUPS.map(group => {
              const items = VISIBLE_META.filter(r => r.group === group.id)
              if (!items.length) return null
              return (
                <div key={group.id} className="mb-3">
                  <div className="flex items-center gap-1.5 px-4 py-1 text-[10px] font-black uppercase tracking-wider text-outline/60">
                    {group.icon} {group.label}
                  </div>
                  {items.map(r => (
                    <button key={r.id} onClick={() => setTab(r.id as Tab)}
                      className={`w-full text-left px-4 py-2 text-[12px] font-medium transition-all border-l-2 ${
                        tab === r.id
                          ? 'border-primary bg-primary/5 text-primary font-semibold'
                          : 'border-transparent text-on-surface-variant hover:bg-gray-50 hover:text-on-surface'
                      }`}>
                      {r.title}
                    </button>
                  ))}
                </div>
              )
            })}

            {sidebarCollapsed && (
              <div className="flex flex-col items-center gap-1 pt-2">
                {VISIBLE_META.map(r => (
                  <button
                    key={r.id}
                    onClick={() => { setTab(r.id as Tab); setSidebarCollapsed(false) }}
                    title={r.title}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                      tab === r.id ? 'bg-primary/10 text-primary' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
                    }`}
                  >
                    <span className="text-[10px] font-bold leading-none">{r.title.slice(0, 2)}</span>
                  </button>
                ))}
              </div>
            )}
          </aside>
        </div>

        {/* ── Área de conteúdo ── */}
        <div className="flex-1 min-w-0 reports-content px-4 py-4 lg:px-6">

          {/* Cabeçalho do relatório ativo — visível na impressão */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
            <div>
              <h2 className="print-title text-xl font-bold text-on-surface">{currentMeta.title}</h2>
              <p className="print-subtitle text-[12px] text-outline mt-1 max-w-lg">{currentMeta.description}</p>
              <p className="print-period text-[11px] text-outline/60 mt-0.5">
                Período: {fmtDatePtBR(dateFrom)} – {fmtDatePtBR(dateTo)}
                {factoryId && factories ? ` · ${factories.find(f=>f.id===factoryId)?.name}` : ''}
                {repId && reps.length ? ` · ${reps.find(u=>u.id===repId)?.name}` : ''}
              </p>
            </div>
            <div className="flex gap-2 no-print flex-shrink-0">
              <button onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container transition-colors">
                <Printer className="h-3.5 w-3.5" /> Imprimir / PDF
              </button>
              <button onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
                <Download className="h-3.5 w-3.5" /> Exportar Excel
              </button>
            </div>
          </div>

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
                // Filtra por busca em todos os campos
                const q = commSearch.toLowerCase().trim()
                const rows = q
                  ? commissionsQ.data.filter(r =>
                      [r.vendedor, r.industria, r.razao_social, r.cliente,
                       r.cidade, r.uf, r.nr_ped_fabrica, String(r.order_number || ''),
                       r.status_name, r.items_refs]
                        .some(v => (v || '').toLowerCase().includes(q))
                    )
                  : commissionsQ.data
                const sum = (key: keyof CommissionRow) =>
                  rows.reduce((s, r) => s + Number(r[key] || 0), 0)
                const fmtDate = (d: string) => fmtDatePtBR(d)
                const fmtPct = (v: number) => `${Number(v || 0).toFixed(2).replace('.', ',')}%`
                const totalSold = sum('total_value')
                // Soma efetiva das comissões — usa fallback calculado igual às células das linhas
                const totalRepComm = rows.reduce((s, r) => s + (Number(r.rep_commission_value) || (Number(r.total_value) * Number(r.rep_commission_pct) / 100)), 0)
                const totalOffComm = rows.reduce((s, r) => s + (Number(r.office_commission_value) || (Number(r.total_value) * Number(r.office_commission_pct) / 100)), 0)
                // Média dos percentuais de comissão dos pedidos filtrados
                const avgRepPct = rows.length > 0 ? rows.reduce((s, r) => s + Number(r.rep_commission_pct), 0) / rows.length : 0
                const avgOffPct = rows.length > 0 ? rows.reduce((s, r) => s + Number(r.office_commission_pct), 0) / rows.length : 0
                return (
                  <div className="bg-white rounded-xl border border-outline-variant overflow-hidden">
                    {/* Barra de busca + config colunas */}
                    <div className="flex items-center gap-3 px-3 py-2 border-b border-outline-variant/30 bg-surface-container-low/30">
                      <div className="relative flex-1 max-w-md">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-outline/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                        <input
                          type="text"
                          value={commSearch}
                          onChange={e => setCommSearch(e.target.value)}
                          placeholder="Buscar por vendedor, cliente, indústria, cidade, nº pedido..."
                          className="w-full pl-9 pr-4 py-1.5 text-[12px] bg-white border border-outline-variant/40 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                        />
                        {commSearch && (
                          <button onClick={() => setCommSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-outline/50 hover:text-on-surface">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                          </button>
                        )}
                      </div>
                      {q && (
                        <span className="text-[12px] text-outline flex-shrink-0">
                          {rows.length} resultado{rows.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      <ColumnConfigButton defs={commColDefs} config={commConfig} onSave={saveCommCols} onReset={resetCommCols} />
                      <button
                        onClick={() => { resetCommCols() }}
                        title="Restaurar ordem padrão das colunas"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold border border-orange-300 rounded-lg text-orange-600 hover:bg-orange-50 transition-colors flex-shrink-0 whitespace-nowrap"
                      >
                        ↺ Resetar colunas
                      </button>
                    </div>
                    <p className="text-[11px] text-outline/50 px-3 py-1 bg-surface-container-low/50 border-b border-outline-variant/20">
                      Arraste a borda direita para redimensionar · Arraste o cabeçalho para reordenar
                    </p>
                    <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 265px)' }}>
                      <table className="text-[12px]" style={{ tableLayout: 'fixed', width: '100%' }}>
                        <thead className="bg-surface-container-low sticky top-0 z-10 shadow-sm">
                          <tr>
                            {commCols.filter(c => c.visible && (c.id !== 'com_escr' || isAdmin)).map((col, colIdx, visArr) => {
                              const colId = col.id
                              const colWidth = commWidths[colId] ?? COMM_DEFAULT_WIDTHS[colId] ?? 100
                              const labels: Record<string,string> = {
                                data:'Data', vendedor:'Vendedor', industria:'Indústria',
                                nr_fabrica:'Nr. Fábrica', razao_social:'Razão Social',
                                nome_fantasia:'Nome Fantasia', cidade:'Cidade', uf:'UF',
                                valor:'Valor', politica:'Desc. Coml.', com_rep:'Com. Rep', com_escr:'Com. Escr.',
                                faturado:'Faturado', a_faturar:'A Faturar',
                              }
                              const isRight = ['valor','politica','com_rep','com_escr','faturado','a_faturar'].includes(colId)
                              return (
                                <th
                                  key={colId}
                                  style={{ width: colWidth, minWidth: 40, position: 'relative' }}
                                  draggable
                                  onDragStart={e => { e.dataTransfer.setData('commColIdx', String(colIdx)) }}
                                  onDragOver={e => e.preventDefault()}
                                  onDrop={e => {
                                    e.preventDefault()
                                    const fromIdx = parseInt(e.dataTransfer.getData('commColIdx'))
                                    if (fromIdx === colIdx || isNaN(fromIdx)) return
                                    const fromId = visArr[fromIdx].id
                                    const newCfg = [...commConfig]
                                    const fromPos = newCfg.findIndex(c => c.id === fromId)
                                    const toPos = newCfg.findIndex(c => c.id === colId)
                                    if (fromPos >= 0 && toPos >= 0) {
                                      const [moved] = newCfg.splice(fromPos, 1)
                                      newCfg.splice(toPos, 0, moved)
                                      saveCommCols(newCfg)
                                    }
                                  }}
                                >
                                  <div className={`px-2 py-1.5 text-[12px] font-semibold text-on-surface-variant truncate cursor-grab select-none ${isRight ? 'text-right' : ''} ${colId==='com_rep'?'text-emerald-700':''} ${colId==='com_escr'?'text-blue-700':''} ${colId==='a_faturar'?'text-orange-600':''}`}>
                                    {labels[colId] || col.label}
                                  </div>
                                  {/* Handle resize */}
                                  <div
                                    style={{ position:'absolute', top:0, right:0, width:5, height:'100%', cursor:'col-resize', zIndex:20 }}
                                    className="hover:bg-primary/40 group"
                                    onMouseDown={e => {
                                      e.preventDefault(); e.stopPropagation()
                                      const startX = e.clientX, startW = colWidth
                                      const onMove = (ev: MouseEvent) => saveCommWidths({ ...commWidths, [colId]: Math.max(40, startW + ev.clientX - startX) })
                                      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                                      window.addEventListener('mousemove', onMove)
                                      window.addEventListener('mouseup', onUp)
                                    }}
                                  >
                                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-px h-4 bg-outline/30 group-hover:bg-primary/60" />
                                  </div>
                                </th>
                              )
                            })}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {rows.map(r => (
                            <tr key={r.id} className="hover:bg-surface-container-low/50 cursor-pointer" onClick={() => window.open(`/orders/${r.id}`, '_self')}>
                              {commCols.filter(c => c.visible && (c.id !== 'com_escr' || isAdmin)).map(col => {
                                const id = col.id
                                if (id === 'data') return <td key={id} className="px-2 py-1 whitespace-nowrap text-on-surface-variant">{fmtDate(r.data_venda)}</td>
                                if (id === 'vendedor') return <td key={id} className="px-2 py-1 whitespace-nowrap text-on-surface-variant">{r.vendedor}</td>
                                if (id === 'industria') return <td key={id} className="px-2 py-1 whitespace-nowrap font-medium text-on-surface">{r.industria}</td>
                                if (id === 'nr_fabrica') return <td key={id} className="px-2 py-1 whitespace-nowrap text-on-surface-variant">{r.nr_ped_fabrica || '—'}</td>
                                if (id === 'razao_social') return <td key={id} className="px-2 py-1 max-w-[160px]"><span className="block truncate text-on-surface font-medium" title={r.razao_social}>{r.razao_social}</span></td>
                                if (id === 'nome_fantasia') return <td key={id} className="px-2 py-1 max-w-[130px]"><span className="block truncate text-on-surface-variant" title={r.cliente || ''}>{r.cliente || '—'}</span></td>
                                if (id === 'cidade') return <td key={id} className="px-2 py-1 whitespace-nowrap text-on-surface-variant">{r.cidade || '—'}</td>
                                if (id === 'uf') return <td key={id} className="px-2 py-1 whitespace-nowrap text-on-surface-variant">{r.uf || '—'}</td>
                                if (id === 'valor') return <td key={id} className="px-2 py-1 text-right whitespace-nowrap font-bold text-on-surface">{fmtR(r.total_value)}</td>
                                if (id === 'politica') return <td key={id} className="px-2 py-1 text-right whitespace-nowrap text-on-surface-variant">{r.discount_pct ? fmtPct(r.discount_pct) : '—'}</td>
                                if (id === 'com_rep') {
                                  const isEditing = isAdmin && editingComm?.orderId === r.id && editingComm.field === 'rep'
                                  const preview = isEditing ? previewValue(editingComm!.pctText, editingComm!.totalValue) : null
                                  return (
                                    <td key={id} className="px-2 py-1 text-right whitespace-nowrap"
                                      onClick={e => {
                                        if (!isAdmin) return
                                        e.stopPropagation()
                                        setEditingComm({ orderId: r.id, field: 'rep', pctText: String(Number(r.rep_commission_pct).toFixed(1)), totalValue: Number(r.total_value), currentRepPct: Number(r.rep_commission_pct), currentOffPct: Number(r.office_commission_pct) })
                                        setTimeout(() => commInputRef.current?.select(), 30)
                                      }}>
                                      {isEditing ? (
                                        <div className="flex flex-col items-end gap-0.5">
                                          <div className="flex items-center gap-0.5">
                                            <input ref={commInputRef}
                                              className="w-14 text-right border border-emerald-400 rounded px-1 py-0.5 text-[12px] font-bold text-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                                              value={editingComm!.pctText}
                                              onChange={e => setEditingComm(c => c ? { ...c, pctText: e.target.value } : c)}
                                              onBlur={saveInlineCommission}
                                              onKeyDown={e => { if (e.key === 'Enter') saveInlineCommission(); else if (e.key === 'Escape') setEditingComm(null) }} />
                                            <span className="text-emerald-600 text-[11px] font-bold">%</span>
                                          </div>
                                          {preview !== null && <span className="text-[10px] text-emerald-600/80">≈ {fmtR(preview)}</span>}
                                        </div>
                                      ) : (
                                        <div className="flex justify-end items-center gap-1">
                                          <span className={`font-bold ${r.commission_manual_override ? 'text-orange-600' : 'text-emerald-700'} ${isAdmin ? 'cursor-pointer hover:underline' : ''}`}
                                            title={isAdmin ? 'Clique para editar' : undefined}>
                                            {fmtR(Number(r.rep_commission_value) || (Number(r.total_value) * Number(r.rep_commission_pct) / 100))}
                                          </span>
                                          <span className="text-emerald-600/70 text-[12px]">({fmtPct(r.rep_commission_pct)})</span>
                                        </div>
                                      )}
                                    </td>
                                  )
                                }
                                if (id === 'com_escr') {
                                  const isEditing = editingComm?.orderId === r.id && editingComm.field === 'office'
                                  const preview = isEditing ? previewValue(editingComm!.pctText, editingComm!.totalValue) : null
                                  return (
                                    <td key={id} className="px-2 py-1 text-right whitespace-nowrap"
                                      onClick={e => {
                                        e.stopPropagation()
                                        setEditingComm({ orderId: r.id, field: 'office', pctText: String(Number(r.office_commission_pct).toFixed(1)), totalValue: Number(r.total_value), currentRepPct: Number(r.rep_commission_pct), currentOffPct: Number(r.office_commission_pct) })
                                        setTimeout(() => commInputRef.current?.select(), 30)
                                      }}>
                                      {isEditing ? (
                                        <div className="flex flex-col items-end gap-0.5">
                                          <div className="flex items-center gap-0.5">
                                            <input ref={commInputRef}
                                              className="w-14 text-right border border-blue-400 rounded px-1 py-0.5 text-[12px] font-bold text-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                              value={editingComm!.pctText}
                                              onChange={e => setEditingComm(c => c ? { ...c, pctText: e.target.value } : c)}
                                              onBlur={saveInlineCommission}
                                              onKeyDown={e => { if (e.key === 'Enter') saveInlineCommission(); else if (e.key === 'Escape') setEditingComm(null) }} />
                                            <span className="text-blue-600 text-[11px] font-bold">%</span>
                                          </div>
                                          {preview !== null && <span className="text-[10px] text-blue-600/80">≈ {fmtR(preview)}</span>}
                                        </div>
                                      ) : (
                                        <div className="flex justify-end items-center gap-1">
                                          <span className={`font-bold ${r.commission_manual_override ? 'text-orange-600' : 'text-blue-700'} cursor-pointer hover:underline`}
                                            title="Clique para editar">
                                            {fmtR(Number(r.office_commission_value) || (Number(r.total_value) * Number(r.office_commission_pct) / 100))}
                                          </span>
                                          <span className="text-blue-600/70 text-[12px]">({fmtPct(r.office_commission_pct)})</span>
                                        </div>
                                      )}
                                    </td>
                                  )
                                }
                                if (id === 'faturado') return <td key={id} className="px-2 py-1 text-right whitespace-nowrap font-medium text-on-surface-variant">{fmtR(r.valor_faturado)}</td>
                                if (id === 'a_faturar') return <td key={id} className="px-2 py-1 text-right whitespace-nowrap">{Number(r.falta_faturar) > 0 ? <span className="font-bold text-orange-600">{fmtR(r.falta_faturar)}</span> : <span className="text-on-surface-variant/50">—</span>}</td>
                                return null
                              })}
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-surface-container-low border-t-2 border-outline-variant font-bold text-[12px]">
                            {(() => {
                              const textIds = ['data','vendedor','industria','nr_fabrica','razao_social','nome_fantasia','cidade','uf']
                              const firstVisTextId = commCols.find(c => c.visible && textIds.includes(c.id))?.id
                              return commCols.filter(c => c.visible && (c.id !== 'com_escr' || isAdmin)).map(col => {
                                const id = col.id
                                if (textIds.includes(id)) return <td key={id} className="px-2 py-1.5 text-on-surface-variant">{id === firstVisTextId ? `Total — ${rows.length} pedido${rows.length !== 1 ? 's' : ''}` : ''}</td>
                                if (id === 'valor')    return <td key={id} className="px-2 py-1.5 text-right text-on-surface">{fmtR(totalSold)}</td>
                                if (id === 'politica') return <td key={id} className="px-2 py-1.5 text-right text-on-surface-variant/50">—</td>
                                if (id === 'com_rep')  return <td key={id} className="px-2 py-1.5 text-right text-emerald-700">{fmtR(totalRepComm)}<span className="text-emerald-600/70 text-[11px] font-normal ml-1">({fmtPct(avgRepPct)})</span></td>
                                if (id === 'com_escr') return <td key={id} className="px-2 py-1.5 text-right text-blue-700">{fmtR(totalOffComm)}<span className="text-blue-600/70 text-[11px] font-normal ml-1">({fmtPct(avgOffPct)})</span></td>
                                if (id === 'faturado') return <td key={id} className="px-2 py-1.5 text-right text-on-surface-variant">{fmtR(sum('valor_faturado'))}</td>
                                if (id === 'a_faturar') return <td key={id} className="px-2 py-1.5 text-right text-orange-600">{fmtR(sum('falta_faturar'))}</td>
                                return null
                              })
                            })()}
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <div className="px-4 py-1.5 bg-surface-container-lowest border-t border-outline-variant/50 text-[12px] text-outline/70">
                      * Valor Faturado = pedidos com status <strong>final</strong>. Falta Faturar = demais pedidos.
                      O percentual ao lado do total de comissão representa o quanto a comissão total representa sobre o valor total vendido no período filtrado.
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

        {/* ═══ EVOLUÇÃO DE VENDAS ═══════════════════════════════════════ */}
        {tab === 'evolution' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[12px] font-semibold text-outline">Últimos</span>
              {[6,12,24].map(m => (
                <button key={m} onClick={() => setEvolutionMonths(m)}
                  className={`px-3 py-1 rounded-lg text-[12px] font-semibold border transition-colors ${evolutionMonths === m ? 'bg-primary text-white border-primary' : 'border-outline-variant text-outline hover:bg-surface-container'}`}>
                  {m} meses
                </button>
              ))}
            </div>
            {evolutionQ.isLoading ? <PageSpinner /> : !evolutionQ.data?.length ? <EmptyState label="Nenhum dado no período" /> : (
              <div className="space-y-4">
                {/* Cards resumo */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Vendido', value: fmtR((evolutionQ.data as any[]).reduce((s:number,r:any) => s+Number(r.total_value),0)), color: '#4f46e5' },
                    { label: 'Total de Pedidos', value: (evolutionQ.data as any[]).reduce((s:number,r:any) => s+r.total_pedidos,0).toString(), color: '#0891b2' },
                    { label: 'Peças Vendidas', value: (evolutionQ.data as any[]).reduce((s:number,r:any) => s+r.total_pieces,0).toLocaleString('pt-BR'), color: '#059669' },
                    { label: 'Clientes Atendidos', value: (evolutionQ.data as any[]).reduce((s:number,r:any) => s+r.clientes_atendidos,0).toString(), color: '#d97706' },
                  ].map(card => (
                    <div key={card.label} className="bg-white rounded-xl border border-outline-variant p-4">
                      <p className="text-[11px] font-semibold text-outline uppercase tracking-wide mb-1">{card.label}</p>
                      <p className="text-[22px] font-black" style={{ color: card.color }}>{card.value}</p>
                    </div>
                  ))}
                </div>
                {/* Tabela mensal */}
                <div className="bg-white rounded-xl border border-outline-variant overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="text-[12px] w-full">
                      <thead className="bg-surface-container-low">
                        <tr>
                          {['Mês','Pedidos','Peças','Valor Total','Ticket Médio','Com. Rep','Com. Escr.','Clientes'].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-semibold text-outline whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {evolutionQ.data.map((r: any) => (
                          <tr key={r.mes} className="hover:bg-surface-container-low/50">
                            <td className="px-3 py-2 font-bold text-on-surface whitespace-nowrap">{r.mes_label}</td>
                            <td className="px-3 py-2 text-center">{r.total_pedidos}</td>
                            <td className="px-3 py-2 text-center">{Number(r.total_pieces).toLocaleString('pt-BR')}</td>
                            <td className="px-3 py-2 font-bold text-on-surface">{fmtR(r.total_value)}</td>
                            <td className="px-3 py-2 text-outline">{fmtR(r.ticket_medio)}</td>
                            <td className="px-3 py-2 text-emerald-700 font-semibold">{fmtR(r.rep_commission)}</td>
                            <td className="px-3 py-2 text-blue-700 font-semibold">{fmtR(r.office_commission)}</td>
                            <td className="px-3 py-2 text-center">{r.clientes_atendidos}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-surface-container-low border-t-2 border-outline-variant font-bold text-[12px]">
                        <tr>
                          <td className="px-3 py-2">TOTAL</td>
                          <td className="px-3 py-2 text-center">{evolutionQ.data.reduce((s:number,r:any)=>s+r.total_pedidos,0)}</td>
                          <td className="px-3 py-2 text-center">{evolutionQ.data.reduce((s:number,r:any)=>s+r.total_pieces,0).toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2">{fmtR(evolutionQ.data.reduce((s:number,r:any)=>s+Number(r.total_value),0))}</td>
                          <td className="px-3 py-2">—</td>
                          <td className="px-3 py-2 text-emerald-700">{fmtR(evolutionQ.data.reduce((s:number,r:any)=>s+Number(r.rep_commission),0))}</td>
                          <td className="px-3 py-2 text-blue-700">{fmtR(evolutionQ.data.reduce((s:number,r:any)=>s+Number(r.office_commission),0))}</td>
                          <td className="px-3 py-2 text-center">—</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ CLIENTES INATIVOS ════════════════════════════════════════ */}
        {tab === 'inactive' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[12px] font-semibold text-outline">Sem comprar há mais de</span>
              {[30,60,90,120].map(d => (
                <button key={d} onClick={() => setInactiveDays(d)}
                  className={`px-3 py-1 rounded-lg text-[12px] font-semibold border transition-colors ${inactiveDays === d ? 'bg-amber-500 text-white border-amber-500' : 'border-outline-variant text-outline hover:bg-surface-container'}`}>
                  {d} dias
                </button>
              ))}
            </div>
            {inactiveQ.isLoading ? <PageSpinner /> : !inactiveQ.data?.length ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 text-center">
                <p className="text-emerald-700 font-semibold">✅ Todos os clientes compraram nos últimos {inactiveDays} dias!</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-outline-variant overflow-hidden">
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
                  <p className="text-[12px] font-semibold text-amber-800">⚠️ {inactiveQ.data.length} cliente{inactiveQ.data.length !== 1 ? 's' : ''} sem comprar há +{inactiveDays} dias</p>
                  <p className="text-[11px] text-amber-600">Total histórico: {fmtR(inactiveQ.data.reduce((s:number,r:any)=>s+Number(r.total_comprado),0))}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="text-[12px] w-full">
                    <thead className="bg-surface-container-low">
                      <tr>
                        {['Razão Social','Fantasia','Cidade','UF','Rep.','Último Pedido','Dias Inativo','Total Comprado','Pedidos','Contato'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-outline whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {inactiveQ.data.map((r: any) => (
                        <tr key={r.id} className={`hover:bg-surface-container-low/50 ${!r.ultimo_pedido ? 'bg-red-50/30' : ''}`}>
                          <td className="px-3 py-2 font-semibold text-on-surface max-w-[160px]"><span className="block truncate" title={r.razao_social}>{r.razao_social}</span></td>
                          <td className="px-3 py-2 text-outline max-w-[120px]"><span className="block truncate">{r.nome_fantasia || '—'}</span></td>
                          <td className="px-3 py-2 whitespace-nowrap text-outline">{r.cidade || '—'}</td>
                          <td className="px-3 py-2 text-outline">{r.uf || '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-outline">{r.rep_name || '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {r.ultimo_pedido
                              ? <span className="text-outline">{fmtDatePtBR(r.ultimo_pedido)}</span>
                              : <span className="text-red-500 font-bold">Nunca comprou</span>
                            }
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${!r.dias_sem_comprar ? 'bg-red-100 text-red-700' : r.dias_sem_comprar > 90 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>
                              {r.dias_sem_comprar ?? '∞'} d
                            </span>
                          </td>
                          <td className="px-3 py-2 font-semibold">{fmtR(r.total_comprado)}</td>
                          <td className="px-3 py-2 text-center text-outline">{r.total_pedidos}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {(r.whatsapp || r.phone) && (
                              <a href={`https://wa.me/55${(r.whatsapp||r.phone).replace(/\D/g,'')}`} target="_blank" rel="noreferrer"
                                className="text-emerald-600 hover:text-emerald-800 text-[11px] font-semibold">📱 WhatsApp</a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ PERFORMANCE POR REPRESENTANTE ═══════════════════════════ */}
        {tab === 'repperformance' && isAdmin && (
          repPerfQ.isLoading ? <PageSpinner /> : !repPerfQ.data?.length ? <EmptyState label="Nenhum dado no período" /> : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Total da Equipe', value: fmtR(repPerfQ.data.reduce((s:number,r:any)=>s+Number(r.total_value),0)), color:'#4f46e5' },
                  { label: 'Pedidos', value: repPerfQ.data.reduce((s:number,r:any)=>s+r.total_pedidos,0).toString(), color:'#0891b2' },
                  { label: 'Representantes Ativos', value: repPerfQ.data.filter((r:any)=>r.total_pedidos>0).length.toString(), color:'#059669' },
                  { label: 'Com. Total Equipe', value: fmtR(repPerfQ.data.reduce((s:number,r:any)=>s+Number(r.comissao_rep),0)), color:'#d97706' },
                ].map(card => (
                  <div key={card.label} className="bg-white rounded-xl border border-outline-variant p-4">
                    <p className="text-[11px] font-semibold text-outline uppercase tracking-wide mb-1">{card.label}</p>
                    <p className="text-[22px] font-black" style={{ color: card.color }}>{card.value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-xl border border-outline-variant overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="text-[12px] w-full">
                    <thead className="bg-surface-container-low">
                      <tr>
                        {['#','Representante','Pedidos','Peças','Total Vendido','Ticket Médio','Média Pç/Pedido','Com. Rep','Com. Escr.','Clientes'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-outline whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {repPerfQ.data.map((r: any, i: number) => (
                        <tr key={r.rep_id} className="hover:bg-surface-container-low/50">
                          <td className="px-3 py-2 font-bold text-outline">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}º`}</td>
                          <td className="px-3 py-2 font-semibold text-on-surface whitespace-nowrap">{r.rep_name}</td>
                          <td className="px-3 py-2 text-center">{r.total_pedidos}</td>
                          <td className="px-3 py-2 text-center">{Number(r.total_pieces).toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 font-bold text-primary">{fmtR(r.total_value)}</td>
                          <td className="px-3 py-2 text-outline">{fmtR(r.ticket_medio)}</td>
                          <td className="px-3 py-2 text-center text-outline">{Number(r.media_pecas_pedido).toFixed(0)}</td>
                          <td className="px-3 py-2 text-emerald-700 font-semibold">{fmtR(r.comissao_rep)}</td>
                          <td className="px-3 py-2 text-blue-700 font-semibold">{fmtR(r.comissao_escritorio)}</td>
                          <td className="px-3 py-2 text-center">{r.clientes_atendidos}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )
        )}

        {/* ═══ CURVA ABC CLIENTES ══════════════════════════════════════ */}
        {tab === 'abc' && (
          abcQ.isLoading ? <PageSpinner /> : !abcQ.data?.length ? <EmptyState label="Nenhum dado no período" /> : (() => {
            const data = abcQ.data as any[]
            const totalA = data.filter(r=>r.classe==='A').reduce((s:number,r:any)=>s+Number(r.total_value),0)
            const totalB = data.filter(r=>r.classe==='B').reduce((s:number,r:any)=>s+Number(r.total_value),0)
            const totalC = data.filter(r=>r.classe==='C').reduce((s:number,r:any)=>s+Number(r.total_value),0)
            const grandTotal = totalA+totalB+totalC
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {[{cls:'A',cor:'#16a34a',bg:'bg-green-50 border-green-200',label:'Classe A — 80% da receita',total:totalA,count:data.filter(r=>r.classe==='A').length},
                    {cls:'B',cor:'#ca8a04',bg:'bg-yellow-50 border-yellow-200',label:'Classe B — próximos 15%',total:totalB,count:data.filter(r=>r.classe==='B').length},
                    {cls:'C',cor:'#dc2626',bg:'bg-red-50 border-red-200',label:'Classe C — últimos 5%',total:totalC,count:data.filter(r=>r.classe==='C').length},
                  ].map(c => (
                    <div key={c.cls} className={`rounded-xl border p-4 ${c.bg}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl font-black" style={{color:c.cor}}>{c.cls}</span>
                        <span className="text-[11px] text-outline">{c.label}</span>
                      </div>
                      <p className="text-[20px] font-black text-on-surface">{fmtR(c.total)}</p>
                      <p className="text-[12px] text-outline">{c.count} clientes · {grandTotal>0?(c.total/grandTotal*100).toFixed(1):0}% do total</p>
                    </div>
                  ))}
                </div>
                <div className="bg-white rounded-xl border border-outline-variant overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="text-[12px] w-full">
                      <thead className="bg-surface-container-low">
                        <tr>{['Classe','Razão Social','Cidade','UF','Rep.','Pedidos','Peças','Total','% Receita','% Acum.','Último Pedido'].map(h=>(
                          <th key={h} className="px-3 py-2 text-left font-semibold text-outline whitespace-nowrap">{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {data.map((r:any) => (
                          <tr key={r.id} className="hover:bg-surface-container-low/50">
                            <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${r.classe==='A'?'bg-green-100 text-green-700':r.classe==='B'?'bg-yellow-100 text-yellow-700':'bg-red-100 text-red-700'}`}>{r.classe}</span></td>
                            <td className="px-3 py-2 font-semibold max-w-[160px]"><span className="block truncate" title={r.razao_social}>{r.razao_social}</span></td>
                            <td className="px-3 py-2 text-outline">{r.cidade||'—'}</td>
                            <td className="px-3 py-2 text-outline">{r.uf||'—'}</td>
                            <td className="px-3 py-2 text-outline whitespace-nowrap">{r.rep_name||'—'}</td>
                            <td className="px-3 py-2 text-center">{r.total_pedidos}</td>
                            <td className="px-3 py-2 text-center">{Number(r.total_pieces).toLocaleString('pt-BR')}</td>
                            <td className="px-3 py-2 font-bold text-primary">{fmtR(r.total_value)}</td>
                            <td className="px-3 py-2 text-center">{Number(r.pct).toFixed(1)}%</td>
                            <td className="px-3 py-2 text-center">{Number(r.pct_acum).toFixed(1)}%</td>
                            <td className="px-3 py-2 whitespace-nowrap text-outline">{r.ultimo_pedido ? fmtDatePtBR(r.ultimo_pedido) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          })()
        )}

        {/* ═══ COMPARATIVO DE PERÍODO ══════════════════════════════════ */}
        {tab === 'comparison' && (
          comparisonQ.isLoading ? <PageSpinner /> : !comparisonQ.data ? null : (() => {
            const d = comparisonQ.data as any
            const cur = d.current, prev = d.previous
            const pct = (c:number, p:number) => p>0 ? ((c-p)/p*100).toFixed(1) : null
            const metric = (label:string, cur:number, prev:number, isCurrency=true) => {
              const p = pct(cur, prev)
              const up = cur >= prev
              return (
                <div className="bg-white rounded-xl border border-outline-variant p-4">
                  <p className="text-[11px] font-semibold text-outline uppercase tracking-wide mb-3">{label}</p>
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-[11px] text-outline mb-0.5">Período atual</p>
                      <p className="text-[20px] font-black text-on-surface">{isCurrency?fmtR(cur):cur.toLocaleString('pt-BR')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-outline mb-0.5">Período anterior</p>
                      <p className="text-[14px] font-semibold text-outline">{isCurrency?fmtR(prev):prev.toLocaleString('pt-BR')}</p>
                    </div>
                  </div>
                  {p !== null && (
                    <div className={`mt-2 flex items-center gap-1 text-[12px] font-bold ${up?'text-green-600':'text-red-600'}`}>
                      <span>{up?'▲':'▼'}</span> {Math.abs(Number(p))}% vs período anterior
                    </div>
                  )}
                </div>
              )
            }
            return (
              <div className="space-y-4">
                <div className="bg-surface-container-low rounded-xl px-4 py-2 text-[12px] text-outline flex gap-4 flex-wrap">
                  <span>📅 Atual: {new Date(d.period.from+'T12:00').toLocaleDateString('pt-BR')} a {new Date(d.period.to+'T12:00').toLocaleDateString('pt-BR')}</span>
                  <span>📅 Anterior: {new Date(d.prev_period.from+'T12:00').toLocaleDateString('pt-BR')} a {new Date(d.prev_period.to+'T12:00').toLocaleDateString('pt-BR')}</span>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {metric('Total Vendido', Number(cur.total_value), Number(prev.total_value))}
                  {metric('Pedidos', Number(cur.total_pedidos), Number(prev.total_pedidos), false)}
                  {metric('Peças', Number(cur.total_pieces), Number(prev.total_pieces), false)}
                  {metric('Ticket Médio', Number(cur.ticket_medio), Number(prev.ticket_medio))}
                  {metric('Clientes Atendidos', Number(cur.clientes_atendidos), Number(prev.clientes_atendidos), false)}
                  {metric('Com. Representante', Number(cur.rep_commission), Number(prev.rep_commission))}
                  {metric('Com. Escritório', Number(cur.office_commission), Number(prev.office_commission))}
                </div>
              </div>
            )
          })()
        )}

        {/* ═══ ANÁLISE POR REGIÃO ══════════════════════════════════════ */}
        {tab === 'region' && (
          regionQ.isLoading ? <PageSpinner /> : !regionQ.data?.length ? <EmptyState label="Nenhum dado no período" /> : (() => {
            const data = regionQ.data as any[]
            const grandTotal = data.reduce((s:number,r:any)=>s+Number(r.total_value),0)
            return (
              <div className="bg-white rounded-xl border border-outline-variant overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="text-[12px] w-full">
                    <thead className="bg-surface-container-low">
                      <tr>{['UF','Pedidos','Clientes','Peças','Total Vendido','% do Total','Ticket Médio','Com. Rep'].map(h=>(
                        <th key={h} className="px-3 py-2 text-left font-semibold text-outline whitespace-nowrap">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.map((r:any) => (
                        <tr key={r.uf} className="hover:bg-surface-container-low/50">
                          <td className="px-3 py-2 font-bold text-on-surface">{r.uf}</td>
                          <td className="px-3 py-2 text-center">{r.total_pedidos}</td>
                          <td className="px-3 py-2 text-center">{r.clientes_atendidos}</td>
                          <td className="px-3 py-2 text-center">{Number(r.total_pieces).toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 font-bold text-primary">{fmtR(r.total_value)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-surface-container-low rounded-full h-1.5 overflow-hidden">
                                <div className="h-full rounded-full bg-primary" style={{width:`${grandTotal>0?Number(r.total_value)/grandTotal*100:0}%`}} />
                              </div>
                              <span className="text-[11px] text-outline w-10 text-right">{grandTotal>0?(Number(r.total_value)/grandTotal*100).toFixed(1):0}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-outline">{fmtR(r.ticket_medio)}</td>
                          <td className="px-3 py-2 text-emerald-700 font-semibold">{fmtR(r.comissao_rep)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-surface-container-low border-t-2 border-outline-variant font-bold text-[12px]">
                      <tr>
                        <td className="px-3 py-2">TOTAL</td>
                        <td className="px-3 py-2 text-center">{data.reduce((s:number,r:any)=>s+r.total_pedidos,0)}</td>
                        <td className="px-3 py-2 text-center">{data.reduce((s:number,r:any)=>s+r.clientes_atendidos,0)}</td>
                        <td className="px-3 py-2 text-center">{data.reduce((s:number,r:any)=>s+r.total_pieces,0).toLocaleString('pt-BR')}</td>
                        <td className="px-3 py-2 text-primary">{fmtR(grandTotal)}</td>
                        <td className="px-3 py-2">100%</td>
                        <td className="px-3 py-2">—</td>
                        <td className="px-3 py-2 text-emerald-700">{fmtR(data.reduce((s:number,r:any)=>s+Number(r.comissao_rep),0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )
          })()
        )}

        {/* ═══ PROJEÇÃO DE COMISSÃO ════════════════════════════════════ */}
        {tab === 'projection' && (
          projectionQ.isLoading ? <PageSpinner /> : !projectionQ.data?.length ? <EmptyState label="Nenhum pedido em aberto" /> : (() => {
            const data = projectionQ.data as any[]
            const abertos = data.filter((r:any)=>r.situacao==='a_faturar')
            const faturados = data.filter((r:any)=>r.situacao==='faturado')
            const totalAberto = abertos.reduce((s:number,r:any)=>s+Number(r.comissao_rep),0)
            const totalFaturado = faturados.reduce((s:number,r:any)=>s+Number(r.comissao_rep),0)
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    {label:'A Receber (em aberto)', v:totalAberto, sub:`${abertos.reduce((s:number,r:any)=>s+r.pedidos,0)} pedidos`, color:'#d97706'},
                    {label:'Já Faturado', v:totalFaturado, sub:`${faturados.reduce((s:number,r:any)=>s+r.pedidos,0)} pedidos`, color:'#16a34a'},
                    {label:'Total Geral', v:totalAberto+totalFaturado, sub:'todos os pedidos', color:'#4f46e5'},
                    {label:'Valor Total em Pedidos', v:data.reduce((s:number,r:any)=>s+Number(r.total_value),0), sub:'', color:'#0891b2'},
                  ].map(c=>(
                    <div key={c.label} className="bg-white rounded-xl border border-outline-variant p-4">
                      <p className="text-[11px] font-semibold text-outline uppercase tracking-wide mb-1">{c.label}</p>
                      <p className="text-[20px] font-black" style={{color:c.color}}>{fmtR(c.v)}</p>
                      {c.sub && <p className="text-[11px] text-outline mt-0.5">{c.sub}</p>}
                    </div>
                  ))}
                </div>
                <div className="bg-white rounded-xl border border-outline-variant overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="text-[12px] w-full">
                      <thead className="bg-surface-container-low">
                        <tr>{['Situação','Representante','Status','Pedidos','Peças','Valor Pedidos','Com. Rep','Com. Escr.'].map(h=>(
                          <th key={h} className="px-3 py-2 text-left font-semibold text-outline whitespace-nowrap">{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {data.map((r:any, i:number) => (
                          <tr key={i} className="hover:bg-surface-container-low/50">
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${r.situacao==='faturado'?'bg-green-100 text-green-700':'bg-amber-100 text-amber-700'}`}>
                                {r.situacao==='faturado'?'✅ Faturado':'⏳ A Faturar'}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-semibold whitespace-nowrap">{r.rep_name}</td>
                            <td className="px-3 py-2">
                              {r.status_name && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full flex-shrink-0" style={{background:r.status_color||'#9ca3af'}}/>{r.status_name}</span>}
                            </td>
                            <td className="px-3 py-2 text-center">{r.pedidos}</td>
                            <td className="px-3 py-2 text-center">{Number(r.total_pieces).toLocaleString('pt-BR')}</td>
                            <td className="px-3 py-2 font-bold text-on-surface">{fmtR(r.total_value)}</td>
                            <td className="px-3 py-2 text-emerald-700 font-semibold">{fmtR(r.comissao_rep)}</td>
                            <td className="px-3 py-2 text-blue-700 font-semibold">{fmtR(r.comissao_escritorio)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          })()
        )}

        </div>
      </div>
    </div>
  )
}
