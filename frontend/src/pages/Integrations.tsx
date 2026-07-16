import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plug, KeyRound, Copy, Check, RefreshCw, Trash2, ShieldCheck, Globe } from 'lucide-react'
import { integrationApi } from '../api/client'

interface IntegrationInfo {
  ativo: boolean
  atualizado_em: string | null
  instrucao: string
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600) } catch { /* ignore */ }
      }}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors flex-shrink-0"
    >
      {done
        ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copiado!</>
        : <><Copy className="h-3.5 w-3.5" /> Copiar</>}
    </button>
  )
}

export function Integrations() {
  const qc = useQueryClient()
  const [newToken, setNewToken] = useState<string | null>(null)

  // URL da API de vendas — mesmo origin, caminho fixo
  const apiUrl = window.location.origin + '/api/integration/sales'

  const { data: info, isLoading } = useQuery<IntegrationInfo>({
    queryKey: ['integration-info'],
    queryFn: () => integrationApi.info().then(r => r.data),
  })

  const generate = useMutation({
    mutationFn: () => integrationApi.generateToken().then(r => r.data as { token: string }),
    onSuccess: (data) => { setNewToken(data.token); qc.invalidateQueries({ queryKey: ['integration-info'] }) },
  })

  const revoke = useMutation({
    mutationFn: () => integrationApi.revokeToken(),
    onSuccess: () => { setNewToken(null); qc.invalidateQueries({ queryKey: ['integration-info'] }) },
  })

  function handleGenerate() {
    if (info?.ativo && !window.confirm('Já existe um token ativo. Gerar um novo vai INVALIDAR o atual — o SOMMA Maps para de sincronizar até você atualizar o token lá. Continuar?')) return
    generate.mutate()
  }
  function handleRevoke() {
    if (!window.confirm('Revogar o token? O SOMMA Maps para de receber dados imediatamente.')) return
    revoke.mutate()
  }

  const ativo = !!info?.ativo

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      {/* Cabeçalho */}
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#1a1a2e,#0f3460)' }}>
          <Plug className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-gray-900 leading-tight">Integrações</h1>
          <p className="text-[14px] text-gray-500 mt-0.5">
            Conecte o SOMMA Maps ao FV para visualizar a capilaridade das vendas por representante.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-[14px] text-gray-400">Carregando…</div>
      ) : (
        <>
          {/* ── Token de acesso ── */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-gray-400" />
                <h2 className="text-[15px] font-bold text-gray-900">Chave de acesso (token)</h2>
                {ativo
                  ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold">
                      <ShieldCheck className="h-3 w-3" /> Ativo
                    </span>
                  : <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-500 text-[11px] font-bold">
                      Não gerado
                    </span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerate}
                  disabled={generate.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-bold border transition-all disabled:opacity-50"
                  style={ativo
                    ? { borderColor: '#d1d5db', background: 'white', color: '#374151' }
                    : { borderColor: 'transparent', background: 'linear-gradient(135deg,#1a1a2e,#0f3460)', color: 'white' }}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${generate.isPending ? 'animate-spin' : ''}`} />
                  {ativo ? 'Gerar novo' : 'Gerar token'}
                </button>
                {ativo && (
                  <button
                    onClick={handleRevoke}
                    disabled={revoke.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-bold border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-all disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Revogar
                  </button>
                )}
              </div>
            </div>

            <p className="text-[13px] text-gray-500">
              O token autentica o SOMMA Maps para buscar as vendas desta instância. Cole-o no Maps em
              {' '}<strong>Integrações → adicionar integração FV</strong>.
            </p>

            {/* Token recém-gerado — aparece uma única vez */}
            {newToken && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-[12px] font-bold text-emerald-800 mb-2">
                  Token gerado — copie agora. Por segurança não é exibido novamente.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-[12px] bg-white border border-emerald-200 rounded-lg px-3 py-2 break-all text-gray-800">
                    {newToken}
                  </code>
                  <CopyButton text={newToken} />
                </div>
              </div>
            )}

            {ativo && !newToken && (
              <p className="text-[12px] text-gray-400 italic">
                Token ativo — gerado em {info?.atualizado_em ? new Date(info.atualizado_em).toLocaleString('pt-BR') : '—'}.
                O valor não é exibido novamente por segurança. Se precisar, gere um novo.
              </p>
            )}
          </div>

          {/* ── Endereço da API ── */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-gray-400" />
              <h2 className="text-[15px] font-bold text-gray-900">URL da API de vendas</h2>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-[12px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 break-all text-gray-800">
                {apiUrl}
              </code>
              <CopyButton text={apiUrl} />
            </div>
            <p className="text-[13px] text-gray-500">
              Cole esta URL no SOMMA Maps junto com o token acima. O Maps vai puxar as vendas
              por cidade/representante e montar o mapa de capilaridade.
            </p>
          </div>

          {/* ── Passo a passo ── */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="text-[15px] font-bold text-gray-900 mb-3">Como configurar no SOMMA Maps</h2>
            <ol className="space-y-2.5 text-[13px] text-gray-600">
              {[
                'Acesse sommamaps.com.br e entre na empresa correta (ex: Somma).',
                'Vá em Integrações (menu lateral) → clique em "Adicionar integração FV".',
                'Cole a URL da API acima no campo "URL da API".',
                'Cole o token gerado acima no campo "Token de integração".',
                'Salve. O Maps vai importar as vendas automaticamente.',
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-900 text-white text-[11px] font-black flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  )
}
