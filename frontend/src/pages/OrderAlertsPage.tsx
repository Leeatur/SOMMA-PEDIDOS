import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BellRing, X, AlertTriangle, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ordersApi } from '../api/client'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { StatusBadge, Badge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'

interface OrderAlert {
  id: string
  order_number: number
  created_at: string
  delivery_date: string | null
  total_value: number
  total_pieces: number
  payment_terms: string | null
  age_days: number
  milestone_days: number
  client_id: string
  client_name: string
  client_trade_name: string | null
  client_city: string | null
  rep_id: string
  rep_name: string
  factory_name: string
  status_name: string | null
  status_color: string | null
}

function fmt(n: number) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
}

function fmtDate(d: string) {
  if (!d) return ''
  const s = String(d).trim()
  if (s.includes('T') || s.includes('Z')) {
    try { return new Date(s).toLocaleDateString('pt-BR') } catch { return s }
  }
  const [y, m, day] = s.substring(0, 10).split('-')
  if (!y || !m || !day) return s
  return `${day}/${m}/${y}`
}

// Nível visual conforme o tamanho do atraso — quanto mais marcos de 15 dias, mais crítico
function severity(milestoneDays: number): { variant: 'warning' | 'danger'; label: string } {
  if (milestoneDays >= 45) return { variant: 'danger', label: `${milestoneDays} dias — crítico` }
  if (milestoneDays >= 30) return { variant: 'danger', label: `${milestoneDays} dias` }
  return { variant: 'warning', label: `${milestoneDays} dias` }
}

export function OrderAlertsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [dismissingKey, setDismissingKey] = useState<string | null>(null)

  const { data: alerts = [], isLoading } = useQuery<OrderAlert[]>({
    queryKey: ['order-alerts'],
    queryFn: () => ordersApi.alerts().then(r => r.data),
  })

  const dismissMut = useMutation({
    mutationFn: ({ id, milestone_days }: { id: string; milestone_days: number }) =>
      ordersApi.dismissAlert(id, milestone_days),
    onMutate: ({ id, milestone_days }) => setDismissingKey(`${id}-${milestone_days}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['order-alerts'] }),
    onSettled: () => setDismissingKey(null),
  })

  if (isLoading) return <PageSpinner />

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-outline-variant px-5 py-2.5 lg:px-8">
        <div className="w-full flex items-center gap-3">
          <button onClick={() => navigate('/orders')} className="p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center">
            <BellRing className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-on-surface">Alertas de Pedidos em Atraso</h1>
            <p className="text-[12px] text-outline mt-0.5">
              {alerts.length === 0
                ? 'Nenhum alerta no momento'
                : `${alerts.length} pedido${alerts.length > 1 ? 's' : ''} atingiram um marco de 15 dias sem conclusão`}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 py-5 lg:px-8 w-full">
        {alerts.length === 0 ? (
          <Card padding="md">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-14 h-14 bg-surface-container rounded-2xl flex items-center justify-center mb-3">
                <BellRing className="h-7 w-7 text-outline/50" />
              </div>
              <p className="text-outline font-medium">Nenhum alerta pendente</p>
              <p className="text-[12px] text-outline/70 mt-1">
                Pedidos que completarem 15, 30, 45... dias desde a emissão sem conclusão aparecerão aqui
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-700">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                Estes pedidos completaram um múltiplo de 15 dias desde a emissão e ainda não foram concluídos —
                use para cobrar a fábrica pela entrega. Clique em <strong>Dispensar</strong> para remover o alerta;
                ele volta a aparecer automaticamente no próximo marco de 15 dias caso o pedido continue parado.
              </span>
            </div>

            {alerts.map(alert => {
              const sev = severity(alert.milestone_days)
              const key = `${alert.id}-${alert.milestone_days}`
              return (
                <Card key={key} padding="md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Número, cliente e severidade */}
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-[12px] font-bold text-outline/70">#{alert.order_number}</span>
                        <span className="text-[12px] font-semibold text-on-surface truncate">{alert.client_name}</span>
                        {alert.client_city && (
                          <span className="text-[12px] text-outline/70">— {alert.client_city}</span>
                        )}
                        <Badge variant={sev.variant}>
                          <BellRing className="h-3 w-3" /> {sev.label}
                        </Badge>
                        {alert.status_name && (
                          <StatusBadge name={alert.status_name} color={alert.status_color || '#6B7280'} />
                        )}
                      </div>
                      {/* Detalhes */}
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-outline">
                        <span>{alert.factory_name}</span>
                        <span>Rep: {alert.rep_name}</span>
                        <span>{alert.total_pieces} peças</span>
                        <span className="font-medium text-on-surface-variant">R$ {fmt(alert.total_value)}</span>
                      </div>
                      {/* Datas */}
                      <div className="flex flex-wrap gap-4 mt-1.5 text-[12px] text-outline/70">
                        <span>Emitido em {fmtDate(alert.created_at)} ({alert.age_days} dias atrás)</span>
                        {alert.delivery_date && <span>Entrega prevista: {fmtDate(alert.delivery_date)}</span>}
                      </div>
                    </div>
                    {/* Ações */}
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/orders/${alert.id}`)}
                      >
                        Ver pedido
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<X className="h-3.5 w-3.5" />}
                        loading={dismissingKey === key}
                        onClick={() => {
                          if (window.confirm(`Dispensar o alerta de ${alert.milestone_days} dias do pedido #${alert.order_number}? Ele volta a aparecer no próximo marco de 15 dias, se o pedido continuar parado.`)) {
                            dismissMut.mutate({ id: alert.id, milestone_days: alert.milestone_days })
                          }
                        }}
                        className="text-red-600 border-red-300 hover:bg-red-50"
                      >
                        Dispensar
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
