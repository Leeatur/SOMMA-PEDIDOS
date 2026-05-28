import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Image as ImageIcon, ChevronDown, Archive } from 'lucide-react'
import { productsApi } from '../api/client'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import { Modal } from '../components/ui/Modal'
import { ColumnDef, ColumnConfigButton, useColumnConfig } from '../components/ui/ColumnConfig'
import { PhotosZipImportModal } from '../components/ui/PhotosZipImportModal'

const SIZE_ORDER = [
  'RN','PP','XP','P','M','G','GG','XG','EXG','XGG','2XG','3XG','4XG',
  '34','36','38','40','42','44','46','48','50','52','54','56','58','60',
  '1','2','4','6','8','10','12','14','16','18','U',
]

function sortSizes(sizes: string[]) {
  return [...sizes].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a.toUpperCase())
    const bi = SIZE_ORDER.indexOf(b.toUpperCase())
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

/** Expands a range notation like "P-GG" → ["P","M","G","GG"] using SIZE_ORDER */
function expandSizeKey(key: string): string[] {
  const m = key.match(/^([A-Za-z0-9]+)-([A-Za-z0-9]+)$/)
  if (m) {
    const s = SIZE_ORDER.indexOf(m[1].toUpperCase())
    const e = SIZE_ORDER.indexOf(m[2].toUpperCase())
    if (s >= 0 && e >= s) return SIZE_ORDER.slice(s, e + 1)
  }
  return [key]
}

/** Expands range keys in a sizes map, e.g. {"P-GG": 1} → {P:1, M:1, G:1, GG:1} */
function expandGradeSizes(sizes: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [key, val] of Object.entries(sizes)) {
    for (const expanded of expandSizeKey(key)) {
      result[expanded] = val
    }
  }
  return result
}

interface GradeConfig {
  id: string
  color: string | null
  sizes: Record<string, number>
  total_pieces: number
  sort_order: number
}

interface Product {
  id: string
  reference: string
  type: 'regular' | 'pack'
  product_name: string | null
  model: string | null
  size_range: string | null
  base_price: number
  category: string | null
  observation: string | null
  image_url: string | null
  price_table_name: string | null
  factory_name: string | null
  grade_configs: GradeConfig[] | null
}

// ─── Product Detail Modal ────────────────────────────────────────────────────
function ProductDetailModal({ p, onClose }: { p: Product; onClose: () => void }) {
  const totalPieces = p.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 0
  const pricePerBox = p.base_price * totalPieces

  return (
    <Modal open onClose={onClose} title={p.reference} size="md">
      <div className="space-y-4">
        {p.image_url ? (
          <div className="w-full aspect-square max-h-64 overflow-hidden rounded-xl bg-surface-container">
            <img src={p.image_url} alt={p.reference} className="w-full h-full object-contain" />
          </div>
        ) : (
          <div className="w-full h-40 bg-surface-container rounded-xl flex items-center justify-center text-gray-300">
            <ImageIcon className="h-12 w-12" />
          </div>
        )}

        <div className="flex items-start gap-2 flex-wrap">
          <Badge variant={p.type === 'pack' ? 'purple' : 'info'}>
            {p.type === 'pack' ? 'PACK' : 'Regular'}
          </Badge>
          {p.product_name && <span className="text-sm font-semibold text-gray-800">{p.product_name}</span>}
          {p.model && <span className="text-sm text-gray-500">{p.model}</span>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-primary/10 rounded-xl p-3 text-center">
            <p className="text-xs text-primary/80 mb-0.5">Preço por peça</p>
            <p className="text-lg font-bold text-primary">R$ {Number(p.base_price).toFixed(2)}</p>
          </div>
          {p.type === 'pack' && totalPieces > 0 && (
            <div className="bg-surface-container-low rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500 mb-0.5">Preço por caixa ({totalPieces} pç)</p>
              <p className="text-lg font-bold text-gray-800">R$ {pricePerBox.toFixed(2)}</p>
            </div>
          )}
        </div>

        <div className="space-y-1.5 text-sm">
          {p.size_range && (
            <div className="flex justify-between">
              <span className="text-gray-500">Tamanhos</span>
              <span className="font-medium text-gray-800">{p.size_range}</span>
            </div>
          )}
          {p.category && (
            <div className="flex justify-between">
              <span className="text-gray-500">Categoria</span>
              <span className="font-medium text-gray-800">{p.category}</span>
            </div>
          )}
          {p.factory_name && (
            <div className="flex justify-between">
              <span className="text-gray-500">Fábrica</span>
              <span className="font-medium text-gray-800">{p.factory_name}</span>
            </div>
          )}
          {p.price_table_name && (
            <div className="flex justify-between">
              <span className="text-gray-500">Tabela</span>
              <span className="font-medium text-gray-800 text-right max-w-[60%] truncate">{p.price_table_name}</span>
            </div>
          )}
          {p.observation && isNaN(Number(p.observation)) && (
            <div className="flex justify-between">
              <span className="text-gray-500">Observação</span>
              <span className="font-medium text-orange-600 text-right max-w-[60%]">{p.observation}</span>
            </div>
          )}
        </div>

        {p.grade_configs && p.grade_configs.length > 0 && (
          <div className="bg-surface-container-low rounded-xl px-4 py-2.5">
            <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">
              {p.type === 'regular' ? 'Tamanhos disponíveis' : 'Grade por caixa'}
            </p>
            {p.type === 'regular' ? (
              /* Regular: só os tamanhos — o rep digita as quantidades na hora */
              <div className="flex flex-wrap gap-1.5">
                {sortSizes(Array.from(new Set(p.grade_configs.flatMap(gc => Object.keys(gc.sizes)).flatMap(expandSizeKey)))).map(s => (
                  <span key={s} className="px-2.5 py-1 text-sm font-semibold bg-white text-primary rounded-lg border border-primary/30 shadow-sm">
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              /* Pack: tabela com quantidade por cor/tamanho */
              <div className="space-y-2">
                {p.grade_configs.map((gc, i) => {
                  const expandedSizes = expandGradeSizes(gc.sizes)
                  const sizes = sortSizes(Object.keys(expandedSizes))
                  return (
                    <div key={i}>
                      {gc.color && <p className="text-xs font-medium text-gray-600 mb-1">{gc.color}</p>}
                      <div className="overflow-x-auto scrollbar-hide">
                        <table className="min-w-max text-xs border border-outline-variant rounded-lg overflow-hidden">
                          <thead className="bg-white">
                            <tr>
                              {sizes.map(s => (
                                <th key={s} className="px-2 py-1 text-gray-600 font-medium text-center min-w-[28px]">{s}</th>
                              ))}
                              <th className="px-2 py-1 text-gray-500 text-center border-l border-outline-variant">Tot</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="bg-surface-container-low">
                              {sizes.map(s => (
                                <td key={s} className="px-2 py-1.5 text-center font-mono">{expandedSizes[s]}</td>
                              ))}
                              <td className="px-2 py-1.5 text-center font-bold border-l border-outline-variant">{gc.total_pieces}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Column definitions ───────────────────────────────────────────────────────

const PRODUCT_COL_DEFS: ColumnDef[] = [
  { id: 'image',       label: 'Foto' },
  { id: 'reference',   label: 'Referência', alwaysVisible: true },
  { id: 'name',        label: 'Nome / Modelo' },
  { id: 'size_range',  label: 'Tamanhos' },
  { id: 'price',       label: 'Preço' },
  { id: 'pieces',      label: 'Pç/cx' },
  { id: 'category',    label: 'Categoria',  defaultVisible: false },
  { id: 'factory',     label: 'Fábrica' },
  { id: 'table',       label: 'Tabela' },
  { id: 'observation', label: 'Observação', defaultVisible: false },
]

// ─── Table Row ───────────────────────────────────────────────────────────────
function ProductRow({
  p,
  visibleCols,
  onOpenDetail,
}: {
  p: Product
  visibleCols: Array<ColumnDef & { visible: boolean }>
  onOpenDetail: (p: Product) => void
}) {
  const totalPieces = p.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 0

  const renderCell = (id: string) => {
    switch (id) {
      case 'image':
        return (
          <td key={id} className="pl-3 pr-2 py-2 w-14">
            <div className="w-10 h-10 rounded-lg bg-surface-container overflow-hidden flex-shrink-0 flex items-center justify-center">
              {p.image_url
                ? <img src={p.image_url} alt={p.reference} className="w-full h-full object-cover" />
                : <ImageIcon className="h-4 w-4 text-gray-300" />}
            </div>
          </td>
        )
      case 'reference':
        return (
          <td key={id} className="px-2 py-2">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-primary text-sm whitespace-nowrap">{p.reference}</span>
              <Badge variant={p.type === 'pack' ? 'purple' : 'info'} className="text-[10px] px-1.5 py-0">
                {p.type === 'pack' ? 'PK' : 'REG'}
              </Badge>
            </div>
          </td>
        )
      case 'name':
        return (
          <td key={id} className="px-2 py-2 max-w-[180px]">
            <p className="text-sm font-medium text-gray-800 truncate">{p.product_name || '—'}</p>
            {p.model && <p className="text-xs text-gray-400 truncate">{p.model}</p>}
          </td>
        )
      case 'size_range':
        return (
          <td key={id} className="px-2 py-2 whitespace-nowrap">
            <span className="text-xs text-gray-600">{p.size_range || '—'}</span>
          </td>
        )
      case 'price':
        return (
          <td key={id} className="px-2 py-2 whitespace-nowrap text-right">
            <span className="text-sm font-bold text-primary">R$ {Number(p.base_price).toFixed(2)}</span>
            <span className="text-xs text-gray-400 ml-0.5">/pç</span>
          </td>
        )
      case 'pieces':
        return (
          <td key={id} className="px-2 py-2 whitespace-nowrap text-center">
            <span className="text-xs text-gray-500">{totalPieces > 0 ? `${totalPieces} pç` : '—'}</span>
          </td>
        )
      case 'category':
        return (
          <td key={id} className="px-2 py-2 max-w-[120px]">
            <span className="text-xs text-gray-500 truncate block">{p.category || '—'}</span>
          </td>
        )
      case 'factory':
        return (
          <td key={id} className="px-2 py-2 max-w-[120px]">
            <span className="text-xs text-gray-600 truncate block">{p.factory_name || '—'}</span>
          </td>
        )
      case 'table':
        return (
          <td key={id} className="px-2 py-2 max-w-[150px]">
            <span className="text-xs text-gray-500 truncate block">{p.price_table_name || '—'}</span>
          </td>
        )
      case 'observation':
        return (
          <td key={id} className="px-2 pr-3 py-2 max-w-[140px]">
            <span className="text-[10px] text-orange-500 truncate block">{p.observation || '—'}</span>
          </td>
        )
      default:
        return <td key={id} className="px-2 py-2" />
    }
  }

  return (
    <tr
      className="border-b border-outline-variant/50 hover:bg-primary/5 cursor-pointer transition-colors"
      onClick={() => onOpenDetail(p)}
    >
      {visibleCols.map(col => renderCell(col.id))}
    </tr>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export function Products() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [showZipImport, setShowZipImport] = useState(false)

  const handleSearch = (val: string) => {
    setSearch(val)
    clearTimeout((window as unknown as { _searchTimer?: number })._searchTimer)
    ;(window as unknown as { _searchTimer?: number })._searchTimer = window.setTimeout(() => {
      setDebouncedSearch(val)
    }, 350)
  }

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ['all-products', debouncedSearch, typeFilter],
    queryFn: () =>
      productsApi.list({
        search: debouncedSearch || undefined,
        type: typeFilter || undefined,
      }).then(r => r.data),
  })

  const { orderedDefs, config, save, reset } = useColumnConfig('products', PRODUCT_COL_DEFS)
  const visibleCols = orderedDefs.filter(c => c.visible)

  const COL_ALIGN: Record<string, string> = {
    price: 'text-right', pieces: 'text-center',
  }

  const total = products?.length || 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 lg:px-8 border-b border-outline-variant bg-white">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="font-display text-[22px] font-bold text-on-surface">Produtos</h1>
            <p className="text-xs text-gray-500">
              {isLoading ? 'Carregando…' : `${total} produto${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowZipImport(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 bg-surface-container hover:bg-gray-200 border border-outline-variant rounded-lg px-3 py-2 transition-colors"
              title="Importar fotos via ZIP"
            >
              <Archive className="h-4 w-4" />
              <span className="hidden sm:inline">Fotos ZIP</span>
            </button>
            <ColumnConfigButton
              defs={PRODUCT_COL_DEFS}
              config={config}
              onSave={save}
              onReset={reset}
            />
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              placeholder="Buscar por referência, nome, modelo..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary bg-white"
          >
            <option value="">Todos</option>
            <option value="regular">Regular</option>
            <option value="pack">Pack</option>
          </select>
        </div>
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <PageSpinner />
        </div>
      ) : total === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 bg-surface-container rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ChevronDown className="h-8 w-8 text-gray-300" />
          </div>
          <p className="text-gray-500 font-medium">Nenhum produto encontrado</p>
          <p className="text-sm text-gray-400 mt-1">
            {debouncedSearch
              ? `Nenhum resultado para "${debouncedSearch}"`
              : 'Importe uma tabela de preços para começar'}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low border-b border-outline-variant sticky top-0 z-10">
              <tr>
                {visibleCols.map(col => (
                  <th
                    key={col.id}
                    className={`px-2 py-2.5 text-xs font-semibold text-gray-500 first:pl-3 last:pr-3 ${COL_ALIGN[col.id] ?? ''}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-50">
              {(products || []).map(p => (
                <ProductRow key={p.id} p={p} visibleCols={visibleCols} onOpenDetail={setDetailProduct} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal detalhe produto */}
      {detailProduct && (
        <ProductDetailModal p={detailProduct} onClose={() => setDetailProduct(null)} />
      )}

      {/* Modal importar fotos ZIP */}
      <PhotosZipImportModal
        open={showZipImport}
        onClose={() => setShowZipImport(false)}
        onDone={() => qc.invalidateQueries({ queryKey: ['all-products'] })}
      />
    </div>
  )
}
