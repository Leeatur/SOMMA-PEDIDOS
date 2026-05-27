import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search,
  Camera,
  Package,
  Image as ImageIcon,
  Filter,
  ChevronDown,
  ChevronUp,
  Edit2,
  Plus,
  Trash2,
  Check,
  FileImage,
  Upload,
} from 'lucide-react'
import { productsApi, priceTablesApi, factoriesApi } from '../api/client'
import { Input, Select } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Badge } from '../components/ui/Badge'
import { PageSpinner, Spinner } from '../components/ui/Spinner'
import { EmptyState } from '../components/ui/EmptyState'

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
  image_url: string | null
  grade_configs: GradeConfig[] | null
}

interface PriceTable { id: string; name: string; factory_name: string }
interface Factory { id: string; name: string }

function GradeTable({ configs }: { configs: GradeConfig[] }) {
  return (
    <div className="space-y-2">
      {configs.map((gc, i) => {
        const sizes = Object.keys(gc.sizes).sort()
        return (
          <div key={i}>
            {gc.color && <p className="text-xs font-medium text-gray-600 mb-1">{gc.color}</p>}
            <div className="overflow-x-auto">
              <table className="min-w-max text-xs border border-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-50">
                  <tr>
                    {sizes.map((s) => (
                      <th key={s} className="px-2 py-1 text-gray-600 font-medium text-center min-w-[32px]">{s}</th>
                    ))}
                    <th className="px-2 py-1 text-gray-500 font-medium text-center border-l border-gray-200">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-white">
                    {sizes.map((s) => (
                      <td key={s} className="px-2 py-1.5 text-center font-mono">{gc.sizes[s]}</td>
                    ))}
                    <td className="px-2 py-1.5 text-center font-bold border-l border-gray-200">{gc.total_pieces}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function GradeEditor({
  configs,
  onChange,
}: {
  configs: GradeConfig[]
  onChange: (configs: GradeConfig[]) => void
}) {
  function updateColor(i: number, color: string) {
    const updated = [...configs]
    updated[i] = { ...updated[i], color }
    onChange(updated)
  }

  function updateSize(i: number, size: string, qty: string) {
    const updated = [...configs]
    const newSizes = { ...updated[i].sizes, [size]: parseInt(qty) || 0 }
    const total = Object.values(newSizes).reduce((a, b) => a + b, 0)
    updated[i] = { ...updated[i], sizes: newSizes, total_pieces: total }
    onChange(updated)
  }

  function addColor() {
    const newConfig: GradeConfig = {
      id: `new-${Date.now()}`,
      color: 'Nova cor',
      sizes: configs[0]?.sizes
        ? Object.fromEntries(Object.keys(configs[0].sizes).map((k) => [k, 1]))
        : { '36': 1, '38': 1, '40': 1, '42': 1 },
      total_pieces: Object.keys(configs[0]?.sizes || {}).length,
      sort_order: configs.length,
    }
    onChange([...configs, newConfig])
  }

  function removeColor(i: number) {
    onChange(configs.filter((_, idx) => idx !== i))
  }

  return (
    <div className="space-y-4">
      {configs.map((gc, i) => {
        const sizes = Object.keys(gc.sizes).sort()
        return (
          <div key={i} className="border border-gray-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-3">
              <input
                type="text"
                value={gc.color || ''}
                onChange={(e) => updateColor(i, e.target.value)}
                placeholder="Cor (opcional)"
                className="text-sm font-medium border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {configs.length > 1 && (
                <button onClick={() => removeColor(i)} className="text-red-400 hover:text-red-600 p-1">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-max text-xs">
                <thead>
                  <tr>
                    {sizes.map((s) => (
                      <th key={s} className="px-2 py-1 text-gray-500 font-medium text-center">{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {sizes.map((s) => (
                      <td key={s} className="px-1">
                        <input
                          type="number"
                          min="0"
                          value={gc.sizes[s] || 0}
                          onChange={(e) => updateSize(i, s, e.target.value)}
                          className="w-10 text-center border border-gray-200 rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-2">Total: {gc.total_pieces} peças</p>
          </div>
        )
      })}
      <button
        onClick={addColor}
        className="flex items-center gap-1.5 text-sm text-indigo-500 hover:text-indigo-600"
      >
        <Plus className="h-4 w-4" /> Adicionar cor
      </button>
    </div>
  )
}

export function Catalog() {
  const qc = useQueryClient()
  const [selectedFactory, setSelectedFactory] = useState('')
  const [selectedTable, setSelectedTable] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const [gradeModal, setGradeModal] = useState<Product | null>(null)
  const [editedGrade, setEditedGrade] = useState<GradeConfig[]>([])
  const [imageModal, setImageModal] = useState<Product | null>(null)
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)

  // Catalog PDF import
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogFile, setCatalogFile] = useState<File | null>(null)
  const [catalogOverwrite, setCatalogOverwrite] = useState(false)
  const [catalogResult, setCatalogResult] = useState<{
    totalPages: number; matched: number; unmatchedCount: number; unmatched: string[]
  } | null>(null)
  const catalogFileRef = useRef<HTMLInputElement>(null)

  const catalogMut = useMutation({
    mutationFn: (args: { file: File; tableId: string; overwrite: boolean }) =>
      priceTablesApi.importCatalog(args.file, args.tableId, args.overwrite),
    onSuccess: (res) => {
      setCatalogResult(res.data)
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })

  const imageFileRef = useRef<HTMLInputElement>(null)

  const { data: factories } = useQuery<Factory[]>({
    queryKey: ['factories'],
    queryFn: () => factoriesApi.list().then((r) => r.data),
  })

  const { data: priceTables } = useQuery<PriceTable[]>({
    queryKey: ['price-tables', selectedFactory],
    queryFn: () => priceTablesApi.list(selectedFactory || undefined).then((r) => r.data),
    enabled: true,
  })

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ['products', selectedTable, search, typeFilter],
    queryFn: () =>
      productsApi.list({
        price_table_id: selectedTable || undefined,
        search: search || undefined,
        type: typeFilter || undefined,
      }).then((r) => r.data),
    enabled: !!selectedTable,
  })

  const uploadImageMut = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => productsApi.uploadImage(id, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      setImageModal(null)
    },
  })

  const saveGradeMut = useMutation({
    mutationFn: ({ id, configs }: { id: string; configs: GradeConfig[] }) =>
      productsApi.updateGrade(id, configs),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      setGradeModal(null)
    },
  })

  function openGradeEdit(p: Product) {
    setGradeModal(p)
    setEditedGrade(p.grade_configs ? [...p.grade_configs] : [])
  }

  const factoryOptions = (factories || []).map((f) => ({ value: f.id, label: f.name }))
  const tableOptions = (priceTables || []).map((t) => ({
    value: t.id,
    label: `${t.name} — ${t.factory_name}`,
  }))

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-5 py-4 lg:px-8 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Catálogo de Produtos</h1>
            <div className="flex items-center gap-2">
              {selectedTable && (
                <Button
                  size="sm"
                  variant="outline"
                  icon={<FileImage className="h-4 w-4" />}
                  onClick={() => { setCatalogFile(null); setCatalogResult(null); setCatalogOpen(true) }}
                >
                  Importar Catálogo PDF
                </Button>
              )}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
              >
                <Filter className="h-4 w-4" />
                Filtros
                {showFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <Input
            placeholder="Buscar referência, nome ou modelo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />
          {showFilters && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Select
                options={factoryOptions}
                value={selectedFactory}
                onChange={(e) => { setSelectedFactory(e.target.value); setSelectedTable('') }}
                placeholder="Todas as fábricas"
                label="Fábrica"
              />
              <Select
                options={tableOptions}
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
                placeholder="Selecione uma tabela"
                label="Tabela"
              />
              <Select
                options={[
                  { value: 'regular', label: 'Regular (TE)' },
                  { value: 'pack', label: 'Pack (PKTE)' },
                ]}
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                placeholder="Todos os tipos"
                label="Tipo"
              />
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-5 lg:px-8 max-w-5xl mx-auto">
        {!selectedTable ? (
          <EmptyState
            icon={<Package className="h-8 w-8" />}
            title="Selecione uma tabela de preços"
            description="Escolha uma tabela de preços nos filtros acima para ver os produtos."
          />
        ) : isLoading ? (
          <PageSpinner />
        ) : !products?.length ? (
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="Nenhum produto encontrado"
            description="Tente ajustar os filtros de busca."
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {products.map((p) => {
              const totalPieces = p.grade_configs?.reduce((s, g) => s + g.total_pieces, 0) || 0
              const isExpanded = expandedProduct === p.id
              return (
                <div key={p.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  {/* Product image */}
                  <div className="relative aspect-square bg-gray-100">
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.reference}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-gray-300">
                        <ImageIcon className="h-8 w-8" />
                        <span className="text-xs mt-1">Sem foto</span>
                      </div>
                    )}
                    {/* Type badge */}
                    <div className="absolute top-1.5 left-1.5">
                      <Badge variant={p.type === 'pack' ? 'purple' : 'info'}>
                        {p.type === 'pack' ? 'PACK' : 'REG'}
                      </Badge>
                    </div>
                    {/* Upload photo button */}
                    <button
                      onClick={() => { setImageModal(p); imageFileRef.current?.click() }}
                      className="absolute bottom-1.5 right-1.5 p-1.5 bg-white/90 backdrop-blur rounded-lg shadow text-gray-600 hover:text-indigo-500"
                    >
                      <Camera className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Product info */}
                  <div className="p-2.5">
                    <p className="text-xs font-bold text-gray-900 truncate">{p.reference}</p>
                    {p.product_name && (
                      <p className="text-xs text-gray-500 truncate">{p.product_name}</p>
                    )}
                    <p className="text-sm font-semibold text-indigo-600 mt-1">
                      R$ {Number(p.base_price).toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-400">{totalPieces} pç/cx</p>

                    {/* Actions */}
                    <div className="flex gap-1 mt-2">
                      <button
                        onClick={() => setExpandedProduct(isExpanded ? null : p.id)}
                        className="flex-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg py-1 flex items-center justify-center gap-1"
                      >
                        Grade
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={() => openGradeEdit(p)}
                        className="p-1 border border-gray-200 rounded-lg text-gray-400 hover:text-indigo-500 hover:border-blue-300"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Grade expand */}
                    {isExpanded && p.grade_configs && (
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <GradeTable configs={p.grade_configs} />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Hidden file input for image upload */}
      <input
        ref={imageFileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file && imageModal) {
            uploadImageMut.mutate({ id: imageModal.id, file })
          }
          e.target.value = ''
        }}
      />

      {/* Import Catalog PDF Modal */}
      <Modal
        open={catalogOpen}
        onClose={() => { setCatalogOpen(false); setCatalogFile(null); setCatalogResult(null) }}
        title="Importar Catálogo PDF"
        size="md"
        footer={
          !catalogResult ? (
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setCatalogOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => {
                  if (catalogFile && selectedTable) {
                    catalogMut.mutate({ file: catalogFile, tableId: selectedTable, overwrite: catalogOverwrite })
                  }
                }}
                loading={catalogMut.isPending}
                disabled={!catalogFile}
                icon={<Upload className="h-4 w-4" />}
              >
                Importar
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => { setCatalogFile(null); setCatalogResult(null); setCatalogOverwrite(false) }}
                icon={<FileImage className="h-4 w-4" />}
              >
                Importar outro catálogo
              </Button>
              <Button onClick={() => { setCatalogOpen(false); setCatalogFile(null); setCatalogResult(null) }}>
                Fechar
              </Button>
            </div>
          )
        }
      >
        {!catalogResult ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Selecione um PDF de catálogo. O sistema irá extrair as fotos e associar automaticamente
              às referências da tabela de preços selecionada.
            </p>
            <p className="text-xs text-indigo-600 bg-indigo-50 border border-blue-100 rounded-lg px-3 py-2">
              💡 Você pode importar múltiplos catálogos para a mesma tabela — cada um completa as fotos restantes.
            </p>
            <div
              onClick={() => catalogFileRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-indigo-50 transition-colors"
            >
              {catalogMut.isPending ? (
                <Spinner label="Processando PDF..." />
              ) : catalogFile ? (
                <div>
                  <FileImage className="h-10 w-10 text-indigo-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-900">{catalogFile.name}</p>
                  <p className="text-xs text-gray-400 mt-1">{(catalogFile.size / 1024 / 1024).toFixed(1)} MB — clique para trocar</p>
                </div>
              ) : (
                <div>
                  <FileImage className="h-10 w-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Clique para selecionar o PDF do catálogo</p>
                </div>
              )}
            </div>
            <input
              ref={catalogFileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => { setCatalogFile(e.target.files?.[0] || null); e.target.value = '' }}
            />
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={catalogOverwrite}
                onChange={(e) => setCatalogOverwrite(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-indigo-500"
              />
              <span className="text-sm text-gray-600">
                Substituir fotos já existentes
              </span>
            </label>
            {catalogMut.isError && (
              <p className="text-sm text-red-600">Erro ao processar o catálogo. Tente novamente.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{catalogResult.totalPages}</p>
                <p className="text-xs text-gray-500 mt-0.5">páginas</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{catalogResult.matched}</p>
                <p className="text-xs text-green-600 mt-0.5">fotos vinculadas</p>
              </div>
              <div className="bg-orange-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-orange-600">{catalogResult.unmatchedCount}</p>
                <p className="text-xs text-orange-500 mt-0.5">não encontradas</p>
              </div>
            </div>
            {catalogResult.unmatched.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Referências não encontradas na tabela:</p>
                <p className="text-xs text-gray-400 font-mono leading-relaxed">
                  {catalogResult.unmatched.join(', ')}
                </p>
              </div>
            )}
            <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              ✅ Catálogo importado! Você pode importar mais catálogos para completar as fotos restantes.
            </p>
          </div>
        )}
      </Modal>

      {/* Grade Edit Modal */}
      <Modal
        open={!!gradeModal}
        onClose={() => setGradeModal(null)}
        title={`Editar Grade — ${gradeModal?.reference}`}
        size="lg"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setGradeModal(null)}>Cancelar</Button>
            <Button
              loading={saveGradeMut.isPending}
              onClick={() => gradeModal && saveGradeMut.mutate({ id: gradeModal.id, configs: editedGrade })}
              icon={<Check className="h-4 w-4" />}
            >
              Salvar Grade
            </Button>
          </div>
        }
      >
        {gradeModal && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Badge variant={gradeModal.type === 'pack' ? 'purple' : 'info'}>
                {gradeModal.type === 'pack' ? 'Pack' : 'Regular'}
              </Badge>
              {gradeModal.product_name && <span>{gradeModal.product_name}</span>}
            </div>
            <GradeEditor configs={editedGrade} onChange={setEditedGrade} />
          </div>
        )}
      </Modal>
    </div>
  )
}
