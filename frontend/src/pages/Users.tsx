import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserCog, Plus, Edit2, ToggleLeft, ToggleRight, Eye, EyeOff, Factory, Trash2 } from 'lucide-react'
import { usersApi, factoriesApi } from '../api/client'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import { EmptyState } from '../components/ui/EmptyState'
import { formatDate } from '../utils/format'

interface FactoryOption { id: string; name: string }

interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'representante'
  active: boolean
  created_at: string
  factory_ids: string[]
}

interface FormState {
  name: string
  email: string
  password: string
  role: string
  factory_ids: string[]
}

const emptyForm: FormState = { name: '', email: '', password: '', role: 'representante', factory_ids: [] }

export function Users() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [showPassword, setShowPassword] = useState(false)

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then((r) => r.data),
  })

  const { data: factories = [] } = useQuery<FactoryOption[]>({
    queryKey: ['factories'],
    queryFn: () => factoriesApi.list().then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: () => usersApi.create({
      name: form.name, email: form.email, password: form.password,
      role: form.role, factory_ids: form.factory_ids,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); closeModal() },
  })

  const updateMut = useMutation({
    mutationFn: () => usersApi.update(editing!.id, {
      name: form.name, email: form.email, role: form.role,
      factory_ids: form.factory_ids,
      ...(form.password ? { password: form.password } : {}),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); closeModal() },
  })

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      usersApi.update(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setConfirmDeleteId(null) },
    onError: (err: any) => {
      alert(err?.response?.data?.error || 'Erro ao excluir usuário')
      setConfirmDeleteId(null)
    },
  })

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setErrors({})
    setOpen(true)
  }

  function openEdit(u: User) {
    setEditing(u)
    setForm({ name: u.name, email: u.email, password: '', role: u.role, factory_ids: u.factory_ids || [] })
    setErrors({})
    setOpen(true)
  }

  function closeModal() {
    setOpen(false)
    setEditing(null)
    setForm(emptyForm)
    setShowPassword(false)
  }

  function validate() {
    const e: Partial<Record<keyof FormState, string>> = {}
    if (!form.name.trim()) e.name = 'Nome é obrigatório'
    if (!form.email.trim()) e.email = 'E-mail é obrigatório'
    if (!editing && !form.password.trim()) e.password = 'Senha é obrigatória para novos usuários'
    if (form.password && form.password.length < 6) e.password = 'Senha deve ter pelo menos 6 caracteres'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit() {
    if (!validate()) return
    if (editing) updateMut.mutate()
    else createMut.mutate()
  }

  function toggleFactory(fid: string) {
    setForm(f => ({
      ...f,
      factory_ids: f.factory_ids.includes(fid)
        ? f.factory_ids.filter(x => x !== fid)
        : [...f.factory_ids, fid],
    }))
  }

  const f = (key: 'name' | 'email' | 'password') => ({
    value: form[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm({ ...form, [key]: e.target.value }),
  })

  const factoryMap = Object.fromEntries(factories.map(f => [f.id, f.name]))

  if (isLoading) return <PageSpinner />
  const list = users || []

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-outline-variant px-5 py-2.5 lg:px-8">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-display text-sm font-bold text-on-surface">Usuários</h1>
            <p className="text-[11px] text-outline mt-0.5">{list.length} usuários</p>
          </div>
          <Button onClick={openNew} icon={<Plus className="h-4 w-4" />} size="sm">
            Novo Usuário
          </Button>
        </div>
      </div>

      <div className="px-4 py-5 lg:px-8 max-w-3xl mx-auto">
        {list.length === 0 ? (
          <EmptyState
            icon={<UserCog className="h-8 w-8" />}
            title="Nenhum usuário encontrado"
            action={
              <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>
                Criar Usuário
              </Button>
            }
          />
        ) : (
          <div className="space-y-1">
            {list.map((u) => {
              const factoryNames = (u.factory_ids || []).map(id => factoryMap[id]).filter(Boolean)
              return (
                <Card key={u.id} padding="md">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                      <span className="text-[11px] font-bold text-primary">
                        {u.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-on-surface">{u.name}</p>
                        <Badge variant={u.role === 'admin' ? 'danger' : 'info'}>
                          {u.role === 'admin' ? 'Admin' : 'Representante'}
                        </Badge>
                        {!u.active && <Badge variant="default">Inativo</Badge>}
                      </div>
                      <p className="text-[11px] text-outline">{u.email}</p>
                      {/* Fábricas autorizadas */}
                      {u.role !== 'admin' && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          <Factory className="h-3 w-3 text-outline/60 shrink-0" />
                          {factoryNames.length > 0 ? (
                            factoryNames.map(name => (
                              <span key={name} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                                {name}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-outline/60 italic">todas as fábricas</span>
                          )}
                        </div>
                      )}
                      <p className="text-[11px] text-outline/70">Criado em {formatDate(u.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {confirmDeleteId === u.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-red-600 font-medium">Confirmar?</span>
                          <button
                            onClick={() => deleteMut.mutate(u.id)}
                            disabled={deleteMut.isPending}
                            className="px-2 py-1 text-[11px] bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
                          >
                            Sim
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 text-[11px] border border-outline-variant text-outline rounded-lg hover:bg-surface-container transition-colors"
                          >
                            Não
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => toggleActiveMut.mutate({ id: u.id, active: !u.active })}
                            className={`p-1.5 rounded-lg transition-colors ${u.active ? 'text-emerald-500 hover:bg-emerald-50' : 'text-outline/70 hover:bg-surface-container'}`}
                            title={u.active ? 'Desativar' : 'Ativar'}
                          >
                            {u.active ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => openEdit(u)}
                            className="p-1.5 text-outline/70 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(u.id)}
                            className="p-1.5 text-outline/70 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="Excluir usuário"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      <Modal
        open={open}
        onClose={closeModal}
        title={editing ? 'Editar Usuário' : 'Novo Usuário'}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={closeModal}>Cancelar</Button>
            <Button
              onClick={handleSubmit}
              loading={createMut.isPending || updateMut.isPending}
            >
              {editing ? 'Salvar' : 'Criar'}
            </Button>
          </div>
        }
      >
        <div className="space-y-1">
          <Input label="Nome completo" error={errors.name} autoFocus {...f('name')} />
          <Input label="E-mail" type="email" error={errors.email} {...f('email')} />
          <Select
            label="Perfil"
            options={[
              { value: 'representante', label: 'Representante' },
              { value: 'admin', label: 'Administrador' },
            ]}
            value={form.role}
            onChange={e => setForm({ ...form, role: e.target.value })}
          />
          <Input
            label={editing ? 'Nova senha (deixe em branco para manter)' : 'Senha'}
            type={showPassword ? 'text' : 'password'}
            error={errors.password}
            {...f('password')}
            rightElement={
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-outline/70 hover:text-on-surface-variant">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />

          {/* Fábricas (apenas para representantes) */}
          {form.role === 'representante' && factories.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-on-surface-variant mb-2">
                Fábricas autorizadas
              </label>
              <p className="text-[11px] text-outline mb-2">
                Sem seleção = acesso a todas. Selecione para restringir.
              </p>
              <div className="flex flex-wrap gap-2">
                {factories.map(fac => {
                  const selected = form.factory_ids.includes(fac.id)
                  return (
                    <button
                      key={fac.id}
                      type="button"
                      onClick={() => toggleFactory(fac.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${
                        selected
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-outline-variant bg-white text-on-surface-variant hover:border-primary/50'
                      }`}
                    >
                      <Factory className="h-3.5 w-3.5" />
                      {fac.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
