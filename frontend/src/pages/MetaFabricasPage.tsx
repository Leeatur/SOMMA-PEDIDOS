import { useQuery } from '@tanstack/react-query'
import { ordersApi } from '../api/client'
import { Target, TrendingUp, TrendingDown, Clock, Factory } from 'lucide-react'

// ─── Configuração de metas (Jul-Set 2026) ────────────────────────────────────

const PERIOD_FROM = '2026-07-01'
const PERIOD_TO   = '2026-09-30'

const METAS = [
  {
    fabrica: 'OUZZARE',
    totalGeral: 39000,
    reps: [
      { nome: 'Leonardo', metaGeral: 14181, metaMensal: 4727 },
      { nome: 'Cutti',    metaGeral: 8477,  metaMensal: 2826 },
      { nome: 'Rodrigo',  metaGeral: 9293,  metaMensal: 3098 },
    ],
  },
  {
    fabrica: 'TEEZZ',
    totalGeral: 32150,
    reps: [
      { nome: 'Fabrício', metaGeral: 2469, metaMensal: 824  },
      { nome: 'Edson',    metaGeral: 8982, metaMensal: 2994 },
      { nome: 'Marcos',   metaGeral: 9148, metaMensal: 3050 },
      { nome: 'Erico',    metaGeral: 9293, metaMensal: 3098 },
    ],
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtN(n: number) {
  return n.toLocaleString('pt-BR')
}

function pct(valor: number, total: number) {
  if (total === 0) return 0
  return Math.min(100, Math.round((valor / total) * 100))
}

function diasNoPeriodo(from: string, to: string) {
  const a = new Date(from + 'T12:00:00')
  const b = new Date(to   + 'T12:00:00')
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1
}

function diasDecorridos(from: string, to: string, hoje: string) {
  const a     = new Date(from  + 'T12:00:00')
  const b     = new Date(to    + 'T12:00:00')
  const h     = new Date(hoje  + 'T12:00:00')
  if (h < a) return 0
  if (h > b) return diasNoPeriodo(from, to)
  return Math.round((h.getTime() - a.getTime()) / 86400000) + 1
}

// ─── Barra de progresso ───────────────────────────────────────────────────────

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const p = Math.min(100, max === 0 ? 0 : (value / max) * 100)
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
      <div
        className={`h-2 rounded-full transition-all ${color}`}
        style={{ width: `${p}%` }}
      />
    </div>
  )
}

// ─── Card do rep ─────────────────────────────────────────────────────────────

interface RepData {
  total_pieces: number
}

interface RepGoal {
  nome: string
  metaGeral: number
  metaMensal: number
}

function match(repNome: string, goalNome: string) {
  return repNome.toLowerCase().includes(goalNome.toLowerCase()) ||
         goalNome.toLowerCase().includes(repNome.toLowerCase())
}

function RepCard({
  goal,
  periodRows,
  monthRows,
  factoryName,
  hoje,
  mesFrom,
  mesTo,
}: {
  goal: RepGoal
  periodRows: (RepData & { rep_name: string; factory_name: string })[]
  monthRows:  (RepData & { rep_name: string; factory_name: string })[]
  factoryName: string
  hoje: string
  mesFrom: string
  mesTo: string
}) {
  const periodoRow = periodRows.find(r =>
    r.factory_name.toUpperCase().includes(factoryName.toUpperCase()) &&
    match(r.rep_name, goal.nome)
  )
  const mesRow = monthRows.find(r =>
    r.factory_name.toUpperCase().includes(factoryName.toUpperCase()) &&
    match(r.rep_name, goal.nome)
  )

  const vendidoPeriodo = periodoRow?.total_pieces ?? 0
  const vendidoMes     = mesRow?.total_pieces ?? 0

  // Progresso geral
  const pctGeral  = pct(vendidoPeriodo, goal.metaGeral)
  const faltaGeral = Math.max(0, goal.metaGeral - vendidoPeriodo)

  // Ritmo esperado no período até hoje
  const totalDiasPeriodo  = diasNoPeriodo(PERIOD_FROM, PERIOD_TO)
  const diasOcorridosPeriodo = diasDecorridos(PERIOD_FROM, PERIOD_TO, hoje)
  const ritmoEsperadoPeriodo = Math.round(goal.metaGeral * (diasOcorridosPeriodo / totalDiasPeriodo))
  const atrasoPeriodo = ritmoEsperadoPeriodo - vendidoPeriodo

  // Progresso mensal
  const pctMensal    = pct(vendidoMes, goal.metaMensal)
  const faltaMes     = Math.max(0, goal.metaMensal - vendidoMes)
  const totalDiasMes = diasNoPeriodo(mesFrom, mesTo)
  const diasOcorridosMes = diasDecorridos(mesFrom, mesTo, hoje)
  const ritmoEsperadoMes = Math.round(goal.metaMensal * (diasOcorridosMes / totalDiasMes))
  const atrasoMes = ritmoEsperadoMes - vendidoMes

  const periodoNaoIniciou = diasOcorridosPeriodo === 0

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-on-surface text-[15px]">{goal.nome}</h3>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
          pctGeral >= 100 ? 'bg-emerald-100 text-emerald-700' :
          pctGeral >= 60  ? 'bg-blue-100 text-blue-700' :
          pctGeral >= 30  ? 'bg-amber-100 text-amber-700' :
          'bg-gray-100 text-gray-500'
        }`}>{pctGeral}% da meta</span>
      </div>

      {/* Metas */}
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="bg-gray-50 rounded-xl p-2">
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Meta Geral</p>
          <p className="text-[14px] font-bold text-on-surface">{fmtN(goal.metaGeral)} pç</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-2">
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Meta Mensal</p>
          <p className="text-[14px] font-bold text-on-surface">{fmtN(goal.metaMensal)} pç</p>
        </div>
      </div>

      {/* Barra período */}
      <div className="space-y-1">
        <div className="flex justify-between text-[11px]">
          <span className="text-gray-500 font-medium">Jul–Set: {fmtN(vendidoPeriodo)} vendidas</span>
          <span className="text-gray-400">faltam {fmtN(faltaGeral)} pç</span>
        </div>
        <ProgressBar value={vendidoPeriodo} max={goal.metaGeral} color="bg-primary" />
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>0</span>
          <span>{fmtN(goal.metaGeral)}</span>
        </div>
      </div>

      {/* Barra mensal */}
      <div className="space-y-1">
        <div className="flex justify-between text-[11px]">
          <span className="text-gray-500 font-medium">Este mês: {fmtN(vendidoMes)} vendidas</span>
          <span className="text-gray-400">faltam {fmtN(faltaMes)} pç</span>
        </div>
        <ProgressBar value={vendidoMes} max={goal.metaMensal} color="bg-emerald-500" />
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>0</span>
          <span>{fmtN(goal.metaMensal)}</span>
        </div>
      </div>

      {/* Ritmo / atraso */}
      {periodoNaoIniciou ? (
        <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2 text-[11px] text-blue-600">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          Período começa em 01/07/2026
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {/* Ritmo período */}
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] ${
            atrasoPeriodo > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'
          }`}>
            {atrasoPeriodo > 0
              ? <TrendingDown className="h-3.5 w-3.5 shrink-0" />
              : <TrendingUp   className="h-3.5 w-3.5 shrink-0" />}
            <div>
              <p className="font-semibold leading-tight">
                {atrasoPeriodo > 0 ? `−${fmtN(atrasoPeriodo)} pç` : `+${fmtN(-atrasoPeriodo)} pç`}
              </p>
              <p className="text-[10px] opacity-70">vs ritmo Jul–Set</p>
            </div>
          </div>

          {/* Ritmo mensal */}
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] ${
            atrasoMes > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
          }`}>
            {atrasoMes > 0
              ? <TrendingDown className="h-3.5 w-3.5 shrink-0" />
              : <TrendingUp   className="h-3.5 w-3.5 shrink-0" />}
            <div>
              <p className="font-semibold leading-tight">
                {atrasoMes > 0 ? `−${fmtN(atrasoMes)} pç` : `+${fmtN(-atrasoMes)} pç`}
              </p>
              <p className="text-[10px] opacity-70">vs ritmo mensal</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Página principal ────────────────────────────────────────────────────────

interface MetaRow {
  rep_id: string
  rep_name: string
  factory_id: string
  factory_name: string
  total_pieces: number
}

interface MetaData {
  periodo:        MetaRow[]
  mesAtual:       MetaRow[]
  hoje:           string
  mesAtualRange:  { from: string; to: string }
}

export default function MetaFabricasPage() {
  const { data, isLoading } = useQuery<{ data: MetaData }>({
    queryKey: ['meta-fabricas'],
    queryFn: () => ordersApi.metaFabricas(),
    staleTime: 5 * 60 * 1000,
  })

  const d = data?.data

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 rounded-xl p-2">
          <Target className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-on-surface">Metas de Fábricas</h1>
          <p className="text-[12px] text-outline">Julho · Agosto · Setembro / 2026</p>
        </div>
        {d && (
          <span className="ml-auto text-[11px] text-outline bg-gray-100 rounded-lg px-2 py-1">
            Hoje: {new Date(d.hoje + 'T12:00:00').toLocaleDateString('pt-BR')}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="text-center py-16 text-outline text-sm">Carregando dados…</div>
      )}

      {d && METAS.map(fab => {
        // Total vendido no período para a fábrica toda
        const totalVendidoPeriodo = d.periodo
          .filter(r => r.factory_name.toUpperCase().includes(fab.fabrica.toUpperCase()))
          .reduce((s, r) => s + r.total_pieces, 0)

        const pctFab = pct(totalVendidoPeriodo, fab.totalGeral)

        return (
          <section key={fab.fabrica} className="space-y-4">
            {/* Header da fábrica */}
            <div className="flex items-center gap-3 bg-primary rounded-2xl px-5 py-4 text-white">
              <Factory className="h-5 w-5 shrink-0 text-white/70" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-lg leading-none">{fab.fabrica}</h2>
                  <span className="text-white/60 text-[12px]">meta {fmtN(fab.totalGeral)} peças</span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex-1 bg-white/20 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-white h-2 rounded-full transition-all"
                      style={{ width: `${pctFab}%` }}
                    />
                  </div>
                  <span className="text-[12px] font-bold">
                    {fmtN(totalVendidoPeriodo)} pç vendidas ({pctFab}%)
                  </span>
                </div>
              </div>
            </div>

            {/* Grid dos reps */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {fab.reps.map(rep => (
                <RepCard
                  key={rep.nome}
                  goal={rep}
                  factoryName={fab.fabrica}
                  periodRows={d.periodo}
                  monthRows={d.mesAtual}
                  hoje={d.hoje}
                  mesFrom={d.mesAtualRange.from}
                  mesTo={d.mesAtualRange.to}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
