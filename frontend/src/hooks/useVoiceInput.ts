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
    dezesseis: '16', dezessete: '17', dezoito: '18', dezenove: '19',
    vinte: '20',
  }
  return map[word.toLowerCase()] ?? word
}

/**
 * Normaliza aliases de letras faladas em português para os tamanhos reais.
 * Ex: "pê" → "P", "gê gê" → "GG", "extra grande" → "XG"
 */
function normalizeLetterSizes(text: string): string {
  return text
    // multi-token aliases primeiro (ordem importa)
    .replace(/extra\s+extra\s+grande/gi, 'EXG')
    .replace(/extra\s+grande/gi, 'XG')
    .replace(/gê\s+gê/gi, 'GG')
    .replace(/g\s+g/gi, 'GG')
    .replace(/x\s+g/gi, 'XG')
    .replace(/e\s+x\s+g/gi, 'EXG')
    // single-token aliases
    .replace(/\bpê\b/gi, 'P')
    .replace(/\bpe\b/gi, 'P')
    .replace(/\beme\b/gi, 'M')
    .replace(/\bgê\b/gi, 'G')
    .replace(/\bge\b/gi, 'G')
}

/**
 * Converte números por extenso em português para dígitos — cobre a faixa de
 * tamanhos de roupa (20–60) que o ptWordToNum não trata.
 * Compostos ANTES dos simples para evitar substituição parcial:
 *   "quarenta e dois" → "42"  antes de  "quarenta" → "40"
 */
function normalizeNumberPhrases(text: string): string {
  return text
    // 50s
    .replace(/cinquenta\s+e\s+oito/gi,   '58')
    .replace(/cinquenta\s+e\s+seis/gi,   '56')
    .replace(/cinquenta\s+e\s+quatro/gi, '54')
    .replace(/cinquenta\s+e\s+duas?/gi,  '52')
    .replace(/cinquenta\s+e\s+um[ao]?/gi,'51')
    .replace(/\bcinquenta\b/gi,          '50')
    // 40s
    .replace(/quarenta\s+e\s+oito/gi,   '48')
    .replace(/quarenta\s+e\s+seis/gi,   '46')
    .replace(/quarenta\s+e\s+quatro/gi, '44')
    .replace(/quarenta\s+e\s+tr[êe]s/gi,'43')
    .replace(/quarenta\s+e\s+duas?/gi,  '42')
    .replace(/quarenta\s+e\s+um[ao]?/gi,'41')
    .replace(/\bquarenta\b/gi,          '40')
    // 30s
    .replace(/trinta\s+e\s+oito/gi,   '38')
    .replace(/trinta\s+e\s+seis/gi,   '36')
    .replace(/trinta\s+e\s+quatro/gi, '34')
    .replace(/trinta\s+e\s+duas?/gi,  '32')
    .replace(/trinta\s+e\s+um[ao]?/gi,'31')
    .replace(/\btrinta\b/gi,          '30')
    // 20s (tamanho infantil)
    .replace(/vinte\s+e\s+oito/gi,   '28')
    .replace(/vinte\s+e\s+seis/gi,   '26')
    .replace(/vinte\s+e\s+quatro/gi, '24')
    .replace(/vinte\s+e\s+duas?/gi,  '22')
    .replace(/\bvinte\b/gi,          '20')
    // 60s
    .replace(/\bsessenta\b/gi, '60')
}

/**
 * Recebe o texto reconhecido e os tamanhos disponíveis do produto.
 * Retorna mapa { tamanho: quantidade }.
 * Ex: "36 dois 38 três 40 um" → { "36": 2, "38": 3, "40": 1 }
 * Ex: "P dois M três G quatro" → { "P": 2, "M": 3, "G": 4 }
 */
export function parseGradeFromSpeech(
  text: string,
  availableSizes: string[],
): Record<string, number> {
  // Normaliza números por extenso (quarenta→40, trinta e seis→36 etc.)
  // ANTES de letras, para evitar conflito com aliases
  const normalized = normalizeLetterSizes(normalizeNumberPhrases(text))

  // Tokeniza: remove pontuação, substitui palavras numéricas
  const tokens = normalized
    .toLowerCase()
    .replace(/[,.;:]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(ptWordToNum)

  const sizesUpper = availableSizes.map(s => s.toUpperCase())
  const result: Record<string, number> = {}

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].toUpperCase()
    // Verifica se o token corresponde a um tamanho disponível
    const matchedIdx = sizesUpper.findIndex(s => s === tok)
    if (matchedIdx >= 0 && i + 1 < tokens.length) {
      const nextTok = tokens[i + 1]
      // Se o próximo token é ele mesmo um tamanho, não usa como quantidade
      const nextIsSize = sizesUpper.some(s => s === nextTok.toUpperCase())
      if (!nextIsSize) {
        const qty = parseInt(nextTok)
        if (!isNaN(qty) && qty > 0 && qty <= 99) {
          result[availableSizes[matchedIdx]] = qty
          i++ // pula o token de quantidade
        }
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
