import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { commissionClosuresApi, companyApi, type CommissionClosure } from '../api/client'
import { PageSpinner } from '../components/ui/Spinner'

// Página de impressão do fechamento arquivado — lê do snapshot JSONB,
// sem chamadas ao banco de dados de pedidos (dados congelados no momento do fechamento).

const fmtR = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0)

function dataBR(iso: string | null | undefined) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).substring(0, 10).split('-')
  return `${d}/${m}/${y}`
}

interface SnapshotRow {
  id: string
  data_faturamento: string
  nf: string | null
  valor_faturado_fabrica: number
  razao_social: string
  industria: string
  rep_commission_pct: number
  rep_commission_value: number
}

interface DebitoRow {
  id: string
  descricao: string
  valor: number
}

export function CommissionClosurePrint() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const { data: closure, isLoading } = useQuery<CommissionClosure>({
    queryKey: ['commission-closure', id],
    queryFn: async () => (await commissionClosuresApi.get(id)).data,
  })

  const { data: company } = useQuery<Record<string, string>>({
    queryKey: ['company'],
    queryFn: async () => (await companyApi.get()).data,
    staleTime: 10 * 60 * 1000,
  })

  if (isLoading) return <PageSpinner />
  if (!closure) return null

  const rows = (closure.snapshot as unknown as SnapshotRow[]) ?? []
  const debitos = (closure.debitos as unknown as DebitoRow[]) ?? []

  const [y, m] = closure.competencia.split('-')
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const periodoTxt = `01/${m}/${y} a ${String(new Date(Number(y), Number(m), 0).getDate()).padStart(2,'0')}/${m}/${y}`

  const industria = rows[0]?.industria ?? ''
  const closedAtBR = dataBR(closure.created_at)

  return (
    <div className="doc">
      <style>{`
        .doc { background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; min-height: 100vh; }
        .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 12mm 14mm; box-sizing: border-box; }
        .doc table { width: 100%; border-collapse: collapse; }
        .doc th, .doc td { font-size: 9.5px; padding: 2px 4px; }
        .lin th { border-bottom: 1.5px solid #000; text-align: left; font-size: 8.5px; letter-spacing: .2px; }
        .lin th.num { text-align: right; }
        .lin td { border-bottom: 1px solid #e5e5e5; }
        .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .tot td { border-top: 1.5px solid #000; border-bottom: none; font-weight: bold; font-size: 10.5px; }
        .titulo { text-align: center; font-weight: bold; font-size: 13px; margin: 14px 0 2px; letter-spacing: .5px; }
        .sub { text-align: center; font-size: 12px; font-weight: bold; }
        .periodo { text-align: center; font-size: 11px; margin-bottom: 12px; }
        .marca { text-align: right; font-size: 20px; font-weight: bold; line-height: 1.05; }
        .empresa { font-size: 12px; font-weight: bold; }
        .end { font-size: 10px; color: #333; }
        .secao { margin-top: 16px; font-size: 11px; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 2px; }
        .liq { margin-top: 10px; border-top: 1.5px solid #000; padding-top: 6px; display: flex; justify-content: space-between; font-weight: bold; font-size: 13px; }
        .btn { position: fixed; top: 8px; background: #1d4ed8; color: #fff; border: none; padding: 6px 16px; border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer; z-index: 999; }
        .fechado-badge { margin-bottom: 10px; font-size: 9.5px; color: #555; text-align: right; }
        @media print {
          .btn, .no-print { display: none !important; }
          .page { width: 100%; min-height: 0; padding: 8mm 10mm; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      <button className="btn" style={{ right: 12 }} onClick={() => window.print()}>🖨️ Imprimir / PDF</button>
      <button className="btn" style={{ left: 12, background: '#6b7280' }} onClick={() => navigate(-1)}>← Voltar</button>

      <div className="page">
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
        <div className="sub">{closure.rep_name}</div>
        <div className="periodo">PERÍODO: {periodoTxt}.</div>
        <div className="fechado-badge">
          Fechamento arquivado em {closedAtBR}
          {closure.closed_by_name ? ` por ${closure.closed_by_name}` : ''}
        </div>

        {rows.length === 0 ? (
          <p style={{ fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
            Nenhum faturamento registrado neste fechamento.
          </p>
        ) : (
          <table className="lin">
            <thead>
              <tr>
                <th style={{ width: '10%' }}>DATA</th>
                <th style={{ width: '8%' }}>NF</th>
                <th>CLIENTE</th>
                <th className="num" style={{ width: '13%' }}>VLR PGTO</th>
                <th className="num" style={{ width: '8%' }}>% COM.</th>
                <th className="num" style={{ width: '14%' }}>VLR. COMISSÃO</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{dataBR(r.data_faturamento)}</td>
                  <td>{r.nf || '—'}</td>
                  <td>{r.razao_social}</td>
                  <td className="num">{fmtR(Number(r.valor_faturado_fabrica))}</td>
                  <td className="num">{Number(r.rep_commission_pct).toFixed(2)}%</td>
                  <td className="num">{fmtR(Number(r.rep_commission_value))}</td>
                </tr>
              ))}
              <tr className="tot">
                <td colSpan={3}>{rows.length} faturamento{rows.length !== 1 ? 's' : ''}</td>
                <td className="num">{fmtR(Number(closure.total_faturado))}</td>
                <td></td>
                <td className="num">{fmtR(Number(closure.total_comissao))}</td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="secao">RELATÓRIO DE DÉBITOS</div>
        <table>
          <tbody>
            {debitos.map(d => (
              <tr key={d.id}>
                <td>{d.descricao}</td>
                <td className="num" style={{ width: '20%' }}>{fmtR(Number(d.valor))}</td>
              </tr>
            ))}
            {debitos.length > 0 && (
              <tr className="tot">
                <td>TOTAL DE DÉBITOS</td>
                <td className="num">{fmtR(Number(closure.total_debitos))}</td>
              </tr>
            )}
            {debitos.length === 0 && (
              <tr><td style={{ fontSize: 11, color: '#666' }}>Sem débitos neste mês.</td></tr>
            )}
          </tbody>
        </table>

        <div className="liq">
          <span>VALOR LÍQUIDO A RECEBER</span>
          <span>{fmtR(Number(closure.valor_liquido))}</span>
        </div>
      </div>
    </div>
  )
}
