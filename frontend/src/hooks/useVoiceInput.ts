import { useState, useRef } from 'react'

export type VoiceStatus = 'idle' | 'listening' | 'unsupported'

interface UseVoiceInputOptions {
  onResult: (text: string) => void
  lang?: string
}

export function useVoiceInput({ onResult, lang = 'pt-BR' }: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceStatus>(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    return SR ? 'idle' : 'unsupported'
  })
  const recRef = useRef<any>(null)

  const start = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { setStatus('unsupported'); return }

    const rec = new SR()
    rec.lang = lang
    rec.interimResults = false
    rec.maxAlternatives = 3

    rec.onresult = (e: any) => {
      // Pega a transcrição com maior confiança
      const transcript = e.results[0][0].transcript as string
      setStatus('idle')
      onResult(transcript.trim())
    }

    rec.onerror = () => setStatus('idle')
    rec.onend = () => setStatus('idle')

    rec.start()
    recRef.current = rec
    setStatus('listening')
  }

  const stop = () => {
    recRef.current?.stop()
    setStatus('idle')
  }

  const toggle = () => {
    if (status === 'listening') stop()
    else start()
  }

  return { status, toggle, stop }
}

// ─── Utilitários de parsing ───────────────────────────────────────────────────

/** Converte palavras numéricas em português para dígitos */
function ptWordToNum(word: string): string {
  const map: Record<string, string> = {
    um: '1', uma: '1',
    dois: '2', duas: '2',
    'três': '3', tres: '3',
    quatro: '4',
    cinco: '5',
    seis: '6',
    sete: '7',
    oito: '8',
    nove: '9',
    dez: '10',
    onze: '11',
    doze: '12',
    treze: '13',
    catorze: '14', quatorze: '14',
    quinze: '15',
  }
  return map[word.toLowerCase()] ?? word
}

/**
 * Recebe o texto reconhecido e os tamanhos disponíveis do produto.
 * Retorna mapa { tamanho: quantidade }.
 * Ex: "36 dois 38 três 40 um" → { "36": 2, "38": 3, "40": 1 }
 */
export function parseGradeFromSpeech(
  text: string,
  availableSizes: string[],
): Record<string, number> {
  // Normaliza: remove pontuação, substitui palavras numéricas
  const tokens = text
    .toLowerCase()
    .replace(/[,.;:]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(ptWordToNum)

  const sizesUpper = availableSizes.map(s => s.toUpperCase())
  const result: Record<string, number> = {}

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].toUpperCase()
    // Verifica se o token é um tamanho disponível
    const matched = sizesUpper.find(s => s === tok)
    if (matched && i + 1 < tokens.length) {
      const qty = parseInt(tokens[i + 1])
      if (!isNaN(qty) && qty > 0 && qty <= 999) {
        result[availableSizes[sizesUpper.indexOf(matched)]] = qty
        i++ // pula o token de quantidade
      }
    }
  }

  return result
}

/**
 * Limpa o texto da referência falada:
 * remove espaços, converte para maiúsculas.
 * "te 1 2 3 4 5" → "TE12345"
 */
export function parseReferenceFromSpeech(text: string): string {
  return text.toUpperCase().replace(/\s+/g, '').trim()
}
