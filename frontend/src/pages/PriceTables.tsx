import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload,
  FileSpreadsheet,
  FileImage,
  Plus,
  Trash2,
  CheckCircle,
  ChevronRight,
  AlertCircle,
  Package,
} from 'lucide-react'
import { priceTablesApi, factoriesApi } from '../api/client'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { PageSpinner, Spinner } from '../components/ui/Spinner'
import { formatDate } from '../utils/format'

interface Factory { id: string; name: string }
interface PriceTable {
  id: string
  factory_id: string
  factory_name: string
  name: string
  collection: string | null
  season: string | null
  year: number | null
  product_count: number
  imported_at: string
  created_at: string
}
interface DiscountRule {
  discount_pct: number
  total_commission_pct: number
  rep_commission_pct: number
  office_commission_pct: number
}

const SEASONS = ['Verão', 'Inverno', 'Primavera/Verão', 'Outono/Inverno', 'Anual']

export function PriceTables() {
  const qc = useQueryClient()
  const [selectedFactory, setSelectedFactory] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [selectedTable, setSelectedTable] = useState<PriceTable | null>(null)
  const [deleteTable, setDeleteTable] = useState<PriceTable | null>(null)

  // Import Excel state
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<{
    tableName: string
    totalProducts: number
    regularCount: number
    packCount: number
    discountColumns: string[]
    sampleProducts: unknown[]
  } | null>(null)
  const [importForm, setImportForm] = useState({
    factory_id: '',
    name: '',
    collection: '',
    season: '',
    year: new Date().getFullYear().toString(),
  })
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>([
    { discount_pct: 0, total_commission_pct: 10, rep_commission_pct: 7, office_commission_pct: 3 },
  ])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  // Import catalog state
  const [catalogFile, setCatalogFile] = useState<File | null>(null)
  const [catalogResult, setCatalogResult] = useState<{
    totalPages: number
    pagesWithText: number
    foundInPdf: string[]      // refs extraídas do PDF
    foundInPdfCount: number
    matched: string[]
    matchedCount: number
    unmatchedCount: number
  } | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const catalogFileRef = useRef<HTMLInputElement>(null)

  const { data: factories } = useQuery<Factory[]>({
    queryKey: ['factories'],
    queryFn: () => factoriesApi.list().then((r) => r.data),
  })

  const { data: priceTables, isLoading } = useQuery<PriceTable[]>({
    queryKey: ['price-tables', selectedFactory],
    queryFn: () => priceTablesApi.list(selectedFactory || undefined).then((r) => r.data),
  })

  const importMut = useMutation({
    mutationFn: (args: { file: File; data: typeof importForm; rules: DiscountRule[] }) =>
      priceTablesApi.import(args.file, {
        ...args.data,
        year: args.data.year ? parseInt(args.data.year) : undefined,
        discount_rules: JSON.stringify(args.rules),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['price-tables'] })
      setImportOpen(false)
      resetImport()
    },
  })

  const catalogMut = useMutation({
    mutationFn: (args: { file: File; tableId: string }) =>
      priceTablesApi.importCatalog(args.file, args.tableId),
    onSuccess: (res) => setCatalogResult(res.data),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => priceTablesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['price-tables'] })
      setDeleteTable(null)
    },
  })

  const clearImagesMut = useMutation({
    mutationFn: (id: string) => priceTablesApi.clearProductImages(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['all-products'] }) },
  })

  function resetImport() {
    setImportStep(1)
    setImportFile(null)
    setPreview(null)
    setImportForm({ factory_id: '', name: '', collection: '', season: '', year: new Date().getFullYear().toString() })
    setDiscountRules([{ discount_pct: 0, total_commission_pct: 10, rep_commission_pct: 7, office_commission_pct: 3 }])
    setPreviewError('')
  }

  async function handleFileSelect(file: File) {
    setImportFile(file)
    setPreviewLoading(true)
    setPreviewError('')
    try {
      const res = await priceTablesApi.preview(file)
      setPreview(res.data)
      setImportForm((f) => ({ ...f, name: res.data.tableName || '' }))
      setImportStep(2)
    } catch {
      setPreviewError('Erro ao ler arquivo. Verifique se é um arquivo Excel válido.')
    } finally {
      setPreviewLoading(false)
    }
  }

  function addDiscountRule() {
    setDiscountRules([...discountRules, { discount_pct: 0, total_commission_pct: 0, rep_commission_pct: 0, office_commission_pct: 0 }])
  }

  function removeDiscountRule(i: number) {
    setDiscountRules(discountRules.filter((_, idx) => idx !== i))
  }

  function updateRule(i: number, field: keyof DiscountRule, value: string) {
    const updated = [...discountRules]
    updated[i] = { ...updated[i], [field]: parseFloat(value) || 0 }
    setDiscountRules(updated)
  }

  function handleImportConfirm() {
    if (!importFile || !importForm.factory_id || !importForm.name) return
    importMut.mutate({ file: importFile, data: importForm, rules: discountRules })
  }

  function openCatalogImport(table: PriceTable) {
    setSelectedTable(table)
    setCatalogFile(null)
    setCatalogResult(null)
    setCatalogOpen(true)
  }

  if (isLoading) return <PageSpinner />

  const tables = priceTables || []
  const factoryOptions = (factories || []).map((f) => ({ value: f.id, label: f.name }))

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-outline-variant px-5 py-2.5 lg:px-8">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-display text-sm font-bold text-on-surface">Tabelas de Preço</h1>
            <p className="text-[11px] text-outline mt-0.5">{tables.length} tabelas</p>
          </div>
          <Button onClick={() => { resetImport(); setImportOpen(true) }} icon={<Upload className="h-4 w-4" />} size="sm">
            Importar Excel
          </Button>
        </div>
      </div>

      <div className="px-4 py-5 lg:px-8 max-w-4xl mx-auto space-y-1.5">
        {/* Filter by factory */}
        <Select
          options={[{ value: '', label: 'Todas as fábricas' }, ...factoryOptions]}
          value={selectedFactory}
          onChange={(e) => setSelectedFactory(e.target.value)}
          label="Filtrar por fábrica"
        />

        {/* Tables list */}
        {tables.length === 0 ? (
          <Card>
            <div className="flex flex-col items-center py-8 text-center">
              <FileSpreadsheet className="h-10 w-10 text-outline/50 mb-3" />
              <p className="font-medium text-on-surface-variant">Nenhuma tabela de preço</p>
              <p className="text-[11px] text-outline/70 mt-1">Importe uma planilha Excel para começar</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {tables.map((t) => (
              <Card key={t.id} padding="md">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                      <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-on-surface">{t.name}</p>
                      <p className="text-[11px] text-outline">{t.factory_name}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {t.collection && <Badge variant="info">{t.collection}</Badge>}
                        {t.season && <Badge variant="default">{t.season}</Badge>}
                        {t.year && <Badge variant="default">{t.year}</Badge>}
                        <Badge variant="success">
                          <Package className="h-3 w-3" />
                          {t.product_count} produtos
                        </Badge>
                      </div>
                      <p className="text-[11px] text-outline/70 mt-1.5">Importado em {formatDate(t.imported_at || t.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button
                      onClick={() => openCatalogImport(t)}
                      className="flex items-center gap-1 text-[11px] text-primary hover:text-primary bg-primary/10 hover:bg-primary/10 px-2 py-1.5 rounded-lg transition-colors"
                    >
                      <FileImage className="h-3.5 w-3.5" />
                      Catálogo
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Limpar todas as fotos da tabela "${t.name}"?\nVocê precisará reimportar o catálogo PDF.`)) {
                          clearImagesMut.mutate(t.id)
                        }
                      }}
                      disabled={clearImagesMut.isPending}
                      className="flex items-center gap-1 text-[11px] text-orange-500 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <FileImage className="h-3.5 w-3.5" />
                      {clearImagesMut.isPending ? 'Limpando…' : 'Limpar Fotos'}
                    </button>
                    <button
                      onClick={() => setDeleteTable(t)}
                      className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1.5 rounded-lg transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Excluir
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Import Excel Modal */}
      <Modal
        open={importOpen}
        onClose={() => { setImportOpen(false); resetImport() }}
        title="Importar Tabela de Preços"
        size="lg"
        footer={
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className={`h-2 w-8 rounded-full transition-colors ${
                    importStep >= s ? 'bg-primary' : 'bg-surface-container-high'
                  }`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {importStep > 1 && (
                <Button variant="outline" onClick={() => setImportStep((s) => (s - 1) as 1 | 2 | 3)}>
                  Voltar
                </Button>
              )}
              {importStep === 2 && (
                <Button onClick={() => setImportStep(3)}>
                  Continuar <ChevronRight className="h-4 w-4" />
                </Button>
              )}
              {importStep === 3 && (
                <Button
                  onClick={handleImportConfirm}
                  loading={importMut.isPending}
                  icon={<CheckCircle className="h-4 w-4" />}
                >
                  Confirmar Importação
                </Button>
              )}
            </div>
          </div>
        }
      >
        {/* Step 1: Upload */}
        {importStep === 1 && (
          <div className="space-y-1">
            <p className="text-[11px] text-on-surface-variant">
              Selecione a planilha Excel (.xlsx) exportada da fábrica com os produtos e preços.
            </p>
            {previewError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-700">{previewError}</p>
              </div>
            )}
            <div
              className="border-2 border-dashed border-outline-variant rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-primary/10 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const file = e.dataTransfer.files[0]
                if (file) handleFileSelect(file)
              }}
            >
              {previewLoading ? (
                <Spinner label="Lendo planilha..." />
              ) : (
                <>
                  <FileSpreadsheet className="h-10 w-10 text-outline/70 mx-auto mb-3" />
                  <p className="text-[11px] font-medium text-on-surface-variant">Arraste o arquivo aqui ou clique para selecionar</p>
                  <p className="text-[11px] text-outline/70 mt-1">Suporta .xlsx e .xls</p>
                </>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFileSelect(file)
              }}
            />
          </div>
        )}

        {/* Step 2: Configure */}
        {importStep === 2 && preview && (
          <div className="space-y-1.5">
            {/* Preview summary */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold text-emerald-800 mb-2">Planilha lida com sucesso</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className="text-[11px] font-bold text-emerald-700">{preview.totalProducts}</p>
                  <p className="text-[11px] text-emerald-600">Total</p>
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-bold text-primary">{preview.regularCount}</p>
                  <p className="text-[11px] text-primary">Regular (TE)</p>
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-bold text-purple-700">{preview.packCount}</p>
                  <p className="text-[11px] text-purple-600">Pack (PKTE)</p>
                </div>
              </div>
            </div>

            <Select
              label="Fábrica *"
              options={factoryOptions}
              value={importForm.factory_id}
              onChange={(e) => setImportForm({ ...importForm, factory_id: e.target.value })}
              placeholder="Selecione a fábrica"
            />
            <Input
              label="Nome da Tabela *"
              value={importForm.name}
              onChange={(e) => setImportForm({ ...importForm, name: e.target.value })}
              placeholder="Ex: Verão 2025"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Coleção"
                value={importForm.collection}
                onChange={(e) => setImportForm({ ...importForm, collection: e.target.value })}
                placeholder="Ex: Nova Coleção"
              />
              <Select
                label="Estação"
                options={SEASONS.map((s) => ({ value: s, label: s }))}
                value={importForm.season}
                onChange={(e) => setImportForm({ ...importForm, season: e.target.value })}
                placeholder="Selecione"
              />
            </div>
            <Input
              label="Ano"
              type="number"
              value={importForm.year}
              onChange={(e) => setImportForm({ ...importForm, year: e.target.value })}
              placeholder="2025"
            />

            {/* Discount rules */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-medium text-on-surface-variant">Tabela Desconto × Comissão</p>
                <button
                  onClick={addDiscountRule}
                  className="text-[11px] text-primary flex items-center gap-1 hover:text-primary"
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar linha
                </button>
              </div>
              <div className="space-y-1">
                <div className="grid grid-cols-5 gap-1 text-[11px] font-medium text-outline px-1">
                  <span>Desc. %</span>
                  <span>Com. Total %</span>
                  <span>Com. Rep %</span>
                  <span>Com. Esc %</span>
                  <span></span>
                </div>
                {discountRules.map((rule, i) => (
                  <div key={i} className="grid grid-cols-5 gap-1">
                    {(['discount_pct', 'total_commission_pct', 'rep_commission_pct', 'office_commission_pct'] as const).map((field) => (
                      <input
                        key={field}
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={rule[field]}
                        onChange={(e) => updateRule(i, field, e.target.value)}
                        className="border border-outline-variant rounded-lg px-2 py-1.5 text-[11px] text-center focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    ))}
                    <button
                      onClick={() => removeDiscountRule(i)}
                      disabled={discountRules.length === 1}
                      className="flex items-center justify-center text-outline/50 hover:text-red-500 disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {importStep === 3 && preview && (
          <div className="space-y-1">
            <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 space-y-1">
              <p className="font-semibold text-blue-900">Resumo da Importação</p>
              <div className="text-[11px] text-blue-800 space-y-1">
                <p><span className="font-medium">Tabela:</span> {importForm.name}</p>
                <p><span className="font-medium">Fábrica:</span> {factories?.find((f) => f.id === importForm.factory_id)?.name}</p>
                {importForm.collection && <p><span className="font-medium">Coleção:</span> {importForm.collection}</p>}
                {importForm.season && <p><span className="font-medium">Estação:</span> {importForm.season} {importForm.year}</p>}
                <p><span className="font-medium">Produtos:</span> {preview.totalProducts} ({preview.regularCount} regular + {preview.packCount} pack)</p>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-medium text-on-surface-variant mb-2">Regras de comissão configuradas:</p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-[11px] border border-outline-variant rounded-lg overflow-hidden">
                  <thead className="bg-surface-container-low">
                    <tr>
                      <th className="px-3 py-1 text-left text-on-surface-variant">Desconto</th>
                      <th className="px-3 py-1 text-left text-on-surface-variant">Com. Total</th>
                      <th className="px-3 py-1 text-left text-on-surface-variant">Com. Rep</th>
                      <th className="px-3 py-1 text-left text-on-surface-variant">Com. Esc</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/50">
                    {discountRules.map((r, i) => (
                      <tr key={i} className="bg-white">
                        <td className="px-3 py-1">{r.discount_pct}%</td>
                        <td className="px-3 py-1">{r.total_commission_pct}%</td>
                        <td className="px-3 py-1">{r.rep_commission_pct}%</td>
                        <td className="px-3 py-1">{r.office_commission_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {importMut.isError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-[11px] text-red-700">Erro ao importar. Verifique os dados e tente novamente.</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteTable}
        onClose={() => setDeleteTable(null)}
        title="Excluir Tabela de Preços"
        size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setDeleteTable(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={deleteMut.isPending}
              onClick={() => deleteTable && deleteMut.mutate(deleteTable.id)}
              icon={<Trash2 className="h-4 w-4" />}
            >
              Excluir
            </Button>
          </div>
        }
      >
        <div className="space-y-1.5">
          <p className="text-[11px] text-on-surface-variant">
            Tem certeza que deseja excluir a tabela{' '}
            <span className="font-semibold">"{deleteTable?.name}"</span>?
          </p>
          <p className="text-[11px] text-outline">
            Os produtos e fotos desta tabela serão removidos. Os pedidos já realizados são mantidos no histórico com todos os valores intactos.
          </p>
        </div>
      </Modal>

      {/* Import Catalog PDF Modal */}
      <Modal
        open={catalogOpen}
        onClose={() => { setCatalogOpen(false); setCatalogResult(null) }}
        title="Importar Catálogo PDF"
        size="md"
        footer={
          !catalogResult ? (
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setCatalogOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => {
                  if (catalogFile && selectedTable) {
                    catalogMut.mutate({ file: catalogFile, tableId: selectedTable.id })
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
            <Button fullWidth onClick={() => { setCatalogOpen(false); setCatalogResult(null) }}>
              Fechar
            </Button>
          )
        }
      >
        {!catalogResult ? (
          <div className="space-y-1">
            {selectedTable && (
              <div className="bg-surface-container-low rounded-lg p-3">
                <p className="text-[11px] text-outline">Tabela de preços:</p>
                <p className="font-medium text-on-surface">{selectedTable.name}</p>
                <p className="text-[11px] text-outline">{selectedTable.product_count} produtos</p>
              </div>
            )}
            <p className="text-[11px] text-on-surface-variant">
              O sistema irá extrair as fotos do catálogo PDF e associar automaticamente às referências da tabela de preços.
            </p>
            <div
              className="border-2 border-dashed border-outline-variant rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-primary/10 transition-colors"
              onClick={() => catalogFileRef.current?.click()}
            >
              {catalogMut.isPending ? (
                <Spinner label="Processando PDF..." />
              ) : catalogFile ? (
                <div>
                  <FileImage className="h-8 w-8 text-primary/80 mx-auto mb-2" />
                  <p className="text-[11px] font-medium text-on-surface-variant">{catalogFile.name}</p>
                  <p className="text-[11px] text-outline/70">Clique para trocar</p>
                </div>
              ) : (
                <>
                  <FileImage className="h-10 w-10 text-outline/70 mx-auto mb-3" />
                  <p className="text-[11px] font-medium text-on-surface-variant">Selecione o catálogo PDF</p>
                  <p className="text-[11px] text-outline/70 mt-1">Arquivo .pdf</p>
                </>
              )}
            </div>
            <input
              ref={catalogFileRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => setCatalogFile(e.target.files?.[0] || null)}
            />
          </div>
        ) : (
          <div className="space-y-1 text-center py-2.5">
            {catalogResult.matchedCount > 0 ? (
              <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto" />
            ) : (
              <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
                <span className="text-amber-500 text-xl font-bold">!</span>
              </div>
            )}
            <p className="font-semibold text-on-surface">
              {catalogResult.matchedCount > 0 ? 'Catálogo Importado!' : 'Catálogo Processado'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-50 rounded-xl p-3">
                <p className="text-[11px] font-bold text-emerald-700">{catalogResult.matchedCount}</p>
                <p className="text-[11px] text-emerald-600">Fotos vinculadas</p>
              </div>
              <div className="bg-amber-50 rounded-xl p-3">
                <p className="text-[11px] font-bold text-amber-700">{catalogResult.unmatchedCount}</p>
                <p className="text-[11px] text-amber-600">Sem foto</p>
              </div>
            </div>
            <div className="text-[11px] text-outline/70 space-y-1">
              <p>{catalogResult.totalPages} páginas · {catalogResult.pagesWithText} com texto · {catalogResult.foundInPdfCount} refs no PDF</p>
              {catalogResult.matchedCount === 0 && catalogResult.pagesWithText === 0 && (
                <p className="text-amber-500 font-medium">PDF escaneado — sem texto extraível. Use um PDF com texto pesquisável.</p>
              )}
              {catalogResult.matchedCount === 0 && catalogResult.foundInPdfCount > 0 && (
                <div className="text-left mt-2">
                  <p className="text-amber-500 font-semibold mb-1">{catalogResult.foundInPdfCount} refs encontradas no PDF mas nenhuma bate com esta tabela.</p>
                  <p className="text-outline mb-1">Refs extraídas do PDF (compare com os códigos da tabela):</p>
                  <div className="bg-surface-container-low rounded-lg p-2 font-mono text-on-surface-variant text-[11px] leading-5 break-all">
                    {catalogResult.foundInPdf.join(' · ')}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
