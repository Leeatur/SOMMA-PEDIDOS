import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { priceTablesApi } from '../../api/client'
import { Modal } from './Modal'
import { Button } from './Button'

interface PriceTable {
  id: string
  name: string
  factory_name: string
  product_count: number
}

interface ZipResult {
  total: number
  matched: number
  skipped: number
  notInTable: string[]
  notInTableCount: number
  errors?: string[]
}

interface Props {
  open: boolean
  onClose: () => void
  onDone?: () => void
}

export function PhotosZipImportModal({ open, onClose, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [priceTableId, setPriceTableId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<ZipResult | null>(null)
  const [error, setError] = useState('')

  const { data: tables } = useQuery<PriceTable[]>({
    queryKey: ['price-tables'],
    queryFn: () => priceTablesApi.list().then(r => r.data),
    enabled: open,
  })

  function reset() {
    setFile(null)
    setPriceTableId('')
    setOverwrite(false)
    setProgress(0)
    setResult(null)
    setError('')
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleClose() {
    if (uploading) return
    reset()
    onClose()
  }

  async function handleSubmit() {
    if (!file || !priceTableId) return
    setUploading(true)
    setProgress(0)
    setResult(null)
    setError('')
    try {
      const res = await priceTablesApi.importPhotosZip(file, priceTableId, overwrite, (pct) => {
        // pct = upload progress (0-100); processing happens after upload
        setProgress(Math.min(pct, 99))
      })
      setProgress(100)
      setResult(res.data as ZipResult)
      onDone?.()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || 'Erro ao processar o arquivo. Tente novamente.'
      setError(msg)
    } finally {
      setUploading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Importar Fotos via ZIP"
      size="md"
      footer={
        result ? (
          <div className="flex justify-end">
            <Button onClick={handleClose}>Fechar</Button>
          </div>
        ) : (
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleClose} disabled={uploading}>Cancelar</Button>
            <Button
              onClick={handleSubmit}
              disabled={!file || !priceTableId || uploading}
              loading={uploading}
            >
              {uploading ? `Enviando ${progress}%` : 'Importar Fotos'}
            </Button>
          </div>
        )
      }
    >
      {result ? (
        /* ── Resultado ── */
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="font-semibold text-gray-900">Importação concluída!</p>
              <p className="text-sm text-gray-500">{result.total} foto{result.total !== 1 ? 's' : ''} encontrada{result.total !== 1 ? 's' : ''} no ZIP</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-emerald-600">{result.matched}</p>
              <p className="text-xs text-emerald-700">Fotos vinculadas</p>
            </div>
            <div className={`rounded-xl p-3 text-center ${result.notInTableCount > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
              <p className={`text-2xl font-bold ${result.notInTableCount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                {result.notInTableCount}
              </p>
              <p className={`text-xs ${result.notInTableCount > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
                Refs não encontradas
              </p>
            </div>
          </div>

          {result.skipped > 0 && (
            <p className="text-xs text-gray-400 text-center">
              {result.skipped} foto{result.skipped !== 1 ? 's' : ''} ignorada{result.skipped !== 1 ? 's' : ''} (já tinha foto e "sobreescrever" estava desativado)
            </p>
          )}

          {result.notInTable.length > 0 && (
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-700 mb-1">Refs do ZIP não encontradas na tabela:</p>
              <p className="text-xs text-amber-600 font-mono">{result.notInTable.join(', ')}</p>
            </div>
          )}
        </div>
      ) : (
        /* ── Formulário ── */
        <div className="space-y-4">
          <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700">
            <p className="font-semibold mb-1">Como funciona:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-xs">
              <li>Abra a pasta de fotos no Google Drive</li>
              <li>Clique em "Baixar tudo" → o Drive gera um <strong>.zip</strong></li>
              <li>Selecione a tabela de preços correspondente</li>
              <li>Faça upload do .zip aqui</li>
            </ol>
            <p className="text-xs mt-1.5 text-blue-600">
              As fotos são identificadas pela referência no nome do arquivo<br/>
              (ex: <code>001 TE10308-791.jpg</code> → vincula a <strong>TE10308</strong>)
            </p>
          </div>

          {/* Tabela de preços */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tabela de Preços *
            </label>
            <select
              value={priceTableId}
              onChange={e => setPriceTableId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">Selecione a tabela...</option>
              {(tables || []).map(t => (
                <option key={t.id} value={t.id}>
                  {t.factory_name} — {t.name} ({t.product_count} produtos)
                </option>
              ))}
            </select>
          </div>

          {/* Arquivo ZIP */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Arquivo ZIP *
            </label>
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-indigo-600">
                  <Archive className="h-5 w-5" />
                  <span className="text-sm font-medium">{file.name}</span>
                  <span className="text-xs text-gray-400">({(file.size / 1024 / 1024).toFixed(0)} MB)</span>
                </div>
              ) : (
                <div className="text-gray-400">
                  <Upload className="h-8 w-8 mx-auto mb-2" />
                  <p className="text-sm">Clique para selecionar o arquivo .zip</p>
                  <p className="text-xs mt-0.5">Suporta até 2 GB</p>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] || null)}
            />
          </div>

          {/* Sobreescrever */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={e => setOverwrite(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-700">Sobreescrever fotos já existentes</span>
          </label>

          {/* Progresso */}
          {uploading && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-indigo-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{progress < 100 ? `Enviando arquivo… ${progress}%` : 'Processando fotos…'}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="bg-indigo-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 rounded-xl p-3 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
