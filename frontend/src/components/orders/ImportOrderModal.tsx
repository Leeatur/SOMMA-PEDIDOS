import { useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { X, Upload, CheckCircle2, AlertCircle, FileText, Loader2 } from 'lucide-react'
import { ordersApi } from '../../api/client'
import { formatCurrency } from '../../utils/format'

interface ParsedItem {
  reference: string
  product_name_pdf: string
  product_name_db: string | null
  product_id: string | null
  product_type: 'regular' | 'pack'
  size_range: string | null
  sizes: Record<string, number>
  total_pieces: number
  unit_price: number
  subtotal: number
  matched: boolean
}

interface ParseResult {
  header: {
    factory_name: string
    client_name: string
    client_trade_name: string | null
    client_cnpj: string | null
    order_date: string | null
    delivery_date: string | null
    payment_terms: string | null
    freight_type: string | null
    rep_name: string | null
  }
  factory_id: string | null
  client_id: string | null
  price_table_id: string | null
  items: ParsedItem[]
  summary: {
    total_items: number
    matched_items: number
    unmatched_items: number
    unmatched_refs: string[]
    total_pieces: number
    total_value: number
  }
}

interface Props {
  onClose: () => void
  onCreated: (orderId: string) => void
}

function buildOrderPayload(result: ParseResult) {
  const items = result.items
    .filter(i => i.matched && i.product_id)
    .map(item => {
      if (item.product_type === 'pack') {
        return {
          product_id: item.product_id!,
          reference: item.reference,
          boxes_count: 1,
          unit_price: item.unit_price,
          custom_grade: [{ color: null, sizes: item.sizes, total_pieces: item.total_pieces }],
        }
      }
      return {
        product_id: item.product_id!,
        reference: item.reference,
        boxes_count: 1,
        unit_price: item.unit_price,
        sizes: item.sizes,
      }
    })

  return {
    client_id: result.client_id!,
    factory_id: result.factory_id!,
    price_table_id: result.price_table_id!,
    discount_pct: 0,
    payment_terms: result.header.payment_terms || undefined,
    freight_type: result.header.freight_type || undefined,
    delivery_date: result.header.delivery_date || undefined,
    notes: `Importado via PDF${result.header.factory_name ? ' — ' + result.header.factory_name : ''}`,
    items,
  }
}

export function ImportOrderModal({ onClose, onCreated }: Props) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<ParseResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const parseMutation = useMutation({
    mutationFn: (file: File) => ordersApi.parseFile(file).then(r => r.data as ParseResult),
    onSuccess: (data) => { setResult(data); setParseError(null) },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      setParseError(e.response?.data?.error || 'Erro ao processar o arquivo.')
    },
  })

  const createMutation = useMutation({
    mutationFn: () => ordersApi.create(buildOrderPayload(result!) as Parameters<typeof ordersApi.create>[0]).then(r => r.data),
    onSuccess: (order) => {
      onCreated(order.id)
      navigate(`/orders/${order.id}`)
    },
  })

  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setParseError('Envie um arquivo PDF.')
      return
    }
    setParseError(null)
    setResult(null)
    parseMutation.mutate(file)
  }, [parseMutation])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const canConfirm = result &&
    result.client_id &&
    result.factory_id &&
    result.price_table_id &&
    result.summary.matched_items > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-white border border-gray-200 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" style={{ backgroundColor: '#ffffff' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Importar Pedido via PDF</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Upload zone */}
          {!result && (
            <div
              className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer
                ${dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              {parseMutation.isPending ? (
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <Loader2 className="w-10 h-10 animate-spin text-primary" />
                  <p>Lendo o arquivo...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <Upload className="w-10 h-10" />
                  <p className="text-sm">Arraste o PDF aqui ou clique para selecionar</p>
                  <p className="text-xs opacity-60">Formato TEEZZ — PDF</p>
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
            </div>
          )}

          {/* Parse error */}
          {parseError && (
            <div className="flex items-center gap-2 text-destructive bg-destructive/10 rounded-lg px-4 py-3 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {parseError}
            </div>
          )}

          {/* Preview */}
          {result && (
            <>
              {/* Summary bar */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted/40 rounded-lg px-4 py-3">
                  <p className="text-xs text-muted-foreground">Fábrica</p>
                  <p className="font-semibold">{result.header.factory_name || '—'}</p>
                  {!result.factory_id && <p className="text-xs text-destructive">Não encontrada no sistema</p>}
                </div>
                <div className="bg-muted/40 rounded-lg px-4 py-3">
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="font-semibold text-sm">{result.header.client_trade_name || result.header.client_name || '—'}</p>
                  {!result.client_id && <p className="text-xs text-destructive">Não encontrado no cadastro</p>}
                </div>
                <div className="bg-muted/40 rounded-lg px-4 py-3">
                  <p className="text-xs text-muted-foreground">Cond. / Frete / Entrega</p>
                  <p className="font-semibold text-sm">{result.header.payment_terms || '—'}</p>
                  <p className="text-xs text-muted-foreground">{result.header.freight_type} · {result.header.delivery_date?.split('-').reverse().join('/') || '—'}</p>
                </div>
              </div>

              {/* Match status */}
              <div className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg
                ${result.summary.unmatched_items > 0 ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400' : 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-400'}`}>
                {result.summary.unmatched_items > 0
                  ? <AlertCircle className="w-4 h-4 shrink-0" />
                  : <CheckCircle2 className="w-4 h-4 shrink-0" />}
                <span>
                  {result.summary.matched_items} de {result.summary.total_items} referências encontradas no sistema
                  {result.summary.unmatched_items > 0 && ` · ${result.summary.unmatched_items} não encontradas: ${result.summary.unmatched_refs.slice(0, 5).join(', ')}${result.summary.unmatched_refs.length > 5 ? '...' : ''}`}
                </span>
              </div>

              {/* Items table */}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-muted/60">
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Referência</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Produto</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Grades</th>
                      <th className="text-right px-3 py-2 font-medium text-xs text-muted-foreground">Pçs</th>
                      <th className="text-right px-3 py-2 font-medium text-xs text-muted-foreground">Preço</th>
                      <th className="text-right px-3 py-2 font-medium text-xs text-muted-foreground">Total</th>
                      <th className="text-center px-3 py-2 font-medium text-xs text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item, idx) => (
                      <tr key={idx} className={`border-t border-border ${!item.matched ? 'opacity-50' : ''}`}>
                        <td className="px-3 py-2 font-mono text-xs">{item.reference}</td>
                        <td className="px-3 py-2 text-xs max-w-[180px]">
                          <p>{item.product_name_db || item.product_name_pdf}</p>
                          {item.product_name_db && item.product_name_db !== item.product_name_pdf && (
                            <p className="text-muted-foreground text-[10px]">{item.product_name_pdf}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px]">
                          {Object.entries(item.sizes).map(([sz, qty]) => (
                            <span key={sz} className="mr-1">{sz}:{qty}</span>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-right">{item.total_pieces}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(item.unit_price)}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(item.subtotal)}</td>
                        <td className="px-3 py-2 text-center">
                          {item.matched
                            ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                            : <AlertCircle className="w-4 h-4 text-destructive mx-auto" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/60 font-semibold">
                      <td colSpan={3} className="px-3 py-2 text-xs text-muted-foreground">
                        {result.summary.unmatched_items > 0 && `(${result.summary.unmatched_items} não importados)`}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {result.items.filter(i => i.matched).reduce((s, i) => s + i.total_pieces, 0)}
                      </td>
                      <td />
                      <td className="px-3 py-2 text-right">
                        {formatCurrency(result.items.filter(i => i.matched).reduce((s, i) => s + i.subtotal, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Change file */}
              <button
                onClick={() => { setResult(null); setParseError(null) }}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Enviar outro arquivo
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {result && (
              <span>
                {result.summary.total_pieces} peças · {formatCurrency(result.summary.total_value)}
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted/60"
            >
              Cancelar
            </button>
            {result && (
              <button
                onClick={() => createMutation.mutate()}
                disabled={!canConfirm || createMutation.isPending}
                className="px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50 flex items-center gap-2"
              >
                {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {canConfirm ? 'Criar Pedido' : !result.client_id ? 'Cliente não encontrado' : !result.factory_id ? 'Fábrica não encontrada' : 'Sem produtos'}
              </button>
            )}
          </div>
        </div>

        {/* Create error */}
        {createMutation.isError && (
          <div className="px-6 pb-4 text-xs text-destructive">
            Erro ao criar o pedido. Tente novamente.
          </div>
        )}
      </div>
    </div>
  )
}
