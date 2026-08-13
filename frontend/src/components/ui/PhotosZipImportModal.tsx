import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, Upload, CheckCircle, AlertCircle, Loader2, FileText } from 'lucide-react'
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

/** Redimensiona e comprime imagem no browser (evita uploads de 25-44 MB). */
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
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
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

/** Limita quantas uploads rodam em paralelo. */
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

/**
 * Processa um PDF de catálogo de fábrica:
 * - Cada página = 1 produto (nome + grade + referência no texto)
 * - Renderiza cada página como JPEG e extrai a referência do texto
 * - Retorna array de { ref, blob } para upload
 */
async function extractPdfPages(
  pdfData: ArrayBuffer,
  onProgress: (done: number, total: number) => void,
): Promise<Array<{ ref: string; blob: Blob }>> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).href
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise
  const total = pdf.numPages
  const items: Array<{ ref: string; blob: Blob }> = []

  for (let pageNum = 1; pageNum <= total; pageNum++) {
    onProgress(pageNum - 1, total)
    const page = await pdf.getPage(pageNum)

    // 1. Extrai texto da página para obter a referência
    const textContent = await page.getTextContent()
    const rawText = (textContent.items as Array<{ str: string }>)
      .map(item => item.str.trim())
      .filter(Boolean)
      .join('\n')
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean)

    // Referência = última linha que contém dígito e tem até 14 chars
    const ref = [...lines].reverse().find(l => /\d/.test(l) && l.length <= 14 && /^[A-Z0-9]/.test(l))
    if (!ref) continue // página sem referência válida (capa, índice, etc.)

    // 2. Renderiza a página em canvas (qualidade boa para catálogo)
    const viewport = page.getViewport({ scale: 1.8 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport, canvas }).promise

    // 3. Comprime para JPEG (~300 KB por página)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        0.82,
      ),
    )

    items.push({ ref, blob })
  }

  onProgress(total, total)
  return items
}

export function PhotosZipImportModal({ open, onClose, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [priceTableId, setPriceTableId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [galleryMode, setGalleryMode] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'reading' | 'rendering' | 'uploading'>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<ZipResult | null>(null)
  const [error, setError] = useState('')
  const [detectedMode, setDetectedMode] = useState<'images' | 'pdf' | null>(null)

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
    setDetectedMode(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleClose() {
    if (processing) return
    reset()
    onClose()
  }

  async function handleFileSelect(f: File | null) {
    setFile(f)
    setDetectedMode(null)
    setError('')
    if (!f) return

    // Pré-inspeciona o ZIP para detectar modo (imagens vs PDF catálogo)
    try {
      const zip = await JSZip.loadAsync(f)
      let hasPdf = false
      let hasImages = false
      zip.forEach((_path, entry) => {
        if (entry.dir) return
        const ext = entry.name.split('.').pop()?.toLowerCase() || ''
        if (ext === 'pdf') hasPdf = true
        if (IMAGE_EXTS.has(ext)) hasImages = true
      })
      if (hasPdf && !hasImages) setDetectedMode('pdf')
      else if (hasImages) setDetectedMode('images')
    } catch {
      // ignora — erro será capturado no submit
    }
  }

  async function handleSubmit() {
    if (!file || !priceTableId) return
    setProcessing(true)
    setError('')
    setResult(null)

    try {
      setPhase('reading')
      const zip = await JSZip.loadAsync(file)

      // ── Modo PDF: catálogo da fábrica ────────────────────────────────
      if (detectedMode === 'pdf') {
        // Encontra o primeiro PDF no ZIP
        let pdfEntry: JSZip.JSZipObject | null = null
        zip.forEach((_path, entry) => {
          if (!entry.dir && entry.name.split('.').pop()?.toLowerCase() === 'pdf' && !pdfEntry) {
            pdfEntry = entry
          }
        })
        if (!pdfEntry) throw new Error('Nenhum arquivo PDF encontrado no ZIP.')

        const pdfBuffer = await (pdfEntry as JSZip.JSZipObject).async('arraybuffer')

        // Renderiza páginas do PDF
        setPhase('rendering')
        const pages = await extractPdfPages(pdfBuffer, (done, total) => {
          setProgress({ done, total })
        })

        if (pages.length === 0) {
          setError('Nenhuma página com referência válida encontrada no PDF. Verifique se o catálogo tem texto selecionável.')
          setProcessing(false)
          setPhase('idle')
          return
        }

        // Faz upload de cada página renderizada
        setPhase('uploading')
        setProgress({ done: 0, total: pages.length })

        let matched = 0, skipped = 0, notFound = 0
        const errors: string[] = []

        const tasks = pages.map(({ ref, blob }) => async () => {
          try {
            const res = await priceTablesApi.uploadPhotoByRef(priceTableId, ref, blob, overwrite)
            const data = res.data as { matched?: boolean; skipped?: boolean; reason?: string }
            if (data.matched) matched++
            else if (data.skipped && data.reason === 'not_found') notFound++
            else skipped++
          } catch {
            errors.push(ref)
          }
          setProgress(p => ({ ...p, done: p.done + 1 }))
        })

        await pLimit(tasks, 2)
        setResult({ total: pages.length, matched, skipped, notFound, errors })
        onDone?.()
        return
      }

      // ── Modo padrão: fotos individuais no ZIP ────────────────────────
      const best = new Map<string, { n: number; zipFile: JSZip.JSZipObject }>()
      const all: Array<{ ref: string; n: number; zipFile: JSZip.JSZipObject }> = []
      zip.forEach((relativePath, zipFile) => {
        if (zipFile.dir) return
        const base = relativePath.split('/').pop() || ''
        const ext = base.split('.').pop()?.toLowerCase() || ''
        if (!IMAGE_EXTS.has(ext)) return
        const noExt = base.replace(/\.[^.]+$/, '')
        const head = noExt.split(/[-–(\s]/)[0].trim().toUpperCase()
        if (!head || !/\d/.test(head) || head.length > 14) return
        const nm = noExt.match(/\((\d+)\)/)
        const n = nm ? parseInt(nm[1], 10) : 0
        const cur = best.get(head)
        if (!cur || n < cur.n) best.set(head, { n, zipFile })
        all.push({ ref: head, n, zipFile })
      })
      const images = galleryMode
        ? all.sort((a, b) => a.ref.localeCompare(b.ref) || a.n - b.n).map(({ ref, zipFile }) => ({ ref, zipFile }))
        : [...best.entries()].map(([ref, { zipFile }]) => ({ ref, zipFile }))

      if (images.length === 0) {
        setError('Nenhuma imagem com referência válida encontrada no ZIP. Os nomes precisam começar com o código (ex: H90-CINZA.jpg, FC558.jpg, 5315 (1).jpg).')
        setProcessing(false)
        setPhase('idle')
        return
      }

      setPhase('uploading')
      setProgress({ done: 0, total: images.length })

      let matched = 0, skipped = 0, notFound = 0
      const errors: string[] = []

      const tasks = images.map(({ ref, zipFile }) => async () => {
        try {
          const rawBlob = await zipFile.async('blob')
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

  const phaseLabel =
    phase === 'reading'   ? 'Lendo arquivo ZIP…' :
    phase === 'rendering' ? `Renderizando páginas: ${progress.done} de ${progress.total} (${pct}%)` :
    phase === 'uploading' ? `Enviando: ${progress.done} de ${progress.total} (${pct}%)` : ''

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
              {processing ? phaseLabel : detectedMode === 'pdf' ? 'Importar Catálogo PDF' : 'Importar Fotos'}
            </Button>
          </div>
        )
      }
    >
      {result ? (
        /* ── Resultado ── */
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="font-semibold text-on-surface">Importação concluída!</p>
              <p className="text-[12px] text-outline">
                {result.total} {detectedMode === 'pdf' ? 'página' : 'foto'}{result.total !== 1 ? 's' : ''} processada{result.total !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-emerald-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-emerald-600">{result.matched}</p>
              <p className="text-[12px] text-emerald-700">Vinculadas</p>
            </div>
            <div className="rounded-xl p-3 text-center bg-surface-container-low">
              <p className="text-2xl font-bold text-outline/70">{result.skipped}</p>
              <p className="text-[12px] text-outline">Ignoradas*</p>
            </div>
            <div className={`rounded-xl p-3 text-center ${result.notFound > 0 ? 'bg-amber-50' : 'bg-surface-container-low'}`}>
              <p className={`text-2xl font-bold ${result.notFound > 0 ? 'text-amber-600' : 'text-outline/70'}`}>
                {result.notFound}
              </p>
              <p className={`text-[12px] ${result.notFound > 0 ? 'text-amber-700' : 'text-outline'}`}>
                Não encontrada
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
              Verifique se a tabela de preços selecionada está correta
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
        <div className="space-y-3">

          {/* Instrução contextual */}
          {detectedMode === 'pdf' ? (
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 text-[12px] text-violet-800">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-4 w-4 text-violet-600 flex-shrink-0" />
                <p className="font-semibold">Catálogo PDF detectado</p>
              </div>
              <p>Cada página do PDF será renderizada como foto e vinculada pela referência extraída do texto (ex: <code className="bg-violet-100 px-1 rounded">TE22185</code>).</p>
            </div>
          ) : (
            <div className="bg-blue-50 rounded-xl p-3 text-[12px] text-blue-700">
              <p className="font-semibold mb-1">Como funciona:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Abra a pasta de fotos no Google Drive</li>
                <li>Clique em "Baixar tudo" → o Drive gera um <strong>.zip</strong></li>
                <li>Selecione a tabela de preços correspondente</li>
                <li>Faça upload do .zip aqui</li>
              </ol>
              <p className="mt-1.5 text-blue-600">
                As fotos são identificadas pela referência no nome do arquivo<br/>
                (ex: <code>FC558 PRETO.jpg</code> → vincula a <strong>FC558</strong>)
              </p>
            </div>
          )}

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
              className="border-2 border-dashed border-outline-variant rounded-xl p-5 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
              onClick={() => !processing && fileRef.current?.click()}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-primary">
                  {detectedMode === 'pdf'
                    ? <FileText className="h-5 w-5" />
                    : <Archive className="h-5 w-5" />}
                  <span className="text-[12px] font-medium">{file.name}</span>
                  <span className="text-[12px] text-outline/70">({(file.size / 1024 / 1024).toFixed(0)} MB)</span>
                </div>
              ) : (
                <div className="text-outline/70">
                  <Upload className="h-8 w-8 mx-auto mb-2" />
                  <p className="text-[12px]">Clique para selecionar o arquivo .zip</p>
                  <p className="text-[12px] mt-0.5 text-outline/50">ZIP com fotos ou ZIP com catálogo PDF</p>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={e => handleFileSelect(e.target.files?.[0] || null)}
            />
          </div>

          {/* Opções — só para modo imagens */}
          {detectedMode !== 'pdf' && (
            <>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={galleryMode}
                  onChange={e => setGalleryMode(e.target.checked)}
                  className="mt-0.5 rounded border-outline-variant text-primary focus:ring-primary"
                />
                <span className="text-[12px] text-on-surface-variant">
                  <span className="font-semibold">Importar como galeria</span> — guarda <b>todas</b> as fotos de cada código. Desmarcado = só 1 foto (capa) por código.
                </span>
              </label>
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
            </>
          )}

          {/* Sobreescrever para PDF */}
          {detectedMode === 'pdf' && (
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
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[12px] text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{phaseLabel}</span>
              </div>
              {(phase === 'rendering' || phase === 'uploading') && (
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
