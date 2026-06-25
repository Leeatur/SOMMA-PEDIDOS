import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import JSZip from 'jszip'
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
  notFound: number
  errors: string[]
}

interface Props {
  open: boolean
  onClose: () => void
  onDone?: () => void
}
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp'])

/**
 * Redimensiona e comprime uma imagem no browser usando Canvas.
 * Converte um JPEG de 25-44 MB para ~300 KB antes de enviar ao servidor.
 * Preserva a proporção; max 1400px no lado maior.
 */
async function compressImage(blob: Blob, maxPx = 1400, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.round(img.naturalWidth * scale)
      const h = Math.round(img.naturalHeight * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')) }
    img.src = url
  })
}

/** Limita quantas uploads rodam em paralelo */
async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  onDone?: () => void,
): Promise<T[]> {
  const results: T[] = []
  let i = 0
  async function run(): Promise<void> {
    while (i < tasks.length) {
      const idx = i++
      results[idx] = await tasks[idx]()
      onDone?.()
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run))
  return results
}

export function PhotosZipImportModal({ open, onClose, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [priceTableId, setPriceTableId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [galleryMode, setGalleryMode] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'reading' | 'uploading'>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
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
    setGalleryMode(false)
    setProcessing(false)
    setPhase('idle')
    setProgress({ done: 0, total: 0 })
    setResult(null)
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleClose() {
    if (processing) return
    reset()
    onClose()
  }

  async function handleSubmit() {
    if (!file || !priceTableId) return
    setProcessing(true)
    setError('')
    setResult(null)

    try {
      // 1. Lê o ZIP no browser (sem enviar para o servidor)
      setPhase('reading')
      const zip = await JSZip.loadAsync(file)

      // 2. Coleta imagens; referência = trecho antes do 1º "-", espaço ou "(".
      //    Ex.: "H90-CINZA (7).jpg" → H90 | "FC558 PRETO.jpg" → FC558 | "5315.jpg" → 5315
      //    Mantém 1 foto por referência: prefere a sem número ou a de menor índice "(n)".
      // Modo capa (padrão): 1 foto por referência (dedup pela menor "(n)").
      // Modo galeria: TODAS as fotos de cada referência (várias por produto).
      const best = new Map<string, { n: number; zipFile: JSZip.JSZipObject }>()
      const all: Array<{ ref: string; n: number; zipFile: JSZip.JSZipObject }> = []
      zip.forEach((relativePath, zipFile) => {
        if (zipFile.dir) return
        const base = relativePath.split('/').pop() || ''
        const ext = base.split('.').pop()?.toLowerCase() || ''
        if (!IMAGE_EXTS.has(ext)) return
        const noExt = base.replace(/\.[^.]+$/, '')
        const head = noExt.split(/[-–(\s]/)[0].trim().toUpperCase()
        if (!head || !/\d/.test(head) || head.length > 14) return  // precisa ter dígito (é código)
        const nm = noExt.match(/\((\d+)\)/)
        const n = nm ? parseInt(nm[1], 10) : 0   // sem número = 0 (prioridade)
        const cur = best.get(head)
        if (!cur || n < cur.n) best.set(head, { n, zipFile })
        all.push({ ref: head, n, zipFile })
      })
      const images: Array<{ ref: string; zipFile: JSZip.JSZipObject }> = galleryMode
        ? all.sort((a, b) => a.ref.localeCompare(b.ref) || a.n - b.n).map(({ ref, zipFile }) => ({ ref, zipFile }))
        : [...best.entries()].map(([ref, { zipFile }]) => ({ ref, zipFile }))

      if (images.length === 0) {
        setError('Nenhuma imagem com referência válida encontrada no ZIP. Os nomes precisam começar com o código (ex: H90-CINZA.jpg, FC558.jpg, 5315 (1).jpg).')
        setProcessing(false)
        setPhase('idle')
        return
      }

      // 3. Faz upload de cada imagem individualmente (concorrência 2)
      // Processa sequencialmente para não explodir a memória com ZIPs grandes
      setPhase('uploading')
      setProgress({ done: 0, total: images.length })

      let matched = 0
      let skipped = 0
      let notFound = 0
      const errors: string[] = []

      const tasks = images.map(({ ref, zipFile }) => async () => {
        try {
          const rawBlob = await zipFile.async('blob')
          // Comprime no browser antes de enviar (25-44 MB → ~300 KB)
          const compressed = await compressImage(rawBlob)
          const res = galleryMode
            ? await priceTablesApi.galleryByRef(priceTableId, ref, compressed)
            : await priceTablesApi.uploadPhotoByRef(priceTableId, ref, compressed, overwrite)
          const data = res.data as { matched?: boolean; skipped?: boolean; reason?: string }
          if (data.matched) matched++
          else if (data.skipped && data.reason === 'not_found') notFound++
          else skipped++
        } catch {
          errors.push(ref)
        }
        setProgress(p => ({ ...p, done: p.done + 1 }))
      })

      // Concorrência 2 — ZIPs com fotos grandes precisam de menos paralelo
      await pLimit(tasks, 2)

      setResult({ total: images.length, matched, skipped, notFound, errors })
      onDone?.()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao processar o arquivo ZIP.'
      setError(msg)
    } finally {
      setProcessing(false)
      setPhase('idle')
    }
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

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
            <Button variant="outline" onClick={handleClose} disabled={processing}>Cancelar</Button>
            <Button
              onClick={handleSubmit}
              disabled={!file || !priceTableId || processing}
              loading={processing}
            >
              {processing
                ? phase === 'reading'
                  ? 'Lendo ZIP…'
                  : `Enviando ${progress.done}/${progress.total}`
                : 'Importar Fotos'}
            </Button>
          </div>
        )
      }
    >
      {result ? (
        /* ── Resultado ── */
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="font-semibold text-on-surface">Importação concluída!</p>
              <p className="text-[12px] text-outline">
                {result.total} foto{result.total !== 1 ? 's' : ''} encontrada{result.total !== 1 ? 's' : ''} no ZIP
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-emerald-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-emerald-600">{result.matched}</p>
              <p className="text-[12px] text-emerald-700">Vinculadas</p>
            </div>
            <div className={`rounded-xl p-3 text-center ${result.skipped > 0 ? 'bg-surface-container-low' : 'bg-surface-container-low'}`}>
              <p className="text-2xl font-bold text-outline/70">{result.skipped}</p>
              <p className="text-[12px] text-outline">Ignoradas*</p>
            </div>
            <div className={`rounded-xl p-3 text-center ${result.notFound > 0 ? 'bg-amber-50' : 'bg-surface-container-low'}`}>
              <p className={`text-2xl font-bold ${result.notFound > 0 ? 'text-amber-600' : 'text-outline/70'}`}>
                {result.notFound}
              </p>
              <p className={`text-[12px] ${result.notFound > 0 ? 'text-amber-700' : 'text-outline'}`}>
                Ref. não encontrada
              </p>
            </div>
          </div>

          {result.skipped > 0 && (
            <p className="text-[12px] text-outline/70 text-center">
              * Ignoradas = já tinham foto e "sobreescrever" estava desativado
            </p>
          )}

          {result.notFound > 0 && (
            <p className="text-[12px] text-amber-600 text-center">
              ⚠ Verifique se a tabela de preços selecionada está correta
            </p>
          )}

          {result.errors.length > 0 && (
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-[12px] font-semibold text-red-700 mb-1">
                {result.errors.length} erro{result.errors.length > 1 ? 's' : ''} ao processar:
              </p>
              <p className="text-[12px] text-red-600 font-mono">{result.errors.join(', ')}</p>
            </div>
          )}
        </div>
      ) : (
        /* ── Formulário ── */
        <div className="space-y-1">
          <div className="bg-blue-50 rounded-xl p-3 text-[12px] text-blue-700">
            <p className="font-semibold mb-1">Como funciona:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-[12px]">
              <li>Abra a pasta de fotos no Google Drive</li>
              <li>Clique em "Baixar tudo" → o Drive gera um <strong>.zip</strong></li>
              <li>Selecione a tabela de preços correspondente</li>
              <li>Faça upload do .zip aqui</li>
            </ol>
            <p className="text-[12px] mt-1.5 text-blue-600">
              As fotos são identificadas pela referência no nome do arquivo<br/>
              (ex: <code>001 TE10308-791.jpg</code> → vincula a <strong>TE10308</strong>)
            </p>
          </div>

          {/* Tabela de preços */}
          <div>
            <label className="block text-[12px] font-medium text-on-surface-variant mb-1">
              Tabela de Preços *
            </label>
            <select
              value={priceTableId}
              onChange={e => setPriceTableId(e.target.value)}
              className="w-full border border-outline-variant rounded-lg px-3 py-1 text-[12px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary bg-white"
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
            <label className="block text-[12px] font-medium text-on-surface-variant mb-1">
              Arquivo ZIP *
            </label>
            <div
              className="border-2 border-dashed border-outline-variant rounded-xl p-6 text-center cursor-pointer hover:border-primary/30 hover:bg-primary/5/30 transition-colors"
              onClick={() => !processing && fileRef.current?.click()}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-primary">
                  <Archive className="h-5 w-5" />
                  <span className="text-[12px] font-medium">{file.name}</span>
                  <span className="text-[12px] text-outline/70">({(file.size / 1024 / 1024).toFixed(0)} MB)</span>
                </div>
              ) : (
                <div className="text-outline/70">
                  <Upload className="h-8 w-8 mx-auto mb-2" />
                  <p className="text-[12px]">Clique para selecionar o arquivo .zip</p>
                  <p className="text-[12px] mt-0.5 text-outline/50">Qualquer tamanho — processado localmente</p>
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

          {/* Modo galeria: várias fotos por produto */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={galleryMode}
              onChange={e => setGalleryMode(e.target.checked)}
              className="mt-0.5 rounded border-outline-variant text-primary focus:ring-primary"
            />
            <span className="text-[12px] text-on-surface-variant">
              <span className="font-semibold">Importar como galeria</span> — guarda <b>todas</b> as fotos de cada código (várias por produto). Desmarcado = só 1 foto (capa) por código.
            </span>
          </label>

          {/* Sobreescrever (só no modo capa) */}
          {!galleryMode && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={e => setOverwrite(e.target.checked)}
                className="rounded border-outline-variant text-primary focus:ring-primary"
              />
              <span className="text-[12px] text-on-surface-variant">Sobreescrever fotos já existentes</span>
            </label>
          )}

          {/* Progresso */}
          {processing && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[12px] text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {phase === 'reading'
                    ? 'Lendo arquivo ZIP…'
                    : `Enviando fotos: ${progress.done} de ${progress.total} (${pct}%)`}
                </span>
              </div>
              {phase === 'uploading' && (
                <div className="w-full bg-surface-container rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 rounded-xl p-3 text-[12px] text-red-600">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
