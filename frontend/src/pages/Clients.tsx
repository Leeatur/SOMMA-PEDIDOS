import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Edit2, Search, Upload, Trash2, X } from 'lucide-react'
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
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showNewCnpj, setShowNewCnpj] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<Partial<FormState>>({})

  function handleSearch(val: string) {
    setSearch(val)
    clearTimeout((window as unknown as { _clientSearchTimer?: number })._clientSearchTimer)
    ;(window as unknown as { _clientSearchTimer?: number })._clientSearchTimer = window.setTimeout(() => {
      setDebouncedSearch(val)
    }, 350)
  }

  const { data: clients, isLoading, isError } = useQuery<Client[]>({
    queryKey: ['clients', debouncedSearch],
    queryFn: () => clientsApi.list(debouncedSearch || undefined).then((r) => r.data),
    retry: 1,
  })

  const [sortCol, setSortCol] = useState<string>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const sortedClients = useMemo(() => {
    if (!clients) return []
    const colMap: Record<string, (c: Client) => string> = {
      name:       c => (c.name || '').toLowerCase(),
      trade_name: c => (c.trade_name || c.name || '').toLowerCase(),
      city:       c => (c.city || '').toLowerCase(),
      phone:      c => (c.phone || '').toLowerCase(),
      rep:        c => (c.rep_name || '').toLowerCase(),
    }
    const fn = colMap[sortCol]
    if (!fn) return clients
    return [...clients].sort((a, b) => {
      const cmp = fn(a) < fn(b) ? -1 : fn(a) > fn(b) ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [clients, sortCol, sortDir])

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

  const deleteMut = useMutation({
    mutationFn: (id: string) => clientsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); closeModal() },
  })

  function handleDelete(id: string, name: string) {
    if (!window.confirm(`Excluir o cliente "${name}"? Esta ação não pode ser desfeita.`)) return
    deleteMut.mutate(id)
  }

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
    { id: 'trade_name', label: 'Nome Fantasia' },
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
          <td key={id} className="pl-3 pr-2 py-0.5 max-w-[220px]">
            <p className="text-[11px] font-semibold text-on-surface truncate">{c.name}</p>
          </td>
        )
      case 'trade_name':
        return (
          <td key={id} className="px-2 py-0.5 max-w-[180px]">
            <span className="text-[11px] text-outline truncate block">
              {c.trade_name && c.trade_name !== c.name ? c.trade_name : '—'}
            </span>
          </td>
        )
      case 'city':
        return (
          <td key={id} className="px-2 py-0.5 max-w-[150px]">
            <span className="text-[11px] text-on-surface-variant truncate block">
              {[c.city, c.state].filter(Boolean).join(' / ') || '—'}
            </span>
          </td>
        )
      case 'phone':
        return (
          <td key={id} className="px-2 py-0.5 whitespace-nowrap">
            <span className="text-[11px] text-on-surface-variant">{c.phone || '—'}</span>
          </td>
        )
      case 'whatsapp':
        return (
          <td key={id} className="px-2 py-0.5 whitespace-nowrap">
            <span className="text-[11px] text-on-surface-variant">{c.whatsapp || '—'}</span>
          </td>
        )
      case 'email':
        return (
          <td key={id} className="px-2 py-0.5 max-w-[180px]">
            <span className="text-[11px] text-outline truncate block">{c.email || '—'}</span>
          </td>
        )
      case 'cnpj':
        return (
          <td key={id} className="px-2 py-0.5 whitespace-nowrap">
            <span className="text-[11px] text-outline/70">{c.cnpj || '—'}</span>
          </td>
        )
      case 'rep':
        return (
          <td key={id} className="px-2 py-0.5 max-w-[120px]">
            <span className="text-[11px] text-primary font-medium truncate block">{c.rep_name || '—'}</span>
          </td>
        )
      case '_edit':
        return (
          <td key={id} className="px-2 pr-3 py-0.5 text-right w-20">
            <div className="flex items-center justify-end gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); openEdit(c) }}
                className="p-1.5 text-outline/50 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(c.id, c.name) }}
                className="p-1.5 text-outline/40 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </td>
        )
      default:
        return <td key={id} className="px-2 py-1" />
    }
  }

  const total = clients?.length || 0

  if (isError) return (
    <div className="flex flex-col items-center justify-center h-full py-24 text-center px-8">
      <p className="text-red-500 font-semibold text-sm mb-2">Erro ao carregar clientes</p>
      <p className="text-[11px] text-outline/70">Verifique sua conexão e tente novamente.</p>
      <button onClick={() => window.location.reload()} className="mt-4 text-[11px] text-primary underline">
        Recarregar
      </button>
    </div>
  )

  // Gera cor de avatar baseada no nome
  function avatarColor(name: string) {
    const colors = [
      ['#dbeafe','#1d4ed8'], ['#dcfce7','#15803d'], ['#fce7f3','#be185d'],
      ['#fef3c7','#b45309'], ['#ede9fe','#6d28d9'], ['#ffedd5','#c2410c'],
    ]
    const i = name.charCodeAt(0) % colors.length
    return colors[i]
  }

  return (
    <div className="flex flex-col h-full">

      {/* ══ MOBILE VIEW ══════════════════════════════════════════════════════ */}
      <div className="lg:hidden flex flex-col h-full bg-[#f8f9ff]">

        {/* Mobile header */}
        <div className="px-4 pt-3 pb-2 bg-white border-b border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display text-lg font-bold text-on-surface">Clientes</h2>
            <button
              onClick={() => setShowNewCnpj(true)}
              className="flex items-center gap-1.5 bg-primary text-white text-[11px] font-semibold px-3.5 py-1 rounded-xl active:scale-95 transition-transform"
            >
              <Plus className="h-4 w-4" /> Novo
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-outline" />
            <input
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Nome, CNPJ, cidade, telefone..."
              className="w-full h-11 pl-10 pr-10 bg-surface-container-low border border-outline-variant/60 rounded-xl text-[11px] focus:ring-2 focus:ring-primary focus:border-primary outline-none"
            />
            {search && (
              <button onClick={() => handleSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-outline/50 hover:text-on-surface transition-colors">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><PageSpinner /></div>
          ) : total === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-8">
              <div className="w-16 h-16 bg-surface-container rounded-2xl flex items-center justify-center mb-4">
                <Users className="h-8 w-8 text-outline/50" />
              </div>
              <p className="text-outline font-medium">Nenhum cliente encontrado</p>
              <p className="text-[11px] text-outline/70 mt-1">
                {search ? 'Tente ajustar a busca.' : 'Cadastre o primeiro cliente.'}
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1 pb-28">
              {(clients || []).map(c => {
                const [bg, fg] = avatarColor(c.name)
                const initials = c.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
                return (
                  <div key={c.id} className="bg-white rounded-xl border border-outline-variant/40 shadow-sm overflow-hidden active:bg-surface-container-low transition-colors">
                    <div className="flex items-start gap-2 p-2">
                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-[11px]"
                           style={{ backgroundColor: bg, color: fg }}>
                        {initials}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-on-surface text-[11px] leading-tight truncate">{c.name}</p>
                        {c.trade_name && c.trade_name !== c.name && (
                          <p className="text-[11px] text-outline truncate mt-0.5">{c.trade_name}</p>
                        )}
                        {(c.city || c.state) && (
                          <p className="text-[11px] text-on-surface-variant mt-1">
                            📍 {[c.city, c.state].filter(Boolean).join(' / ')}
                          </p>
                        )}
                        {c.cnpj && (
                          <p className="text-[11px] text-outline mt-0.5 font-mono">{c.cnpj}</p>
                        )}
                      </div>
                      {/* Edit / Delete */}
                      <div className="flex gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => openEdit(c)}
                          className="p-2 text-outline/50 hover:text-primary hover:bg-primary/10 rounded-xl transition-colors"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(c.id, c.name)}
                          className="p-2 text-outline/40 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Contact bar */}
                    {(c.phone || c.whatsapp || c.email) && (
                      <div className="flex border-t border-outline-variant/30 divide-x divide-outline-variant/30">
                        {c.phone && (
                          <a href={`tel:${c.phone}`}
                             className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container active:bg-surface-container transition-colors"
                             onClick={e => e.stopPropagation()}>
                            📞 Ligar
                          </a>
                        )}
                        {c.whatsapp && (
                          <a href={`https://wa.me/55${c.whatsapp.replace(/\D/g, '')}`}
                             target="_blank" rel="noreferrer"
                             className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 active:bg-emerald-100 transition-colors"
                             onClick={e => e.stopPropagation()}>
                            💬 WhatsApp
                          </a>
                        )}
                        {c.email && (
                          <a href={`mailto:${c.email}`}
                             className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container active:bg-surface-container transition-colors"
                             onClick={e => e.stopPropagation()}>
                            ✉️ E-mail
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ══ DESKTOP VIEW ═════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 lg:px-8 border-b border-outline-variant bg-white">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="font-display text-lg font-bold text-on-surface">Clientes</h1>
            <p className="text-[11px] text-outline">
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
              className="flex items-center gap-1.5 text-[11px] font-semibold text-on-surface-variant bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-lg px-3 py-1 transition-colors"
              title="Importar via Excel"
            >
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Importar</span>
            </button>
            <button
              onClick={() => setShowNewCnpj(true)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-white bg-primary hover:bg-primary/90 rounded-lg px-3 py-1 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Novo</span>
            </button>
          </div>
        </div>

        {/* Busca */}
        <Input
          placeholder="Buscar por nome, CNPJ, CPF, cidade, telefone, e-mail..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          onClear={() => handleSearch('')}
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
            <Users className="h-8 w-8 text-outline/50" />
          </div>
          <p className="text-outline font-medium">Nenhum cliente encontrado</p>
          <p className="text-[11px] text-outline/70 mt-1">
            {search ? 'Tente ajustar a busca.' : 'Cadastre seu primeiro cliente ou importe via Excel.'}
          </p>
          {!search && (
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowImport(true)}
                className="flex items-center gap-2 px-4 py-1 bg-surface-container text-on-surface-variant text-[11px] font-semibold rounded-lg hover:bg-surface-container-high transition-colors">
                <Upload className="h-4 w-4" /> Importar Excel
              </button>
              <button onClick={() => setShowNewCnpj(true)}
                className="flex items-center gap-2 px-4 py-1 bg-primary text-white text-[11px] font-semibold rounded-lg hover:bg-primary/90 transition-colors">
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
                {visibleCols.map(col => {
                  const sortable = ['name','trade_name','city','phone','rep'].includes(col.id)
                  const active = sortCol === col.id
                  return (
                    <th
                      key={col.id}
                      onClick={sortable ? () => handleSort(col.id) : undefined}
                      className={`px-2 py-1.5 text-[11px] font-semibold text-outline first:pl-3 last:pr-3 ${col.id === '_edit' ? 'w-10' : ''} ${sortable ? 'cursor-pointer select-none hover:text-on-surface' : ''}`}
                    >
                      <span className="inline-flex items-center gap-0.5">
                        {col.label}
                        {sortable && <span className={`text-[10px] ${active ? 'text-primary' : 'text-outline/30'}`}>{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span>}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-50">
              {sortedClients.map(c => (
                <tr key={c.id} className="border-b border-outline-variant/50 hover:bg-primary/5 transition-colors">
                  {visibleCols.map(col => renderClientCell(col.id, c))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      </div> {/* end desktop view */}

      {/* Modal editar/criar cliente */}
      <Modal
        open={open}
        onClose={closeModal}
        title={editing ? 'Editar Cliente' : 'Novo Cliente'}
        size="lg"
        footer={
          <div className="flex items-center gap-2">
            {editing && (
              <button
                onClick={() => handleDelete(editing.id, editing.name)}
                disabled={deleteMut.isPending}
                className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors mr-auto"
                title="Excluir cliente"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" onClick={closeModal}>Cancelar</Button>
              <Button
                onClick={handleSubmit}
                loading={createMut.isPending || updateMut.isPending}
              >
                {editing ? 'Salvar' : 'Cadastrar'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-1">
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
            <p className="text-[11px] font-medium text-on-surface-variant mb-2">Endereço</p>
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
