import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Image as ImageIcon, ChevronDown } from 'lucide-react'
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
        {p.image_url ? (
          <div className="w-full aspect-square max-h-64 overflow-hidden rounded-xl bg-gray-100">
            <img src={p.image_url} alt={p.reference} className="w-full h-full object-contain" />
          </div>
        ) : (
          <div className="w-full h-40 bg-gray-100 rounded-xl flex items-center justify-center text-gray-300">
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
          <div className="bg-indigo-50 rounded-xl p-3 text-center">
            <p className="text-xs text-indigo-400 mb-0.5">Preço por peça</p>
            <p className="text-lg font-bold text-indigo-600">R$ {Number(p.base_price).toFixed(2)}</p>
          </div>
          {totalPieces > 0 && (
            <div className="bg-gray-50 rounded-xl p-3 text-center">
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
          {p.observation && (
            <div className="flex justify-between">
              <span className="text-gray-500">Observação</span>
              <span className="font-medium text-orange-600 text-right max-w-[60%]">{p.observation}</span>
            </div>
          )}
        </div>

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

// ─── Table Row ───────────────────────────────────────────────────────────────
function ProductRow({ p, onOpenDetail }: { p: Product; onOpenDetail: (p: Product) => void }) {
  const totalPieces = p.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 0

  return (
    <tr
      className="border-b border-gray-100 hover:bg-indigo-50/40 cursor-pointer transition-colors"
      onClick={() => onOpenDetail(p)}
    >
      {/* Foto */}
      <td className="pl-3 pr-2 py-2">
        <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
          {p.image_url ? (
            <img src={p.image_url} alt={p.reference} className="w-full h-full object-cover" />
          ) : (
            <ImageIcon className="h-4 w-4 text-gray-300" />
          )}
        </div>
      </td>

      {/* Referência */}
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-indigo-600 text-sm whitespace-nowrap">{p.reference}</span>
          <Badge variant={p.type === 'pack' ? 'purple' : 'info'} className="text-[10px] px-1.5 py-0">
            {p.type === 'pack' ? 'PK' : 'REG'}
          </Badge>
        </div>
      </td>

      {/* Nome */}
      <td className="px-2 py-2 max-w-[180px]">
        <p className="text-sm font-medium text-gray-800 truncate">{p.product_name || '—'}</p>
        {p.model && <p className="text-xs text-gray-400 truncate">{p.model}</p>}
      </td>

      {/* Tamanhos */}
      <td className="px-2 py-2 whitespace-nowrap">
        <span className="text-xs text-gray-600">{p.size_range || '—'}</span>
      </td>

      {/* Preço */}
      <td className="px-2 py-2 whitespace-nowrap text-right">
        <span className="text-sm font-bold text-indigo-600">R$ {Number(p.base_price).toFixed(2)}</span>
        <span className="text-xs text-gray-400 ml-0.5">/pç</span>
      </td>

      {/* Pç/cx */}
      <td className="px-2 py-2 whitespace-nowrap text-center">
        <span className="text-xs text-gray-500">{totalPieces > 0 ? `${totalPieces} pç` : '—'}</span>
      </td>

      {/* Fábrica */}
      <td className="px-2 py-2 max-w-[120px]">
        <span className="text-xs text-gray-600 truncate block">{p.factory_name || '—'}</span>
      </td>

      {/* Tabela */}
      <td className="px-2 pr-3 py-2 max-w-[150px]">
        <span className="text-xs text-gray-500 truncate block">{p.price_table_name || '—'}</span>
        {p.observation && (
          <span className="text-[10px] text-orange-500 truncate block">{p.observation}</span>
        )}
      </td>
    </tr>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export function Products() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 lg:px-6 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Produtos</h1>
            <p className="text-xs text-gray-500">
              {isLoading ? 'Carregando…' : `${total} produto${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''}`}
            </p>
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
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
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
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full min-w-[700px] text-left">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="pl-3 pr-2 py-2.5 text-xs font-semibold text-gray-500 w-14">Foto</th>
                <th className="px-2 py-2.5 text-xs font-semibold text-gray-500">Referência</th>
                <th className="px-2 py-2.5 text-xs font-semibold text-gray-500">Nome / Modelo</th>
                <th className="px-2 py-2.5 text-xs font-semibold text-gray-500">Tamanhos</th>
                <th className="px-2 py-2.5 text-xs font-semibold text-gray-500 text-right">Preço</th>
                <th className="px-2 py-2.5 text-xs font-semibold text-gray-500 text-center">Pç/cx</th>
                <th className="px-2 py-2.5 text-xs font-semibold text-gray-500">Fábrica</th>
                <th className="px-2 pr-3 py-2.5 text-xs font-semibold text-gray-500">Tabela</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-50">
              {(products || []).map(p => (
                <ProductRow key={p.id} p={p} onOpenDetail={setDetailProduct} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {detailProduct && (
        <ProductDetailModal p={detailProduct} onClose={() => setDetailProduct(null)} />
      )}
    </div>
  )
}
