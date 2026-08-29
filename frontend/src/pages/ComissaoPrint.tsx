import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { reportsApi, companyApi, comissaoDebitosApi, type ComissaoDebito } from '../api/client'
import { PageSpinner } from '../components/ui/Spinner'

// Relatório de comissões no formulário padrão da fábrica (FORM. MODELO COMISSAO):
// cabeçalho da indústria, período, uma linha por faturamento, total, bloco de
// débitos e o líquido a receber.
//
// A regra do fechamento: conta a DATA DO FATURAMENTO, não a da venda. Tudo que a
// fábrica faturou entre o dia 1 e o último dia do mês entra no relatório do mês.

// Uma linha por NOTA faturada — é assim que o formulário da fábrica é montado.
interface LinhaComissao {
  fat_id: number
  data_faturamento: string
  nf: string | null
  valor_faturamento: string
  order_number: number
  razao_social: string
  industria: string
  rep_commission_pct: string
  rep_commission_value: string
  sem_comissao_fabrica: boolean
  vendedor: string
}

const fmtR = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0)

function dataBR(iso: string | null) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).substring(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// competência 'AAAA-MM' → primeiro e último dia do mês
function limitesDoMes(competencia: string): [string, string] {
  const [y, m] = competencia.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [`${competencia}-01`, `${competencia}-${String(ultimo).padStart(2, '0')}`]
}

export function ComissaoPrint() {
  const { repId = '', competencia = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [from, to] = useMemo(() => limitesDoMes(competencia), [competencia])

  const [novoDesc, setNovoDesc] = useState('')
  const [novoValor, setNovoValor] = useState('')

  const { data: company } = useQuery<Record<string, string>>({
    queryKey: ['company'],
    queryFn: async () => (await companyApi.get()).data,
    staleTime: 10 * 60 * 1000,
  })

  const { data: linhas, isLoading } = useQuery<LinhaComissao[]>({
    queryKey: ['comissao-print', repId, competencia],
    queryFn: async () => (await reportsApi.commissionsByFaturamento({
      date_from: from, date_to: to, rep_id: repId,
    })).data,
  })

  const { data: debitos = [] } = useQuery<ComissaoDebito[]>({
    queryKey: ['comissao-debitos', repId, competencia],
    queryFn: async () => (await comissaoDebitosApi.list({ rep_id: repId, competencia })).data,
  })

  const addDebito = useMutation({
    mutationFn: () => comissaoDebitosApi.create({
      rep_id: repId,
      competencia,
      descricao: novoDesc.trim(),
      valor: parseFloat(novoValor.replace(/\./g, '').replace(',', '.')) || 0,
    }),
    onSuccess: () => {
      setNovoDesc(''); setNovoValor('')
      qc.invalidateQueries({ queryKey: ['comissao-debitos', repId, competencia] })
    },
  })
  const delDebito = useMutation({
    mutationFn: (id: string) => comissaoDebitosApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['comissao-debitos', repId, competencia] }),
  })

  if (isLoading) return <PageSpinner />

  const rows = (linhas || []).filter(r => !r.sem_comissao_fabrica)
  const rep = rows[0]?.vendedor || ''
  const industria = rows[0]?.industria || ''
  const totalPago = rows.reduce((s, r) => s + Number(r.valor_faturamento), 0)
  const totalCom  = rows.reduce((s, r) => s + Number(r.rep_commission_value), 0)
  const totalDeb  = debitos.reduce((s, d) => s + Number(d.valor), 0)
  const liquido   = totalCom - totalDeb

  const periodoTxt = `${dataBR(from).replace(/\//g, '.')} a ${dataBR(to).replace(/\//g, '.')}`

  return (
    <div className="doc">
      <style>{`
        .doc { background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; min-height: 100vh; }
        .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 12mm 14mm; box-sizing: border-box; }
        .doc table { width: 100%; border-collapse: collapse; }
        .doc th, .doc td { font-size: 11px; padding: 3px 5px; }
        .lin th { border-bottom: 1.5px solid #000; text-align: left; font-size: 10px; letter-spacing: .3px; }
        /* .num sozinho perde para .lin th na especificidade: o título ficava à
           esquerda e o número à direita, desencontrados. */
        .lin th.num { text-align: right; }
        .lin td { border-bottom: 1px solid #e5e5e5; }
        .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .tot td { border-top: 1.5px solid #000; border-bottom: none; font-weight: bold; font-size: 12px; }
        .titulo { text-align: center; font-weight: bold; font-size: 13px; margin: 14px 0 2px; letter-spacing: .5px; }
        .sub { text-align: center; font-size: 12px; font-weight: bold; }
        .periodo { text-align: center; font-size: 11px; margin-bottom: 12px; }
        .marca { text-align: right; font-size: 20px; font-weight: bold; line-height: 1.05; }
        .empresa { font-size: 12px; font-weight: bold; }
        .end { font-size: 10px; color: #333; }
        .secao { margin-top: 16px; font-size: 11px; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 2px; }
        .liq { margin-top: 10px; border-top: 1.5px solid #000; padding-top: 6px; display: flex; justify-content: space-between; font-weight: bold; font-size: 13px; }
        .btn { position: fixed; top: 8px; background: #1d4ed8; color: #fff; border: none; padding: 6px 16px; border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer; z-index: 999; }
        .add { margin-top: 6px; display: flex; gap: 6px; }
        .add input { border: 1px solid #bbb; border-radius: 4px; padding: 4px 6px; font-size: 11px; }
        .add button { border: 1px solid #1d4ed8; color: #1d4ed8; background: #fff; border-radius: 4px; padding: 4px 10px; font-size: 11px; font-weight: bold; cursor: pointer; }
        .del { border: none; background: none; color: #b91c1c; cursor: pointer; font-size: 11px; }
        @media print {
          .btn, .add, .del, .no-print { display: none !important; }
          .page { width: 100%; min-height: 0; padding: 8mm 10mm; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      <button className="btn" style={{ right: 12 }} onClick={() => window.print()}>🖨️ Imprimir / PDF</button>
      <button className="btn" style={{ left: 12, background: '#6b7280' }} onClick={() => navigate(-1)}>← Voltar</button>

      <div className="page">
        {/* Cabeçalho da indústria */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="empresa">{company?.name || ''}</div>
            <div className="end">
              {[company?.address, company?.city, company?.state].filter(Boolean).join(' - ')}
            </div>
          </div>
          <div className="marca">{industria}</div>
        </div>

        <div className="titulo">RELATÓRIO DE COMISSÕES</div>
        <div className="sub">{rep}</div>
        <div className="periodo">PERÍODO: {periodoTxt}.</div>

        {rows.length === 0 ? (
          <p style={{ fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
            Nenhum faturamento lançado neste mês para este representante.
          </p>
        ) : (
          <table className="lin">
            <thead>
              <tr>
                <th style={{ width: '14%' }}>DATA</th>
                <th style={{ width: '10%' }}>NF</th>
                <th>CLIENTE</th>
                <th className="num" style={{ width: '18%' }}>VLR PGTO</th>
                <th className="num" style={{ width: '12%' }}>% COM.</th>
                <th className="num" style={{ width: '20%' }}>VLR. COMISSÃO</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.fat_id}>
                  <td>{dataBR(r.data_faturamento)}</td>
                  <td>{r.nf || '—'}</td>
                  <td>{r.razao_social}</td>
                  <td className="num">{fmtR(Number(r.valor_faturamento))}</td>
                  <td className="num">{Number(r.rep_commission_pct).toFixed(2)}%</td>
                  <td className="num">{fmtR(Number(r.rep_commission_value))}</td>
                </tr>
              ))}
              <tr className="tot">
                <td colSpan={3}>{rows.length} faturamento{rows.length !== 1 ? 's' : ''}</td>
                <td className="num">{fmtR(totalPago)}</td>
                <td></td>
                <td className="num">{fmtR(totalCom)}</td>
              </tr>
            </tbody>
          </table>
        )}

        {/* Débitos — adiantamento, amostra, devolução */}
        <div className="secao">RELATÓRIO DE DÉBITOS</div>
        <table>
          <tbody>
            {debitos.map(d => (
              <tr key={d.id}>
                <td>{d.descricao}</td>
                <td className="num" style={{ width: '20%' }}>{fmtR(Number(d.valor))}</td>
                <td style={{ width: 28 }}>
                  <button className="del" onClick={() => delDebito.mutate(d.id)} title="Remover">✕</button>
                </td>
              </tr>
            ))}
            {debitos.length > 0 && (
              <tr className="tot">
                <td>TOTAL DE DÉBITOS</td>
                <td className="num">{fmtR(totalDeb)}</td>
                <td></td>
              </tr>
            )}
            {debitos.length === 0 && (
              <tr><td style={{ fontSize: 11, color: '#666' }}>Sem débitos neste mês.</td></tr>
            )}
          </tbody>
        </table>

        <div className="add">
          <input value={novoDesc} onChange={e => setNovoDesc(e.target.value)}
            placeholder="Descrição (adiantamento, amostra…)" style={{ flex: 1 }} />
          <input value={novoValor} onChange={e => setNovoValor(e.target.value)}
            placeholder="0,00" style={{ width: 90, textAlign: 'right' }} />
          <button
            disabled={!novoDesc.trim() || addDebito.isPending}
            onClick={() => addDebito.mutate()}
          >
            + Débito
          </button>
        </div>

        <div className="liq">
          <span>VALOR LÍQUIDO A RECEBER</span>
          <span>{fmtR(liquido)}</span>
        </div>
      </div>
    </div>
  )
}
