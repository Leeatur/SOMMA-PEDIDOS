import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Edit2, Search, Phone, MapPin, Upload } from 'lucide-react'
import { clientsApi, usersApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { Button } from '../components/ui/Button'
import { Input, MaskedInput, Textarea, Select } from '../components/ui/Input'
import { maskCnpj, maskCpf, maskPhone, maskCep } from '../utils/masks'
import { Modal } from '../components/ui/Modal'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { ClientsImportModal } from '../components/ui/ClientsImportModal'
import { NewClientModal } from '../components/ui/NewClientModal'

interface Client {
  id: string
  name: string
  trade_name: string | null
  cnpj: string | null
  cpf: string | null
  city: string | null
  state: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  address: string | null
  zip: string | null
  notes: string | null
  rep_id: string | null
  rep_name: string | null
}

interface User { id: string; name: string; role: string }

interface FormState {
  name: string
  trade_name: string
  cnpj: string
  cpf: string
  address: string
  city: string
  state: string
  zip: string
  phone: string
  whatsapp: string
  email: string
  rep_id: string
  notes: string
}

const emptyForm: FormState = {
  name: '', trade_name: '', cnpj: '', cpf: '',
  address: '', city: '', state: '', zip: '',
  phone: '', whatsapp: '', email: '', rep_id: '', notes: '',
}

export function Clients() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showNewCnpj, setShowNewCnpj] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<Partial<FormState>>({})

  const { data: clients, isLoading } = useQuery<Client[]>({
    queryKey: ['clients', search],
    queryFn: () => clientsApi.list(search || undefined).then((r) => r.data),
  })

  const { data: users } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then((r) => r.data),
    enabled: isAdmin,
  })

  const createMut = useMutation({
    mutationFn: (data: FormState) => clientsApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); closeModal() },
  })

  const updateMut = useMutation({
    mutationFn: (data: FormState) => clientsApi.update(editing!.id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); closeModal() },
  })

  function openEdit(c: Client) {
    setEditing(c)
    setForm({
      name: c.name, trade_name: c.trade_name || '',
      cnpj: maskCnpj(c.cnpj || ''), cpf: maskCpf(c.cpf || ''),
      address: c.address || '', city: c.city || '',
      state: c.state || '', zip: maskCep(c.zip || ''),
      phone: maskPhone(c.phone || ''), whatsapp: maskPhone(c.whatsapp || ''),
      email: c.email || '', rep_id: c.rep_id || '', notes: c.notes || '',
    })
    setErrors({})
    setOpen(true)
  }

  function closeModal() {
    setOpen(false)
    setEditing(null)
    setForm(emptyForm)
  }

  function validate() {
    const e: Partial<FormState> = {}
    if (!form.name.trim()) e.name = 'Nome é obrigatório'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit() {
    if (!validate()) return
    if (editing) updateMut.mutate(form)
    else createMut.mutate(form)
  }

  const f = (key: keyof FormState) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [key]: e.target.value }),
  })

  if (isLoading) return <PageSpinner />
  const list = clients || []

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-5 py-4 lg:px-8 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="flex-1">
            <Input
              placeholder="Buscar clientes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
            />
          </div>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-lg px-3 py-2 transition-colors whitespace-nowrap"
            title="Importar via Excel"
          >
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">Importar</span>
          </button>
          <button
            onClick={() => setShowNewCnpj(true)}
            className="flex items-center gap-1.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-2 transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Novo</span>
          </button>
        </div>
      </div>

      <div className="px-4 py-5 lg:px-8 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold text-gray-900">Clientes</h1>
          <span className="text-sm text-gray-500">{list.length} clientes</span>
        </div>

        {list.length === 0 ? (
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title="Nenhum cliente encontrado"
            description={search ? 'Tente ajustar a busca.' : 'Cadastre seu primeiro cliente ou importe via Excel.'}
            action={
              !search ? (
                <div className="flex gap-3">
                  <Button onClick={() => setShowImport(true)} variant="outline" icon={<Upload className="h-4 w-4" />}>
                    Importar Excel
                  </Button>
                  <Button onClick={() => setShowNewCnpj(true)} icon={<Plus className="h-4 w-4" />}>
                    Cadastrar Cliente
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* Cabeçalho da tabela */}
            <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[2fr_1fr_1fr_auto] lg:grid-cols-[2fr_1.2fr_1fr_1fr_auto] gap-0 border-b border-gray-200 bg-gray-50 px-4 py-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</span>
              <span className="hidden sm:block text-xs font-semibold text-gray-500 uppercase tracking-wide">Cidade</span>
              <span className="hidden sm:block text-xs font-semibold text-gray-500 uppercase tracking-wide">Telefone</span>
              <span className="hidden lg:block text-xs font-semibold text-gray-500 uppercase tracking-wide">CNPJ</span>
              <span />
            </div>

            {/* Linhas */}
            {list.map((c, idx) => (
              <div
                key={c.id}
                className={`grid grid-cols-[1fr_auto] sm:grid-cols-[2fr_1fr_1fr_auto] lg:grid-cols-[2fr_1.2fr_1fr_1fr_auto] gap-0 items-center px-4 py-3 hover:bg-indigo-50/40 transition-colors ${idx < list.length - 1 ? 'border-b border-gray-100' : ''}`}
              >
                {/* Nome */}
                <div className="min-w-0 pr-3">
                  <p className="font-semibold text-gray-900 text-sm truncate leading-tight">{c.name}</p>
                  {c.trade_name && c.trade_name !== c.name && (
                    <p className="text-xs text-gray-400 truncate leading-tight mt-0.5">{c.trade_name}</p>
                  )}
                  {/* No mobile, mostra cidade e telefone embaixo do nome */}
                  <div className="flex flex-wrap gap-2 mt-1 sm:hidden text-xs text-gray-400">
                    {(c.city || c.state) && (
                      <span className="flex items-center gap-0.5">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        {[c.city, c.state].filter(Boolean).join(' / ')}
                      </span>
                    )}
                    {c.phone && (
                      <span className="flex items-center gap-0.5">
                        <Phone className="h-3 w-3 flex-shrink-0" />
                        {c.phone}
                      </span>
                    )}
                    {c.cnpj && <span className="text-gray-300">{c.cnpj}</span>}
                  </div>
                </div>

                {/* Cidade/UF — sm+ */}
                <div className="hidden sm:flex items-center gap-1 min-w-0 pr-2">
                  {(c.city || c.state) ? (
                    <span className="text-sm text-gray-600 truncate">
                      {[c.city, c.state].filter(Boolean).join(' / ')}
                    </span>
                  ) : (
                    <span className="text-gray-300 text-sm">—</span>
                  )}
                </div>

                {/* Telefone — sm+ */}
                <div className="hidden sm:flex items-center gap-1 min-w-0 pr-2">
                  {c.phone ? (
                    <span className="text-sm text-gray-600 truncate">{c.phone}</span>
                  ) : (
                    <span className="text-gray-300 text-sm">—</span>
                  )}
                </div>

                {/* Representante — lg+ */}
                <div className="hidden lg:block min-w-0 pr-2">
                  {(c as any).rep_name ? (
                    <span className="text-xs text-indigo-500 font-medium truncate">{(c as any).rep_name}</span>
                  ) : (
                    <span className="text-gray-300 text-sm">—</span>
                  )}
                </div>

                {/* Editar */}
                <button
                  onClick={() => openEdit(c)}
                  className="p-1.5 text-gray-300 hover:text-indigo-500 hover:bg-indigo-100 rounded-lg transition-colors flex-shrink-0"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={closeModal}
        title={editing ? 'Editar Cliente' : 'Novo Cliente'}
        size="lg"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={closeModal}>Cancelar</Button>
            <Button
              onClick={handleSubmit}
              loading={createMut.isPending || updateMut.isPending}
            >
              {editing ? 'Salvar' : 'Cadastrar'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Input label="Razão Social / Nome *" {...f('name')} error={errors.name} autoFocus />
            </div>
            <div className="col-span-2">
              <Input label="Nome Fantasia" {...f('trade_name')} />
            </div>
            <MaskedInput label="CNPJ" mask="cnpj" value={form.cnpj} onChangeValue={v => setForm(p => ({ ...p, cnpj: v }))} />
            <MaskedInput label="CPF" mask="cpf" value={form.cpf} onChangeValue={v => setForm(p => ({ ...p, cpf: v }))} />
            <MaskedInput label="Telefone" mask="phone" value={form.phone} onChangeValue={v => setForm(p => ({ ...p, phone: v }))} />
            <MaskedInput label="WhatsApp" mask="phone" value={form.whatsapp} onChangeValue={v => setForm(p => ({ ...p, whatsapp: v }))} />
            <Input label="E-mail" {...f('email')} type="email" />
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Endereço</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Input label="Endereço" {...f('address')} />
              </div>
              <MaskedInput label="CEP" mask="cep" value={form.zip} onChangeValue={v => setForm(p => ({ ...p, zip: v }))} />
              <Input label="Cidade" {...f('city')} />
              <Input label="Estado" {...f('state')} placeholder="SP" maxLength={2} onChange={e => setForm(p => ({ ...p, state: e.target.value.toUpperCase().slice(0, 2) }))} />
            </div>
          </div>

          {isAdmin && (
            <Select
              label="Representante"
              value={form.rep_id}
              onChange={e => setForm(p => ({ ...p, rep_id: e.target.value }))}
              options={(users || [])
                .filter(u => u.role === 'representante' || u.role === 'admin')
                .map(u => ({ value: u.id, label: u.name + (u.role === 'admin' ? ' (admin)' : '') }))}
              placeholder="Sem representante vinculado"
            />
          )}

          <Textarea label="Observações" {...f('notes')} rows={2} />
        </div>
      </Modal>

      {/* Modal importar Excel */}
      <ClientsImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
      />

      {/* Modal novo cliente com CNPJ da Receita */}
      <NewClientModal
        open={showNewCnpj}
        onClose={() => setShowNewCnpj(false)}
        onCreated={() => {
          setShowNewCnpj(false)
          qc.invalidateQueries({ queryKey: ['clients'] })
        }}
      />
    </div>
  )
}
