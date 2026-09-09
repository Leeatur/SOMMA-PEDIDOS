import { Request, Response, NextFunction } from 'express'

// Campos que NÃO devem ser convertidos para maiúsculas
const SKIP_EXACT = new Set([
  // Contato / documento
  'email', 'password', 'senha',
  'cnpj', 'cpf', 'cep', 'zip',
  'phone', 'whatsapp', 'telefone', 'celular', 'tel', 'mobile',
  // Visual / técnico
  'color', 'slug',
  // Enums / discriminadores — nunca converter (quebra CHECK constraints e comparações)
  'type', 'status', 'role', 'op',
])

function shouldSkip(key: string): boolean {
  const k = key.toLowerCase()
  if (SKIP_EXACT.has(k)) return true
  // Sufixos técnicos
  if (
    k.endsWith('_id')     || // UUIDs / chaves estrangeiras
    k.endsWith('_url')    || // URLs
    k.endsWith('_token')  ||
    k.endsWith('_key')    ||
    k.endsWith('_hash')   ||
    k.endsWith('_secret') ||
    k.endsWith('_type')   || // variant_type, freight_type, etc.
    k.endsWith('_status') ||
    k.endsWith('_role')   ||
    k.endsWith('_pct')    || // percentuais numéricos enviados como string
    k.endsWith('_order')     // sort_order
  ) return true
  if (k.includes('password') || k.includes('token') || k.includes('secret')) return true
  if (k.includes('_url') || k.startsWith('url')) return true
  return false
}

function uppercaseValue(key: string, value: unknown): unknown {
  if (shouldSkip(key)) return value
  if (typeof value === 'string') return value.toUpperCase()
  if (Array.isArray(value)) return value.map(item => uppercaseObj(item))
  if (value && typeof value === 'object') return uppercaseObj(value as Record<string, unknown>)
  return value
}

function uppercaseObj(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = uppercaseValue(key, val)
  }
  return result
}

export function uppercaseBody(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object') {
    req.body = uppercaseObj(req.body)
  }
  next()
}
