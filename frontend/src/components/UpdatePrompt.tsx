import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, X } from 'lucide-react'

/**
 * Aviso de "nova versão disponível" — modal centralizado.
 *
 * O PWA está em modo 'prompt': a versão nova NÃO recarrega a página sozinha (pra
 * não interromper quem está digitando um pedido ou o CNPJ no catálogo). Em vez
 * disso, mostramos este aviso no meio da tela; um clique em "Atualizar agora"
 * aplica na hora. Quem estiver no meio de algo pode tocar em "Agora não" e
 * atualizar depois pelo botão no menu.
 *
 * Checamos o servidor a cada 60s, então o aviso aparece sozinho poucos minutos
 * depois de um deploy — sem o usuário precisar recarregar.
 */
export function UpdatePrompt() {
  const [dismissed, setDismissed] = useState(false)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      // Verifica se há versão nova a cada 60s.
      setInterval(() => { registration.update().catch(() => {}) }, 60 * 1000)
    },
  })

  if (!needRefresh || dismissed) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setDismissed(true)}
      />
      <div className="relative w-full max-w-sm rounded-2xl bg-[#0d1f3c] text-white shadow-2xl border border-white/10 p-6 text-center">
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-3 right-3 text-white/40 hover:text-white transition-colors"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#CC5521]/15">
          <RefreshCw className="h-7 w-7 text-[#CC5521]" />
        </div>

        <h2 className="text-[18px] font-black leading-tight">Nova versão disponível</h2>
        <p className="mt-1.5 text-[13px] text-white/60 leading-snug">
          Tem melhoria nova prontinha. Atualize para usar a versão mais recente do sistema.
        </p>

        <button
          onClick={() => updateServiceWorker(true)}
          className="mt-5 w-full bg-[#CC5521] hover:brightness-110 text-white text-[14px] font-bold px-4 py-3 rounded-xl transition-all active:scale-95"
        >
          Atualizar agora
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="mt-2 w-full text-[13px] text-white/50 hover:text-white/80 py-2 transition-colors"
        >
          Agora não
        </button>
      </div>
    </div>
  )
}
