import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Trash2, GripVertical, Check, ToggleLeft, ToggleRight } from 'lucide-react'
import { statusesApi } from '../api/client'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { Card } from '../components/ui/Card'
import { StatusBadge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import { EmptyState } from '../components/ui/EmptyState'

interface Status {
  id: string
  name: string
  color: string
  sort_order: number
  is_initial: boolean
  is_final: boolean
  active: boolean
}

interface FormState {
  name: string
  color: string
  is_initial: boolean
  is_final: boolean
}

const PRESET_COLORS = [
  '#6B7280', '#EF4444', '#F59E0B', '#10B981', '#3B82F6',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#06B6D4',
]

const emptyForm: FormState = {
  name: '',
  color: '#6B7280',
  is_initial: false,
  is_final: false,
}

export function Statuses() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState<Status | null>(null)
  const [editing, setEditing] = useState<Status | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<Partial<FormState>>({})

  const { data: statuses, isLoading } = useQuery<Status[]>({
    queryKey: ['statuses'],
    queryFn: () => statusesApi.list().then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: () => statusesApi.create({
      name: form.name,
      color: form.color,
      is_initial: form.is_initial,
      is_final: form.is_final,
      sort_order: (statuses?.length || 0),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['statuses'] }); closeModal() },
  })

  const updateMut = useMutation({
    mutationFn: () => statusesApi.update(editing!.id, {
      name: form.name,
      color: form.color,
      is_initial: form.is_initial,
      is_final: form.is_final,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['statuses'] }); closeModal() },
  })

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      statusesApi.update(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['statuses'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => statusesApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['statuses'] }); setDeleteOpen(null) },
  })

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setErrors({})
    setOpen(true)
  }

  function openEdit(s: Status) {
    setEditing(s)
    setForm({ name: s.name, color: s.color, is_initial: s.is_initial, is_final: s.is_final })
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
    if (editing) updateMut.mutate()
    else createMut.mutate()
  }

  if (isLoading) return <PageSpinner />
  const list = (statuses || []).sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-outline-variant px-5 py-2.5 lg:px-8">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-bold text-on-surface">Status de Pedidos</h1>
            <p className="text-[11px] text-outline mt-0.5">{list.length} status configurados</p>
          </div>
          <Button onClick={openNew} icon={<Plus className="h-4 w-4" />} size="sm">
            Novo Status
          </Button>
        </div>
      </div>

      <div className="px-4 py-5 lg:px-8 max-w-2xl mx-auto">
        {list.length === 0 ? (
          <EmptyState
            icon={<GripVertical className="h-8 w-8" />}
            title="Nenhum status configurado"
            description="Crie os status do fluxo de pedidos da sua empresa."
            action={
              <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>
                Criar Status
              </Button>
            }
          />
        ) : (
          <div className="space-y-1">
            {list.map((s) => (
              <Card key={s.id} padding="md">
                <div className="flex items-center gap-3">
                  <div className="text-outline/50 cursor-grab flex-shrink-0">
                    <GripVertical className="h-5 w-5" />
                  </div>
                  <StatusBadge name={s.name} color={s.color} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      {s.is_initial && (
                        <span className="text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">inicial</span>
                      )}
                      {s.is_final && (
                        <span className="text-[11px] bg-surface-container text-on-surface-variant px-1.5 py-0.5 rounded-full">final</span>
                      )}
                      {!s.active && (
                        <span className="text-[11px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded-full">inativo</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggleActiveMut.mutate({ id: s.id, active: !s.active })}
                      className={`p-1.5 rounded-lg transition-colors ${s.active ? 'text-emerald-500 hover:bg-emerald-50' : 'text-outline/70 hover:bg-surface-container'}`}
                      title={s.active ? 'Desativar' : 'Ativar'}
                    >
                      {s.active ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => openEdit(s)}
                      className="p-1.5 text-outline/70 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteOpen(s)}
                      className="p-1.5 text-outline/70 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        open={open}
        onClose={closeModal}
        title={editing ? 'Editar Status' : 'Novo Status'}
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
          <Input
            label="Nome do Status"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={errors.name}
            placeholder="Ex: Em análise"
            autoFocus
          />

          {/* Color picker */}
          <div>
            <label className="block text-[11px] font-medium text-on-surface-variant mb-2">Cor</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  className="w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center"
                  style={{
                    backgroundColor: c,
                    borderColor: form.color === c ? '#1d4ed8' : 'transparent',
                  }}
                >
                  {form.color === c && <Check className="h-4 w-4 text-white" />}
                </button>
              ))}
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="w-8 h-8 rounded-full border border-outline-variant cursor-pointer overflow-hidden"
                title="Cor personalizada"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-outline">Preview:</span>
              <StatusBadge name={form.name || 'Status'} color={form.color} />
            </div>
          </div>

          {/* Flags */}
          <div className="space-y-1">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                className={`w-10 h-6 rounded-full transition-colors flex items-center ${form.is_initial ? 'bg-primary' : 'bg-surface-container-high'}`}
                onClick={() => setForm({ ...form, is_initial: !form.is_initial })}
              >
                <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform mx-1 ${form.is_initial ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
              <div>
                <p className="text-[11px] font-medium text-on-surface-variant">Status inicial</p>
                <p className="text-[11px] text-outline">Aplicado automaticamente a novos pedidos</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                className={`w-10 h-6 rounded-full transition-colors flex items-center ${form.is_final ? 'bg-emerald-600' : 'bg-surface-container-high'}`}
                onClick={() => setForm({ ...form, is_final: !form.is_final })}
              >
                <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform mx-1 ${form.is_final ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
              <div>
                <p className="text-[11px] font-medium text-on-surface-variant">Status final</p>
                <p className="text-[11px] text-outline">Indica pedidos concluídos/cancelados</p>
              </div>
            </label>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleteOpen}
        onClose={() => setDeleteOpen(null)}
        title="Excluir Status"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setDeleteOpen(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => deleteOpen && deleteMut.mutate(deleteOpen.id)}
              loading={deleteMut.isPending}
            >
              Excluir
            </Button>
          </div>
        }
      >
        <p className="text-[11px] text-on-surface-variant">
          Tem certeza que deseja excluir o status{' '}
          <strong>{deleteOpen?.name}</strong>? Pedidos com este status não serão afetados, mas o status não estará mais disponível.
        </p>
      </Modal>
    </div>
  )
}
