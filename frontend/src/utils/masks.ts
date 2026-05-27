/**
 * Funções de máscara para campos de entrada.
 * Retornam sempre a string formatada — use no onChange do input.
 * Para enviar ao backend, chame stripeNonDigits() ou use o valor bruto.
 */

export function stripDigits(v: string) {
  return v.replace(/\D/g, '')
}

/** CNPJ: 00.000.000/0001-00 */
export function maskCnpj(v: string): string {
  const d = stripDigits(v).slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

/** CPF: 000.000.000-00 */
export function maskCpf(v: string): string {
  const d = stripDigits(v).slice(0, 11)
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2')
}

/** Telefone fixo ou celular: (00) 0000-0000 ou (00) 00000-0000 */
export function maskPhone(v: string): string {
  const d = stripDigits(v).slice(0, 11)
  if (d.length <= 10)
    return d
      .replace(/^(\d{0,2})/, '($1')
      .replace(/^\((\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d{0,4})$/, '$1-$2')
  return d
    .replace(/^(\d{0,2})/, '($1')
    .replace(/^\((\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{0,4})$/, '$1-$2')
}

/** CEP: 00000-000 */
export function maskCep(v: string): string {
  const d = stripDigits(v).slice(0, 8)
  return d.replace(/^(\d{5})(\d)/, '$1-$2')
}

/**
 * Moeda brasileira para exibição: 1234.56 → "1.234,56"
 * Usado em textos/tabelas, não em inputs.
 */
export function fmtCurrency(v: number | string | null | undefined): string {
  const n = Number(v)
  if (isNaN(n)) return '0,00'
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Máscara de decimal para input de moeda/percentual.
 * Aceita dígitos e vírgula/ponto — formata como "1.234,56".
 * Retorna o valor formatado. Para obter o número: parseDecimal().
 */
export function maskDecimal(v: string, maxDecimals = 2): string {
  // Remove tudo exceto dígitos e vírgula/ponto
  let raw = v.replace(/[^\d,\.]/g, '').replace('.', ',')
  // Só permite uma vírgula
  const parts = raw.split(',')
  if (parts.length > 2) raw = parts[0] + ',' + parts.slice(1).join('')
  const [intPart, decPart] = raw.split(',')
  // Formata parte inteira com pontos de milhar
  const intFormatted = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  if (raw.includes(',')) {
    return intFormatted + ',' + (decPart || '').slice(0, maxDecimals)
  }
  return intFormatted
}

/**
 * Converte string formatada ("1.234,56") para número.
 */
export function parseDecimal(v: string): number {
  return parseFloat(v.replace(/\./g, '').replace(',', '.')) || 0
}

/**
 * Máscara de percentual: aceita até 2 casas decimais, ex: "12,50"
 */
export function maskPercent(v: string): string {
  return maskDecimal(v, 2)
}
