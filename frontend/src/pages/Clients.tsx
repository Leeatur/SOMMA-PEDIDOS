import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Edit2, Search, Upload } from 'lucide-react'
import { ColumnDef, ColumnConfigButton, useColumnConfig } from '../components/ui/ColumnConfig'
import { clientsApi, usersApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { Button } from '../components/ui/Button'
import { Input, MaskedInput, Textarea, Select } from '../components/ui/Input'
import { maskCnpj, maskCpf, maskPhone, maskCep } from '../utils/masks'
import { Modal } from '../components/ui/Modal'
import { PageSpinner } from '../components/ui/Spinner'
import { ClientsImportModal } from '../components/ui/ClientsImportModal'
import { NewClientModal } from '../components/ui/NewClientModal'

interface Client {
  id: string
  name: string
  trade_name: string | null
  cnpj: string | null
  cpf: string | null
  state_registration: string | null
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
  state_registration: string
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
  name: '', trade_name: '', cnpj: '', cpf: '', state_registration: '',
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
      state_registration: c.state_registration || '',
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

  // Column config — rep only shown for admins
  const CLIENT_COL_DEFS: ColumnDef[] = [
    { id: 'name',       label: 'Nome',         alwaysVisible: true },
    { id: 'trade_name', label: 'Nome Fantasia', defaultVisible: false },
    { id: 'city',       label: 'Cidade / UF' },
    { id: 'phone',      label: 'Telefone' },
    { id: 'whatsapp',   label: 'WhatsApp',      defaultVisible: false },
    { id: 'email',      label: 'E-mail',        defaultVisible: false },
    { id: 'cnpj',       label: 'CNPJ',          defaultVisible: false },
    ...(isAdmin ? [{ id: 'rep', label: 'Representante' } as ColumnDef] : []),
    { id: '_edit',      label: '',             alwaysVisible: true },
  ]

  const { orderedDefs, config, save, reset } = useColumnConfig('clients', CLIENT_COL_DEFS)
  const visibleCols = orderedDefs.filter(c => c.visible)

  const renderClientCell = (id: string, c: Client) => {
    switch (id) {
      case 'name':
        return (
          <td key={id} className="pl-3 pr-2 py-2.5 max-w-[220px]">
            <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
          </td>
        )
      case 'trade_name':
        return (
          <td key={id} className="px-2 py-2.5 max-w-[180px]">
            <span className="text-xs text-gray-500 truncate block">
              {c.trade_name && c.trade_name !== c.name ? c.trade_name : '—'}
            </span>
          </td>
        )
      case 'city':
        return (
          <td key={id} className="px-2 py-2.5 max-w-[150px]">
            <span className="text-sm text-gray-600 truncate block">
              {[c.city, c.state].filter(Boolean).join(' / ') || '—'}
            </span>
          </td>
        )
      case 'phone':
        return (
          <td key={id} className="px-2 py-2.5 whitespace-nowrap">
            <span className="text-sm text-gray-600">{c.phone || '—'}</span>
          </td>
        )
      case 'whatsapp':
        return (
          <td key={id} className="px-2 py-2.5 whitespace-nowrap">
            <span className="text-sm text-gray-600">{c.whatsapp || '—'}</span>
          </td>
        )
      case 'email':
        return (
          <td key={id} className="px-2 py-2.5 max-w-[180px]">
            <span className="text-xs text-gray-500 truncate block">{c.email || '—'}</span>
          </td>
        )
      case 'cnpj':
        return (
          <td key={id} className="px-2 py-2.5 whitespace-nowrap">
            <span className="text-xs text-gray-400">{c.cnpj || '—'}</span>
          </td>
        )
      case 'rep':
        return (
          <td key={id} className="px-2 py-2.5 max-w-[120px]">
            <span className="text-xs text-primary font-medium truncate block">{c.rep_name || '—'}</span>
          </td>
        )
      case '_edit':
        return (
          <td key={id} className="px-2 pr-3 py-2.5 text-right w-10">
            <button
              onClick={(e) => { e.stopPropagation(); openEdit(c) }}
              className="p-1.5 text-gray-300 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </button>
          </td>
        )
      default:
        return <td key={id} className="px-2 py-2.5" />
    }
  }

  const total = clients?.length || 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 lg:px-8 border-b border-outline-variant bg-white">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="font-display text-[22px] font-bold text-on-surface">Clientes</h1>
            <p className="text-xs text-gray-500">
              {isLoading ? 'Carregando…' : `${total} cliente${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ColumnConfigButton
              defs={CLIENT_COL_DEFS.filter(d => d.id !== '_edit')}
              config={config}
              onSave={save}
              onReset={reset}
            />
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 bg-surface-container hover:bg-gray-200 border border-outline-variant rounded-lg px-3 py-2 transition-colors"
              title="Importar via Excel"
            >
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Importar</span>
            </button>
            <button
              onClick={() => setShowNewCnpj(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 rounded-lg px-3 py-2 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Novo</span>
            </button>
          </div>
        </div>

        {/* Busca */}
        <Input
          placeholder="Buscar clientes por nome, CNPJ, cidade..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
        />
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <PageSpinner />
        </div>
      ) : total === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 bg-surface-container rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Users className="h-8 w-8 text-gray-300" />
          </div>
          <p className="text-gray-500 font-medium">Nenhum cliente encontrado</p>
          <p className="text-sm text-gray-400 mt-1">
            {search ? 'Tente ajustar a busca.' : 'Cadastre seu primeiro cliente ou importe via Excel.'}
          </p>
          {!search && (
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowImport(true)}
                className="flex items-center gap-2 px-4 py-2 bg-surface-container text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200 transition-colors">
                <Upload className="h-4 w-4" /> Importar Excel
              </button>
              <button onClick={() => setShowNewCnpj(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors">
                <Plus className="h-4 w-4" /> Cadastrar Cliente
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full min-w-[360px] text-left">
            <thead className="bg-surface-container-low border-b border-outline-variant sticky top-0 z-10">
              <tr>
                {visibleCols.map(col => (
                  <th
                    key={col.id}
                    className={`px-2 py-2.5 text-xs font-semibold text-gray-500 first:pl-3 last:pr-3 ${col.id === '_edit' ? 'w-10' : ''}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-50">
              {(clients || []).map(c => (
                <tr key={c.id} className="border-b border-outline-variant/50 hover:bg-primary/5 transition-colors">
                  {visibleCols.map(col => renderClientCell(col.id, c))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal editar/criar cliente */}
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
            <Input label="Insc. Estadual" {...f('state_registration')} placeholder="000.000.000.000" />
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
