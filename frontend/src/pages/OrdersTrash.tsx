import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, RotateCcw, AlertTriangle, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ordersApi } from '../api/client'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PageSpinner } from '../components/ui/Spinner'

interface TrashedOrder {
  id: string
  order_number: number
  client_name: string
  client_city: string | null
  rep_name: string
  factory_name: string
  total_value: number
  total_pieces: number
  created_at: string
  deleted_at: string
}

function fmt(n: number) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
}

function fmtDate(d: string) {
  try { return new Date(d).toLocaleDateString('pt-BR') } catch { return d }
}

export function OrdersTrash() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const { data: orders = [], isLoading } = useQuery<TrashedOrder[]>({
    queryKey: ['orders-trash'],
    queryFn: () => ordersApi.listTrash().then(r => r.data),
  })

  const restoreMut = useMutation({
    mutationFn: (id: string) => ordersApi.restore(id),
    onMutate: (id) => setRestoringId(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders-trash'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
    onSettled: () => setRestoringId(null),
  })

  if (isLoading) return <PageSpinner />

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-outline-variant px-5 py-2.5 lg:px-8">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate('/orders')} className="p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="w-9 h-9 bg-red-100 rounded-xl flex items-center justify-center">
            <Trash2 className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-on-surface">Lixeira de Pedidos</h1>
            <p className="text-[11px] text-outline mt-0.5">
              {orders.length === 0
                ? 'Nenhum pedido excluído'
                : `${orders.length} pedido${orders.length > 1 ? 's' : ''} na lixeira`}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 py-5 lg:px-8 max-w-4xl mx-auto">
        {orders.length === 0 ? (
          <Card padding="md">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-14 h-14 bg-surface-container rounded-2xl flex items-center justify-center mb-3">
                <Trash2 className="h-7 w-7 text-outline/50" />
              </div>
              <p className="text-outline font-medium">Lixeira vazia</p>
              <p className="text-[11px] text-outline/70 mt-1">Pedidos excluídos aparecerão aqui</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-700">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>Pedidos na lixeira podem ser restaurados a qualquer momento. Clique em <strong>Restaurar</strong> para devolver ao sistema.</span>
            </div>

            {orders.map(order => (
              <Card key={order.id} padding="md">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Número e cliente */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-bold text-outline/70">#{order.order_number}</span>
                      <span className="text-[11px] font-semibold text-on-surface truncate">{order.client_name}</span>
                      {order.client_city && (
                        <span className="text-[11px] text-outline/70">— {order.client_city}</span>
                      )}
                    </div>
                    {/* Detalhes */}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-outline">
                      <span>{order.factory_name}</span>
                      <span>Rep: {order.rep_name}</span>
                      <span>{order.total_pieces} peças</span>
                      <span className="font-medium text-on-surface-variant">R$ {fmt(order.total_value)}</span>
                    </div>
                    {/* Datas */}
                    <div className="flex gap-4 mt-1.5 text-[11px] text-outline/70">
                      <span>Criado em {fmtDate(order.created_at)}</span>
                      <span className="text-red-400">Excluído em {fmtDate(order.deleted_at)}</span>
                    </div>
                  </div>
                  {/* Botão restaurar */}
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<RotateCcw className="h-3.5 w-3.5" />}
                    loading={restoringId === order.id}
                    onClick={() => {
                      if (window.confirm(`Restaurar pedido #${order.order_number}?`)) {
                        restoreMut.mutate(order.id)
                      }
                    }}
                    className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 flex-shrink-0"
                  >
                    Restaurar
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
