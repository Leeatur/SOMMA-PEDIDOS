import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Image as ImageIcon, Info, ChevronDown, ChevronUp } from 'lucide-react'
import { productsApi } from '../api/client'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import { Modal } from '../components/ui/Modal'

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

function GradeRow({ gc, boxCount }: { gc: GradeConfig; boxCount: number }) {
  const sizes = sortSizes(Object.keys(gc.sizes))
  return (
    <div>
      {gc.color && <p className="text-xs font-medium text-gray-500 mb-0.5">{gc.color}</p>}
      <div className="overflow-x-auto scrollbar-hide">
        <table className="min-w-max text-xs border border-gray-100 rounded overflow-hidden">
          <thead className="bg-gray-50">
            <tr>
              {sizes.map(s => (
                <th key={s} className="px-1.5 py-0.5 text-center text-gray-500 font-medium min-w-[26px]">{s}</th>
              ))}
              <th className="px-1.5 py-0.5 text-center text-gray-400 border-l border-gray-200">Tot</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-white">
              {sizes.map(s => (
                <td key={s} className="px-1.5 py-0.5 text-center text-gray-700">{gc.sizes[s] * boxCount}</td>
              ))}
              <td className="px-1.5 py-0.5 text-center font-bold text-gray-800 border-l border-gray-200">{gc.total_pieces * boxCount}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Product Detail Modal ────────────────────────────────────────────────────
function ProductDetailModal({ p, onClose }: { p: Product; onClose: () => void }) {
  const totalPieces = p.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 0
  const pricePerBox = p.base_price * totalPieces

  return (
    <Modal open onClose={onClose} title={p.reference} size="md">
      <div className="space-y-4">
        {/* Imagem grande */}
        {p.image_url ? (
          <div className="w-full aspect-square max-h-64 overflow-hidden rounded-xl bg-gray-100">
            <img src={p.image_url} alt={p.reference} className="w-full h-full object-contain" />
          </div>
        ) : (
          <div className="w-full h-40 bg-gray-100 rounded-xl flex items-center justify-center text-gray-300">
            <ImageIcon className="h-12 w-12" />
          </div>
        )}

        {/* Cabeçalho */}
        <div className="flex items-start gap-2 flex-wrap">
          <Badge variant={p.type === 'pack' ? 'purple' : 'info'}>
            {p.type === 'pack' ? 'PACK' : 'Regular'}
          </Badge>
          {p.product_name && <span className="text-sm font-semibold text-gray-800">{p.product_name}</span>}
          {p.model && <span className="text-sm text-gray-500">{p.model}</span>}
        </div>

        {/* Preços */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-blue-50 rounded-xl p-3 text-center">
            <p className="text-xs text-blue-500 mb-0.5">Preço por peça</p>
            <p className="text-lg font-bold text-blue-700">R$ {Number(p.base_price).toFixed(2)}</p>
          </div>
          {totalPieces > 0 && (
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500 mb-0.5">Preço por caixa ({totalPieces} pç)</p>
              <p className="text-lg font-bold text-gray-800">R$ {pricePerBox.toFixed(2)}</p>
            </div>
          )}
        </div>

        {/* Detalhes */}
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
          {p.observation && (
            <div className="flex justify-between">
              <span className="text-gray-500">Observação</span>
              <span className="font-medium text-orange-600 text-right max-w-[60%]">{p.observation}</span>
            </div>
          )}
        </div>

        {/* Grade */}
        {p.grade_configs && p.grade_configs.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Grade por caixa</p>
            <div className="space-y-2">
              {p.grade_configs.map((gc, i) => (
                <GradeRow key={i} gc={gc} boxCount={1} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function ProductCard({ p, onOpenDetail }: { p: Product; onOpenDetail: (p: Product) => void }) {
  const [expanded, setExpanded] = useState(false)
  const totalPieces = p.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex gap-3 p-3">
        {/* Imagem — clicável para abrir detalhe */}
        <button
          onClick={() => onOpenDetail(p)}
          className="w-16 h-16 bg-gray-100 rounded-lg flex-shrink-0 overflow-hidden hover:opacity-80 transition-opacity"
        >
          {p.image_url ? (
            <img src={p.image_url} alt={p.reference} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300">
              <ImageIcon className="h-7 w-7" />
            </div>
          )}
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5 flex-wrap">
            {/* Referência clicável */}
            <button
              onClick={() => onOpenDetail(p)}
              className="font-bold text-blue-700 text-sm hover:underline"
            >
              {p.reference}
            </button>
            <Badge variant={p.type === 'pack' ? 'purple' : 'info'} className="text-xs">
              {p.type === 'pack' ? 'PACK' : 'REG'}
            </Badge>
          </div>
          {p.product_name && (
            <p className="text-xs text-gray-600 font-medium truncate">{p.product_name}</p>
          )}
          {p.model && (
            <p className="text-xs text-gray-400 truncate">{p.model}</p>
          )}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <p className="text-sm font-bold text-blue-700">
              R$ {Number(p.base_price).toFixed(2)}
              <span className="text-xs text-gray-400 font-normal">/pç</span>
            </p>
            {totalPieces > 0 && (
              <span className="text-xs text-gray-400">{totalPieces} pç/cx</span>
            )}
            {p.size_range && (
              <span className="text-xs text-gray-400">Tam: {p.size_range}</span>
            )}
          </div>
          {(p.price_table_name || p.factory_name) && (
            <p className="text-xs text-gray-400 truncate mt-0.5">
              {[p.factory_name, p.price_table_name].filter(Boolean).join(' · ')}
            </p>
          )}
          {p.observation && (
            <p className="text-xs text-orange-500 truncate mt-0.5">{p.observation}</p>
          )}
        </div>

        {/* Toggle grade */}
        {p.grade_configs && p.grade_configs.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex-shrink-0 self-start mt-1 p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            title="Ver grade"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Grade expandida */}
      {expanded && p.grade_configs && p.grade_configs.length > 0 && (
        <div className="px-3 pb-3 border-t border-gray-100 pt-2 bg-gray-50/50 space-y-2">
          {p.grade_configs.map((gc, i) => (
            <GradeRow key={i} gc={gc} boxCount={1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function Products() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)

  // Debounce search
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

  const total = products?.length || 0

  return (
    <div className="px-4 py-5 lg:px-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Produtos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isLoading ? 'Carregando…' : `${total} produto${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-5">
        <div className="flex-1">
          <Input
            placeholder="Buscar por referência, nome ou modelo..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">Todos</option>
          <option value="regular">Regular</option>
          <option value="pack">Pack</option>
        </select>
      </div>

      {/* Lista */}
      {isLoading ? (
        <PageSpinner />
      ) : (
        <div className="space-y-2">
          {(products || []).map(p => (
            <ProductCard key={p.id} p={p} onOpenDetail={setDetailProduct} />
          ))}
          {!isLoading && (products || []).length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <ChevronDown className="h-8 w-8 text-gray-300" />
              </div>
              <p className="text-gray-500 font-medium">Nenhum produto encontrado</p>
              <p className="text-sm text-gray-400 mt-1">
                {debouncedSearch
                  ? `Nenhum resultado para "${debouncedSearch}"`
                  : 'Importe uma tabela de preços para começar'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Modal de detalhe do produto */}
      {detailProduct && (
        <ProductDetailModal p={detailProduct} onClose={() => setDetailProduct(null)} />
      )}
    </div>
  )
}
