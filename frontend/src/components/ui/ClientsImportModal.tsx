import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FileSpreadsheet, CheckCircle2, AlertTriangle,
  ArrowRight, Loader2, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react'
import { clientsApi } from '../../api/client'
import { Modal } from './Modal'
import { Button } from './Button'

interface Props {
  open: boolean
  onClose: () => void
}

// Campos do sistema e seus rótulos
const FIELDS: Array<{ key: string; label: string; required?: boolean; hint?: string }> = [
  { key: 'name',            label: 'Razão Social / Nome', required: true },
  { key: 'trade_name',      label: 'Nome Fantasia' },
  { key: 'cnpj',            label: 'CNPJ / CPF' },
  { key: 'phone',           label: 'Telefone' },
  { key: 'whatsapp',        label: 'WhatsApp' },
  { key: 'email',           label: 'E-mail' },
  { key: 'address',         label: 'Endereço (logradouro)' },
  { key: 'address_number',  label: 'Número', hint: 'Concatenado ao endereço' },
  { key: 'neighborhood',    label: 'Bairro',  hint: 'Concatenado ao endereço' },
  { key: 'city',            label: 'Cidade' },
  { key: 'state',           label: 'UF' },
  { key: 'zip',             label: 'CEP' },
  { key: 'notes',           label: 'Observações' },
]

interface PreviewData {
  headers: string[]
  mapping: Record<string, string>
  rows: Record<string, string>[]
  totalRows: number
  sampleRaw: string[][]
}

type Step = 'upload' | 'mapping' | 'result'

interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
  total: number
}

export function ClientsImportModal({ open, onClose }: Props) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [step, setStep] = useState<Step>('upload')
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ImportResult | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [dragging, setDragging] = useState(false)

  const previewMut = useMutation({
    mutationFn: (f: File) => clientsApi.importPreview(f),
    onSuccess: (res) => {
      const data = res.data as PreviewData
      setPreview(data)
      setMapping(data.mapping)
      setStep('mapping')
    },
  })

  const importMut = useMutation({
    mutationFn: () => clientsApi.importConfirm(file!, mapping),
    onSuccess: (res) => {
      setResult(res.data as ImportResult)
      setStep('result')
      qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })

  function handleFile(f: File) {
    setFile(f)
    previewMut.mutate(f)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  function handleClose() {
    setFile(null)
    setStep('upload')
    setPreview(null)
    setMapping({})
    setResult(null)
    setShowErrors(false)
    onClose()
  }

  const unmappedRequired = FIELDS.filter(f => f.required && !mapping[f.key])

  return (
    <Modal open={open} onClose={handleClose} title="Importar Clientes via Excel" size="lg">
      {/* ── Indicador de etapas ── */}
      <div className="flex items-center gap-2 mb-6">
        {(['upload', 'mapping', 'result'] as Step[]).map((s, i) => {
          const labels = ['Arquivo', 'Colunas', 'Resultado']
          const active = step === s
          const done = (step === 'mapping' && i === 0) || (step === 'result' && i < 2)
          return (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`flex items-center gap-1.5 text-xs font-semibold ${active ? 'text-primary' : done ? 'text-emerald-600' : 'text-outline/70'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${active ? 'bg-primary/10 text-primary ring-2 ring-blue-300' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-container text-outline/70'}`}>
                  {done ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                </div>
                {labels[i]}
              </div>
              {i < 2 && <div className={`flex-1 h-px ${done ? 'bg-emerald-300' : 'bg-surface-container-high'}`} />}
            </div>
          )
        })}
      </div>

      {/* ── STEP 1: Upload ── */}
      {step === 'upload' && (
        <div className="space-y-4">
          <p className="text-xs text-on-surface-variant">
            Exporte os clientes do seu sistema atual como Excel (.xlsx ou .xls) e faça o upload aqui.
            O sistema detecta as colunas automaticamente.
          </p>

          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${dragging ? 'border-blue-400 bg-primary/5' : 'border-outline-variant hover:border-blue-300 hover:bg-surface-container-low'}`}
          >
            {previewMut.isPending ? (
              <div className="flex flex-col items-center gap-3 text-primary">
                <Loader2 className="h-10 w-10 animate-spin" />
                <p className="text-xs font-medium">Lendo arquivo...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-outline">
                <FileSpreadsheet className="h-12 w-12 text-emerald-500" />
                <div>
                  <p className="font-semibold text-on-surface-variant">Arraste o arquivo aqui</p>
                  <p className="text-xs">ou clique para selecionar</p>
                </div>
                <p className="text-xs text-outline/70">Suporta .xlsx e .xls</p>
              </div>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />

          {previewMut.isError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {(previewMut.error as any)?.response?.data?.error || 'Erro ao ler o arquivo'}
            </p>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800 space-y-1">
            <p className="font-semibold">💡 Formatos suportados automaticamente:</p>
            <p>• Planilha padrão Somma (colunas: Cidade, Razão Social, Endereço, Número…)</p>
            <p>• Exportação do suasvendas.com: Clientes → Exportar → Excel</p>
            <p>• Qualquer .xlsx com colunas nomeadas em português ou inglês</p>
            <p className="text-amber-600">Endereço e Número em colunas separadas são combinados automaticamente.</p>
          </div>
        </div>
      )}

      {/* ── STEP 2: Mapeamento de colunas ── */}
      {step === 'mapping' && preview && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-on-surface">
                {preview.totalRows} clientes encontrados
              </p>
              <p className="text-xs text-outline">
                Arquivo: <strong>{file?.name}</strong> · {preview.headers.length} colunas detectadas
              </p>
            </div>
            <button
              onClick={() => { setStep('upload'); setFile(null) }}
              className="text-xs text-outline hover:text-on-surface-variant flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" /> Trocar arquivo
            </button>
          </div>

          {/* Preview tabela bruta */}
          {preview.sampleRaw.length > 0 && (
            <div className="border border-outline-variant rounded-lg overflow-auto max-h-36">
              <table className="min-w-max text-xs">
                <thead className="bg-surface-container-low sticky top-0">
                  <tr>
                    {preview.sampleRaw[0].map((h, i) => (
                      <th key={i} className="px-3 py-1.5 text-left font-semibold text-on-surface-variant border-b border-outline-variant whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRaw.slice(1, 4).map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-surface-container-low'}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-1 text-on-surface-variant whitespace-nowrap max-w-[150px] truncate">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Mapeamento de campos */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-outline uppercase tracking-wide">
              Confirme o mapeamento de colunas
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {FIELDS.map(f => (
                <div key={f.key} className="flex items-center gap-3">
                  <label className="w-44 flex-shrink-0">
                    <span className="text-xs text-on-surface-variant">
                      {f.label}
                      {f.required && <span className="text-red-500 ml-0.5">*</span>}
                    </span>
                    {f.hint && <span className="block text-[10px] text-outline/70 leading-tight">{f.hint}</span>}
                  </label>
                  <ArrowRight className="h-3.5 w-3.5 text-outline/50 flex-shrink-0" />
                  <select
                    value={mapping[f.key] || ''}
                    onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value }))}
                    className={`flex-1 text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                      f.required && !mapping[f.key]
                        ? 'border-red-300 bg-red-50'
                        : mapping[f.key] ? 'border-emerald-300 bg-emerald-50' : 'border-outline-variant'
                    }`}
                  >
                    <option value="">— não importar —</option>
                    {preview.headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {unmappedRequired.length > 0 && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Campo obrigatório sem coluna: {unmappedRequired.map(f => f.label).join(', ')}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setStep('upload')}>
              Voltar
            </Button>
            <Button
              className="flex-1"
              disabled={unmappedRequired.length > 0}
              loading={importMut.isPending}
              onClick={() => importMut.mutate()}
            >
              Importar {preview.totalRows} clientes
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Resultado ── */}
      {step === 'result' && result && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-700">{result.imported}</p>
              <p className="text-xs text-emerald-600 font-medium mt-0.5">Importados</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-700">{result.skipped}</p>
              <p className="text-xs text-amber-600 font-medium mt-0.5">Já existiam</p>
            </div>
            <div className={`border rounded-xl p-4 text-center ${result.errors.length ? 'bg-red-50 border-red-200' : 'bg-surface-container-low border-outline-variant'}`}>
              <p className={`text-2xl font-bold ${result.errors.length ? 'text-red-700' : 'text-outline/70'}`}>
                {result.errors.length}
              </p>
              <p className={`text-xs font-medium mt-0.5 ${result.errors.length ? 'text-red-600' : 'text-outline'}`}>Erros</p>
            </div>
          </div>

          {result.imported > 0 && (
            <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
              <p className="text-xs font-medium">
                {result.imported} cliente{result.imported !== 1 ? 's' : ''} importado{result.imported !== 1 ? 's' : ''} com sucesso!
              </p>
            </div>
          )}

          {result.skipped > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {result.skipped} cliente{result.skipped !== 1 ? 's' : ''} ignorado{result.skipped !== 1 ? 's' : ''} por já existirem no sistema (mesmo CNPJ).
            </p>
          )}

          {result.errors.length > 0 && (
            <div className="border border-red-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowErrors(e => !e)}
                className="w-full flex items-center justify-between px-3 py-2 bg-red-50 text-xs font-medium text-red-700"
              >
                <span>Ver {result.errors.length} erros</span>
                {showErrors ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showErrors && (
                <ul className="divide-y divide-red-100 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <li key={i} className="px-3 py-1.5 text-xs text-red-600">{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => { setStep('upload'); setFile(null); setResult(null) }}>
              Importar outro arquivo
            </Button>
            <Button className="flex-1" onClick={handleClose}>
              Concluir
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
