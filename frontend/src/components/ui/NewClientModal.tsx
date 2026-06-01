import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Phone,
  Mail,
  MessageCircle,
  Building2,
  MapPin,
  User,
} from 'lucide-react'
import { clientsApi } from '../../api/client'
import { maskCnpj, maskPhone, maskCep } from '../../utils/masks'
import { Modal } from './Modal'
import { Button } from './Button'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (client: CreatedClient) => void
}

export interface CreatedClient {
  id: string
  name: string
  trade_name: string | null
  city: string | null
  cnpj: string | null
  phone: string | null
}

interface FormData {
  cnpj: string
  name: string
  trade_name: string
  state_registration: string
  email: string
  phone: string
  whatsapp: string
  address: string
  city: string
  state: string
  zip: string
  notes: string
}

// Tarja amarela de confirmação para campos preenchidos pela Receita
function ConfirmTag() {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 ml-1">
      <AlertTriangle className="h-3 w-3" />
      Confirme
    </span>
  )
}

// Formata DDD + fone retornados pela Receita (ex: "11 1234-5678")
function formatReceitaPhone(raw: string): string {
  return maskPhone(raw)
}

export function NewClientModal({ open, onClose, onCreated }: Props) {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormData>({
    cnpj: '', name: '', trade_name: '', state_registration: '', email: '',
    phone: '', whatsapp: '', address: '', city: '',
    state: '', zip: '', notes: '',
  })
  const [cnpjInput, setCnpjInput] = useState('')
  const [loadingCnpj, setLoadingCnpj] = useState(false)
  const [cnpjError, setCnpjError] = useState('')
  const [cnpjFound, setCnpjFound] = useState(false)
  // Campos preenchidos pela Receita que precisam de confirmação
  // Telefone, WhatsApp e E-mail sempre pedem confirmação
  const [needsConfirm, setNeedsConfirm] = useState<Set<string>>(
    new Set(['phone', 'whatsapp', 'email'])
  )
  const [errors, setErrors] = useState<Partial<FormData>>({})

  function set(field: keyof FormData, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    // Se o rep editou um campo auto-preenchido, remove a tarja
    setNeedsConfirm(prev => { const s = new Set(prev); s.delete(field); return s })
    if (errors[field]) setErrors(e => ({ ...e, [field]: '' }))
  }

  async function lookupCnpj() {
    const digits = cnpjInput.replace(/\D/g, '')
    if (digits.length !== 14) {
      setCnpjError('CNPJ deve ter 14 dígitos')
      return
    }
    setLoadingCnpj(true)
    setCnpjError('')
    setCnpjFound(false)
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`)
      if (!res.ok) throw new Error('CNPJ não encontrado na Receita Federal')
      const data = await res.json()

      const phone1 = formatReceitaPhone(data.ddd_telefone_1 || '')
      const addressFull = [
        data.logradouro,
        data.numero,
        data.complemento,
        data.bairro,
      ].filter(Boolean).join(', ')

      const newForm: Partial<FormData> = {
        cnpj: maskCnpj(digits),
        name: data.razao_social || '',
        trade_name: data.nome_fantasia || '',
        address: addressFull,
        city: data.municipio || '',
        state: data.uf || '',
        zip: maskCep(data.cep || ''),
      }

      if (phone1) newForm.phone = phone1
      if (data.email) newForm.email = data.email

      setForm(f => ({ ...f, ...newForm }))
      // Mantém todos os 3 campos de contato com âmbar após busca da Receita
      setNeedsConfirm(new Set(['phone', 'whatsapp', 'email']))
      setCnpjFound(true)
    } catch (e: any) {
      setCnpjError(e.message || 'Erro ao consultar Receita Federal')
    } finally {
      setLoadingCnpj(false)
    }
  }

  const createMut = useMutation({
    mutationFn: () => clientsApi.create({
      name: form.name,
      trade_name: form.trade_name || undefined,
      cnpj: form.cnpj || undefined,
      state_registration: form.state_registration || undefined,
      address: form.address || undefined,
      city: form.city || undefined,
      state: form.state || undefined,
      zip: form.zip || undefined,
      phone: form.phone || undefined,
      whatsapp: form.whatsapp || undefined,
      email: form.email || undefined,
      notes: form.notes || undefined,
    } as any),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      onCreated(res.data)
      handleClose()
    },
  })

  function validate(): boolean {
    const e: Partial<FormData> = {}
    if (!form.name.trim()) e.name = 'Nome é obrigatório'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit() {
    if (validate()) createMut.mutate()
  }

  function handleClose() {
    setForm({ cnpj: '', name: '', trade_name: '', state_registration: '', email: '', phone: '', whatsapp: '', address: '', city: '', state: '', zip: '', notes: '' })
    setCnpjInput('')
    setCnpjError('')
    setCnpjFound(false)
    setNeedsConfirm(new Set(['phone', 'whatsapp', 'email']))
    setErrors({})
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Novo Cliente" size="lg">
      <div className="space-y-1.5">

        {/* ── CNPJ Lookup ── */}
        <div className="bg-primary/5 border border-blue-100 rounded-xl p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-blue-800">
            <Building2 className="h-4 w-4" />
            Buscar dados na Receita Federal
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={cnpjInput}
              onChange={e => setCnpjInput(maskCnpj(e.target.value))}
              onKeyDown={e => e.key === 'Enter' && lookupCnpj()}
              placeholder="00.000.000/0001-00"
              maxLength={18}
              className="flex-1 px-3 py-1 text-[12px] border border-blue-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-outline/70"
            />
            <button
              type="button"
              onClick={lookupCnpj}
              disabled={loadingCnpj}
              className="flex items-center gap-1.5 px-4 py-1 bg-primary text-white text-[12px] font-semibold rounded-lg hover:bg-primary disabled:opacity-60 transition-colors"
            >
              {loadingCnpj
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Search className="h-4 w-4" />}
              Buscar
            </button>
          </div>
          {cnpjError && (
            <p className="text-[12px] text-red-600 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> {cnpjError}
            </p>
          )}
          {cnpjFound && (
            <p className="text-[12px] text-emerald-700 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Dados encontrados! Verifique os campos destacados.
            </p>
          )}
        </div>

        {/* ── Dados da empresa ── */}
        <div className="space-y-1.5">
          <p className="text-[12px] font-semibold text-outline uppercase tracking-wide flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" /> Identificação
          </p>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-on-surface-variant mb-1">
                Razão Social / Nome <span className="text-red-500">*</span>
              </label>
              <input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                className={`w-full px-3 py-1 text-[12px] border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 ${errors.name ? 'border-red-400' : 'border-outline-variant'}`}
              />
              {errors.name && <p className="text-[12px] text-red-500 mt-0.5">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-[12px] font-medium text-on-surface-variant mb-1">Nome Fantasia</label>
              <input
                value={form.trade_name}
                onChange={e => set('trade_name', e.target.value)}
                className="w-full px-3 py-1 text-[12px] border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-on-surface-variant mb-1">CNPJ</label>
                <input
                  value={form.cnpj}
                  onChange={e => set('cnpj', maskCnpj(e.target.value))}
                  maxLength={18}
                  placeholder="00.000.000/0001-00"
                  className="w-full px-3 py-1 text-[12px] border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-on-surface-variant mb-1">Insc. Estadual</label>
                <input
                  value={form.state_registration}
                  onChange={e => set('state_registration', e.target.value)}
                  placeholder="000.000.000.000"
                  className="w-full px-3 py-1 text-[12px] border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Contato ── */}
        <div className="space-y-1.5">
          <p className="text-[12px] font-semibold text-outline uppercase tracking-wide flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" /> Contato
          </p>

          {/* Telefone */}
          <div>
            <label className="block text-[12px] font-medium text-on-surface-variant mb-1 flex items-center">
              <Phone className="h-3.5 w-3.5 mr-1 text-outline/70" />
              Telefone
              {needsConfirm.has('phone') && <ConfirmTag />}
            </label>
            <input
              value={form.phone}
              onChange={e => set('phone', maskPhone(e.target.value))}
              placeholder="(00) 00000-0000"
              className={`w-full px-3 py-1 text-[12px] border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 ${needsConfirm.has('phone') ? 'border-amber-300 bg-amber-50' : 'border-outline-variant'}`}
            />
          </div>

          {/* WhatsApp */}
          <div>
            <label className="block text-[12px] font-medium text-on-surface-variant mb-1 flex items-center">
              <MessageCircle className="h-3.5 w-3.5 mr-1 text-emerald-500" />
              WhatsApp
              {needsConfirm.has('whatsapp') && <ConfirmTag />}
            </label>
            <input
              value={form.whatsapp}
              onChange={e => set('whatsapp', maskPhone(e.target.value))}
              placeholder="(00) 00000-0000"
              className={`w-full px-3 py-1 text-[12px] border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 ${needsConfirm.has('whatsapp') ? 'border-amber-300 bg-amber-50' : 'border-outline-variant'}`}
            />
          </div>

          {/* E-mail */}
          <div>
            <label className="block text-[12px] font-medium text-on-surface-variant mb-1 flex items-center">
              <Mail className="h-3.5 w-3.5 mr-1 text-blue-400" />
              E-mail
              {needsConfirm.has('email') && <ConfirmTag />}
            </label>
            <input
              value={form.email}
              onChange={e => set('email', e.target.value)}
              type="email"
              placeholder="contato@empresa.com.br"
              className={`w-full px-3 py-1 text-[12px] border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 ${needsConfirm.has('email') ? 'border-amber-300 bg-amber-50' : 'border-outline-variant'}`}
            />
          </div>
        </div>

        {/* ── Endereço ── */}
        <div className="space-y-1.5">
          <p className="text-[12px] font-semibold text-outline uppercase tracking-wide flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> Endereço
          </p>
          <div>
            <label className="block text-[12px] font-medium text-on-surface-variant mb-1">Logradouro</label>
            <input
              value={form.address}
              onChange={e => set('address', e.target.value)}
              placeholder="Rua, número, complemento, bairro"
              className="w-full px-3 py-1 text-[12px] border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-on-surface-variant mb-1">Cidade</label>
              <input
                value={form.city}
                onChange={e => set('city', e.target.value)}
                className="w-full px-3 py-1 text-[12px] border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-on-surface-variant mb-1">UF</label>
              <input
                value={form.state}
                onChange={e => set('state', e.target.value.toUpperCase().slice(0, 2))}
                placeholder="SP"
                maxLength={2}
                className="w-full px-3 py-1 text-[12px] border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-on-surface-variant mb-1">CEP</label>
            <input
              value={form.zip}
              onChange={e => set('zip', maskCep(e.target.value))}
              placeholder="00000-000"
              maxLength={9}
              className="w-full px-3 py-1 text-[12px] border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>

        {/* ── Observações ── */}
        <div>
          <label className="block text-[12px] font-medium text-on-surface-variant mb-1">Observações</label>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            rows={2}
            className="w-full px-3 py-1 text-[12px] border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
        </div>

        {/* ── Ações ── */}
        {createMut.isError && (
          <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-1">
            Erro ao salvar cliente. Tente novamente.
          </p>
        )}
        <div className="flex gap-3 pt-1">
          <Button variant="ghost" className="flex-1" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            className="flex-1"
            onClick={handleSubmit}
            loading={createMut.isPending}
          >
            Salvar e Selecionar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
