import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, Edit2 } from 'lucide-react'
import { factoriesApi } from '../api/client'
import { Button } from '../components/ui/Button'
import { Input, Textarea } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'

interface Factory {
  id: string
  name: string
  contact: string | null
  notes: string | null
  active: boolean
}

interface FormState {
  name: string
  contact: string
  notes: string
}

const empty: FormState = { name: '', contact: '', notes: '' }

export function Factories() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Factory | null>(null)
  const [form, setForm] = useState<FormState>(empty)
  const [errors, setErrors] = useState<Partial<FormState>>({})

  const { data: factories, isLoading } = useQuery<Factory[]>({
    queryKey: ['factories'],
    queryFn: () => factoriesApi.list().then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: (data: FormState) => factoriesApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['factories'] }); closeModal() },
  })

  const updateMut = useMutation({
    mutationFn: (data: FormState) => factoriesApi.update(editing!.id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['factories'] }); closeModal() },
  })

  function openNew() {
    setEditing(null)
    setForm(empty)
    setErrors({})
    setOpen(true)
  }

  function openEdit(f: Factory) {
    setEditing(f)
    setForm({ name: f.name, contact: f.contact || '', notes: f.notes || '' })
    setErrors({})
    setOpen(true)
  }

  function closeModal() {
    setOpen(false)
    setEditing(null)
    setForm(empty)
  }

  function validate() {
    const e: Partial<FormState> = {}
    if (!form.name.trim()) e.name = 'Nome é obrigatório'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit() {
    if (!validate()) return
    if (editing) {
      updateMut.mutate(form)
    } else {
      createMut.mutate(form)
    }
  }

  if (isLoading) return <PageSpinner />

  const list = factories || []

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="bg-white border-b border-outline-variant px-5 py-2.5 lg:px-8">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-bold text-on-surface">Fábricas / Marcas</h1>
            <p className="text-[11px] text-outline mt-0.5">{list.length} cadastradas</p>
          </div>
          <Button onClick={openNew} icon={<Plus className="h-4 w-4" />} size="sm">
            Nova Fábrica
          </Button>
        </div>
      </div>

      <div className="px-4 py-5 lg:px-8 max-w-3xl mx-auto">
        {list.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="Nenhuma fábrica cadastrada"
            description="Cadastre as fábricas/marcas que representa para começar a criar tabelas de preço."
            action={
              <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>
                Cadastrar Fábrica
              </Button>
            }
          />
        ) : (
          <div className="space-y-1.5">
            {list.map((f) => (
              <Card key={f.id} padding="md">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-on-surface">{f.name}</p>
                      {f.contact && (
                        <p className="text-[11px] text-outline mt-0.5">{f.contact}</p>
                      )}
                      {f.notes && (
                        <p className="text-[11px] text-outline/70 mt-0.5 line-clamp-1">{f.notes}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => openEdit(f)}
                    className="p-2 text-outline/70 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={closeModal}
        title={editing ? 'Editar Fábrica' : 'Nova Fábrica'}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={closeModal}>
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              loading={createMut.isPending || updateMut.isPending}
            >
              {editing ? 'Salvar' : 'Cadastrar'}
            </Button>
          </div>
        }
      >
        <div className="space-y-1">
          <Input
            label="Nome da Fábrica / Marca"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={errors.name}
            placeholder="Ex: Fábrica ABC"
            autoFocus
          />
          <Input
            label="Contato"
            value={form.contact}
            onChange={(e) => setForm({ ...form, contact: e.target.value })}
            placeholder="Telefone, e-mail ou nome"
          />
          <Textarea
            label="Observações"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Anotações internas..."
            rows={3}
          />
        </div>
      </Modal>
    </div>
  )
}
