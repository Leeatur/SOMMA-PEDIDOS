import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, GripVertical, Check, X } from 'lucide-react'
import { paymentConditionsApi } from '../api/client'

interface Condition {
  id: string
  name: string
  sort_order: number
  active: boolean
}

export function PaymentConditions() {
  const qc = useQueryClient()
  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [error, setError] = useState('')

  const { data: conditions = [], isLoading } = useQuery<Condition[]>({
    queryKey: ['payment-conditions'],
    queryFn: () => paymentConditionsApi.list().then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (name: string) => paymentConditionsApi.create({ name, sort_order: conditions.length }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payment-conditions'] }); setNewName(''); setError('') },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg || 'Erro ao criar condição')
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      paymentConditionsApi.update(id, { name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payment-conditions'] }); setEditId(null) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => paymentConditionsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-conditions'] }),
  })

  const reorderMut = useMutation({
    mutationFn: (order: { id: string; sort_order: number }[]) => paymentConditionsApi.reorder(order),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-conditions'] }),
  })

  // Drag-to-reorder simples via estado local
  const [dragId, setDragId] = useState<string | null>(null)

  function handleDragStart(id: string) { setDragId(id) }

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) return
    const reordered = [...conditions]
    const fromIdx = reordered.findIndex(c => c.id === dragId)
    const toIdx   = reordered.findIndex(c => c.id === targetId)
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    reorderMut.mutate(reordered.map((c, i) => ({ id: c.id, sort_order: i })))
    setDragId(null)
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    createMut.mutate(newName.trim())
  }

  function startEdit(c: Condition) { setEditId(c.id); setEditName(c.name) }
  function cancelEdit() { setEditId(null) }
  function saveEdit(id: string) {
    if (!editName.trim()) return
    updateMut.mutate({ id, name: editName.trim() })
  }

  return (
    <div className="p-6 max-w-lg">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-on-surface">Condições de Pagamento</h1>
        <p className="text-[13px] text-on-surface-variant mt-1">
          Pré-cadastre as condições disponíveis para seleção nos pedidos.
        </p>
      </div>

      {/* Formulário novo */}
      <form onSubmit={handleCreate} className="flex gap-2 mb-6">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Ex: 30/60/90 dias, À vista, 28 DDL..."
          className="flex-1 border border-outline-variant rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
          autoFocus
        />
        <button
          type="submit"
          disabled={!newName.trim() || createMut.isPending}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Plus className="h-4 w-4" /> Adicionar
        </button>
      </form>
      {error && <p className="text-[12px] text-red-600 mb-4">{error}</p>}

      {/* Lista */}
      {isLoading ? (
        <div className="text-[13px] text-on-surface-variant">Carregando...</div>
      ) : conditions.length === 0 ? (
        <div className="text-center py-12 text-on-surface-variant text-[13px] border border-dashed border-outline-variant rounded-xl">
          Nenhuma condição cadastrada ainda.<br />
          <span className="text-on-surface-variant/60">Adicione acima para aparecer nos pedidos.</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {conditions.map(c => (
            <div
              key={c.id}
              draggable
              onDragStart={() => handleDragStart(c.id)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop(c.id)}
              className={`flex items-center gap-2 bg-white border rounded-xl px-3 py-2.5 group transition-colors ${dragId === c.id ? 'opacity-40' : 'border-outline-variant hover:border-primary/30'}`}
            >
              <GripVertical className="h-4 w-4 text-outline/40 cursor-grab flex-shrink-0" />

              {editId === c.id ? (
                <>
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(c.id); if (e.key === 'Escape') cancelEdit() }}
                    className="flex-1 border border-primary rounded-lg px-2 py-1 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button onClick={() => saveEdit(c.id)} className="p-1 rounded hover:bg-green-50 text-green-600">
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={cancelEdit} className="p-1 rounded hover:bg-red-50 text-red-400">
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-[13px] text-on-surface font-medium">{c.name}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(c)} className="p-1.5 rounded-lg hover:bg-surface-container-low text-outline">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => window.confirm(`Remover "${c.name}"?`) && deleteMut.mutate(c.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          <p className="text-[11px] text-on-surface-variant/50 pt-1 pl-1">
            Arraste para reordenar
          </p>
        </div>
      )}
    </div>
  )
}
