import * as XLSX from 'xlsx'

export interface ImportedClient {
  name: string
  trade_name: string
  cnpj: string
  cpf: string
  state_registration: string
  phone: string
  whatsapp: string
  email: string
  address: string
  city: string
  state: string
  zip: string
  notes: string
}

export interface ClientImportPreview {
  headers: string[]
  mapping: Record<string, string>   // campo → coluna detectada
  rows: ImportedClient[]
  totalRows: number
  sampleRaw: string[][]             // primeiras 5 linhas brutas para preview
}

// Mapeamento de nomes de coluna → campo interno
// Suporta variações comuns de exportação de CRMs e planilhas brasileiras
const COLUMN_MAP: Record<string, string[]> = {
  name: [
    'razão social', 'razao social', 'nome', 'cliente', 'empresa',
    'name', 'company', 'cliente/fornecedor', 'nome do cliente',
  ],
  trade_name: [
    'nome fantasia', 'fantasia', 'apelido', 'trade name', 'nome comercial',
  ],
  cnpj: ['cnpj', 'cnpj/cpf', 'cpf/cnpj', 'documento', 'doc'],
  cpf:  ['cpf'],
  state_registration: [
    'insc. estadual', 'inscricao estadual', 'inscrição estadual',
    'ie', 'i.e.', 'insc estadual', 'rg', 'inscr. estadual',
  ],
  phone: [
    'telefone', 'fone', 'tel', 'phone', 'telefone fixo', 'tel. fixo',
    'telefone 1', 'tel1', 'fone 1', 'contato',
  ],
  whatsapp: [
    'whatsapp', 'wpp', 'zap', 'celular', 'cel', 'mobile',
    'telefone 2', 'tel2', 'telefone adicional',
  ],
  email: [
    'e-mail', 'email', 'e mail', 'correio eletrônico', 'correio eletronico',
    'e-mail principal',
  ],
  address: [
    'endereço', 'endereco', 'logradouro', 'rua', 'address',
    'endereço completo', 'endereco completo',
  ],
  // Campo especial: número do endereço (será concatenado ao endereço)
  address_number: [
    'número', 'numero', 'num', 'nº', 'n°', 'no.',
  ],
  // Bairro pode complementar o endereço
  neighborhood: [
    'bairro', 'district', 'neighborhood',
  ],
  city:  ['cidade', 'municipio', 'município', 'city'],
  state: ['estado', 'uf', 'state', 'região', 'regiao'],
  zip:   ['cep', 'zip', 'código postal', 'codigo postal'],
  notes: [
    'obs', 'observação', 'observacoes', 'observações',
    'notes', 'nota', 'anotações', 'anotacoes',
  ],
}

function normalizeHeader(h: string): string {
  return String(h || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

function detectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  const normalized = headers.map(normalizeHeader)

  for (const [field, synonyms] of Object.entries(COLUMN_MAP)) {
    for (const syn of synonyms) {
      const idx = normalized.findIndex((h) => h === syn || h.startsWith(syn))
      if (idx >= 0 && !Object.values(mapping).includes(headers[idx])) {
        mapping[field] = headers[idx]
        break
      }
    }
  }
  return mapping
}

/**
 * Detecta se a planilha tem uma linha de título antes dos cabeçalhos reais.
 * Isso acontece quando a linha 0 tem apenas 1 célula preenchida
 * (ex: ["Clientes","","","",…]).
 * Retorna o índice da linha de cabeçalho (0 ou 1).
 */
function detectHeaderRow(rawMatrix: string[][]): number {
  if (!rawMatrix[0]) return 0
  const nonEmpty = rawMatrix[0].filter((v) => String(v).trim() !== '').length
  // Se a linha 0 tem só 1 valor preenchido, ela é título; cabeçalhos na linha 1
  if (nonEmpty <= 1 && rawMatrix[1] && rawMatrix[1].some((v) => String(v).trim() !== '')) {
    return 1
  }
  return 0
}

function cleanCnpj(v: string): string {
  return String(v || '').replace(/\D/g, '').slice(0, 14)
}

function cleanPhone(v: string): string {
  return String(v || '').replace(/\D/g, '').slice(0, 11)
}

function formatCnpjDisplay(v: string): string {
  const d = cleanCnpj(v)
  if (d.length === 14)
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11)
    return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d
}

function formatPhoneDisplay(v: string): string {
  const d = cleanPhone(v)
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  return String(v || '').trim() // mantém original se não reconhecer o padrão
}

function rowToClient(
  row: Record<string, unknown>,
  mapping: Record<string, string>
): ImportedClient {
  function get(field: string): string {
    const col = mapping[field]
    if (!col) return ''
    return String(row[col] ?? '').trim()
  }

  // Combina Endereço + Número + Bairro
  const addrBase   = get('address')
  const addrNum    = get('address_number')
  const addrNeigh  = get('neighborhood')
  let fullAddress  = addrBase
  if (addrNum)   fullAddress = `${fullAddress}, ${addrNum}`.trim().replace(/^,\s*/, '')
  if (addrNeigh) fullAddress = `${fullAddress} — ${addrNeigh}`.trim().replace(/^\s*—\s*/, '')

  const cnpjRaw   = get('cnpj')
  const cpfRaw    = get('cpf')
  const cnpjDigits = cleanCnpj(cnpjRaw)
  const isCpf     = cnpjDigits.length === 11

  return {
    name:               get('name'),
    trade_name:         get('trade_name'),
    cnpj:               isCpf ? '' : formatCnpjDisplay(cnpjRaw),
    cpf:                isCpf ? formatCnpjDisplay(cnpjRaw) : (cpfRaw ? formatCnpjDisplay(cpfRaw) : ''),
    state_registration: get('state_registration'),
    phone:              formatPhoneDisplay(get('phone')),
    whatsapp:           formatPhoneDisplay(get('whatsapp')),
    email:              get('email').toLowerCase(),
    address:            fullAddress,
    city:               get('city'),
    state:              get('state').toUpperCase().slice(0, 2),
    zip:                get('zip').replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2'),
    notes:              get('notes'),
  }
}

/**
 * Lê planilha Excel e retorna pré-visualização com auto-detecção:
 * - Linha de título antes dos cabeçalhos (ex: "Clientes" na linha 1)
 * - Mapeamento automático de colunas por sinônimos em PT/EN
 * - Combinação de Endereço + Número + Bairro
 */
export function previewClientsExcel(filePath: string): ClientImportPreview {
  const wb    = XLSX.readFile(filePath)
  const ws    = wb.Sheets[wb.SheetNames[0]]
  const rawMatrix = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][]

  if (!rawMatrix.length) {
    return { headers: [], mapping: {}, rows: [], totalRows: 0, sampleRaw: [] }
  }

  const headerRowIdx = detectHeaderRow(rawMatrix)
  const headers      = rawMatrix[headerRowIdx].map((h) => String(h).trim()).filter(Boolean)

  // Reconstrói sheet_to_json apontando para a linha correta de cabeçalho
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval:   '',
    range:    headerRowIdx,   // começa a ler a partir da linha de cabeçalho
  })

  const mapping = detectMapping(headers)
  const rows    = data
    .map((r) => rowToClient(r, mapping))
    .filter((c) => c.name.trim().length > 0)

  // Preview bruto: cabeçalho + até 4 linhas de dados
  const sampleRaw = rawMatrix.slice(headerRowIdx, headerRowIdx + 5)

  return {
    headers,
    mapping,
    rows:      rows.slice(0, 5),
    totalRows: rows.length,
    sampleRaw,
  }
}

/**
 * Importa todos os clientes da planilha usando o mapeamento confirmado pelo usuário.
 */
export function importClientsExcel(
  filePath: string,
  mapping: Record<string, string>
): ImportedClient[] {
  const wb    = XLSX.readFile(filePath)
  const ws    = wb.Sheets[wb.SheetNames[0]]
  const rawMatrix = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][]
  const headerRowIdx = detectHeaderRow(rawMatrix)

  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: '',
    range:  headerRowIdx,
  })

  return data
    .map((r) => rowToClient(r, mapping))
    .filter((c) => c.name.trim().length > 0)
}
