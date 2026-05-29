import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserCog, Plus, Edit2, ToggleLeft, ToggleRight, Eye, EyeOff } from 'lucide-react'
import { usersApi } from '../api/client'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import { EmptyState } from '../components/ui/EmptyState'
import { formatDate } from '../utils/format'

interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'representante'
  active: boolean
  created_at: string
}

interface FormState {
  name: string
  email: string
  password: string
  role: string
}

const emptyForm: FormState = { name: '', email: '', password: '', role: 'representante' }

export function Users() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<Partial<FormState>>({})
  const [showPassword, setShowPassword] = useState(false)

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: () => usersApi.create({ name: form.name, email: form.email, password: form.password, role: form.role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); closeModal() },
  })

  const updateMut = useMutation({
    mutationFn: () => usersApi.update(editing!.id, {
      name: form.name,
      email: form.email,
      role: form.role,
      ...(form.password ? { password: form.password } : {}),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); closeModal() },
  })

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      usersApi.update(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setErrors({})
    setOpen(true)
  }

  function openEdit(u: User) {
    setEditing(u)
    setForm({ name: u.name, email: u.email, password: '', role: u.role })
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
    const e: Partial<FormState> = {}
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

  const f = (key: keyof FormState) => ({
    value: form[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm({ ...form, [key]: e.target.value }),
  })

  if (isLoading) return <PageSpinner />
  const list = users || []

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-outline-variant px-5 py-4 lg:px-8">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-display text-[22px] font-bold text-on-surface">Usuários</h1>
            <p className="text-xs text-outline mt-0.5">{list.length} usuários</p>
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
          <div className="space-y-2">
            {list.map((u) => (
              <Card key={u.id} padding="md">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-primary">
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
                    <p className="text-xs text-outline">{u.email}</p>
                    <p className="text-xs text-outline/70">Criado em {formatDate(u.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
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
                  </div>
                </div>
              </Card>
            ))}
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
        <div className="space-y-4">
          <Input label="Nome completo" error={errors.name} autoFocus {...f('name')} />
          <Input label="E-mail" type="email" error={errors.email} {...f('email')} />
          <Select
            label="Perfil"
            options={[
              { value: 'representante', label: 'Representante' },
              { value: 'admin', label: 'Administrador' },
            ]}
            {...f('role')}
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
        </div>
      </Modal>
    </div>
  )
}
