import { useState, useEffect, useRef } from 'react'
import { Settings2, GripVertical, Plus } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'

export interface ColumnDef {
  id: string
  label: string
  defaultVisible?: boolean  // true by default
  alwaysVisible?: boolean   // cannot be hidden
}

export interface ColState {
  id: string
  visible: boolean
}

function storageKey(pageKey: string) {
  return `somma-cols-v3-${pageKey}`
}

export function useColumnConfig(pageKey: string, defs: ColumnDef[]) {
  const key = storageKey(pageKey)

  const getInitial = (): ColState[] => {
    try {
      const saved = localStorage.getItem(key)
      if (saved) {
        const parsed: ColState[] = JSON.parse(saved)
        // Keep saved order/visibility; append any new columns (added after first save)
        const valid = parsed.filter(p => defs.find(d => d.id === p.id))
        const unseen = defs.filter(d => !parsed.find(p => p.id === d.id))
        return [...valid, ...unseen.map(d => ({ id: d.id, visible: d.defaultVisible !== false }))]
      }
    } catch {}
    return defs.map(d => ({ id: d.id, visible: d.defaultVisible !== false }))
  }

  const [config, setConfig] = useState<ColState[]>(getInitial)

  const save = (newConfig: ColState[]) => {
    setConfig(newConfig)
    try { localStorage.setItem(key, JSON.stringify(newConfig)) } catch {}
  }

  const reset = () => {
    const defaults = defs.map(d => ({ id: d.id, visible: d.defaultVisible !== false }))
    setConfig(defaults)
    try { localStorage.removeItem(key) } catch {}
  }

  // Ordered list of column defs with current visibility applied
  const orderedDefs = config
    .map(c => {
      const def = defs.find(d => d.id === c.id)
      if (!def) return null
      return { ...def, visible: c.visible }
    })
    .filter(Boolean) as Array<ColumnDef & { visible: boolean }>

  return { orderedDefs, config, save, reset }
}

// ─── Modal ───────────────────────────────────────────────────────────────────

interface ColumnConfigModalProps {
  open: boolean
  onClose: () => void
  defs: ColumnDef[]
  config: ColState[]
  onSave: (config: ColState[]) => void
  onReset: () => void
}

export function ColumnConfigModal({
  open,
  onClose,
  defs,
  config,
  onSave,
  onReset,
}: ColumnConfigModalProps) {
  const [local, setLocal] = useState<ColState[]>([])
  const dragIdx = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  useEffect(() => {
    if (open) setLocal(config.map(c => ({ ...c })))
  }, [open, config])

  const toggleVisible = (id: string) => {
    const def = defs.find(d => d.id === id)
    if (def?.alwaysVisible) return
    setLocal(prev => prev.map(c => c.id === id ? { ...c, visible: !c.visible } : c))
  }

  const handleDragStart = (idx: number) => { dragIdx.current = idx }
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    setDragOver(idx)
  }
  const handleDrop = (targetIdx: number) => {
    if (dragIdx.current === null || dragIdx.current === targetIdx) { setDragOver(null); return }
    setLocal(prev => {
      const arr = [...prev]
      const [moved] = arr.splice(dragIdx.current!, 1)
      arr.splice(targetIdx, 0, moved)
      return arr
    })
    dragIdx.current = null
    setDragOver(null)
  }
  const handleDragEnd = () => { dragIdx.current = null; setDragOver(null) }

  const handleSave = () => { onSave(local); onClose() }
  const handleReset = () => { onReset(); onClose() }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Personalizar Colunas"
      size="sm"
      footer={
        <div className="flex items-center justify-between gap-2">
          <button onClick={handleReset} className="text-[12px] text-primary hover:underline">
            Restaurar padrão
          </button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
          </div>
        </div>
      }
    >
      {/* Seção: Adicionar coluna */}
      {local.some(c => !c.visible) && (
        <div className="mb-3 flex items-center gap-2">
          <select
            className="flex-1 border border-outline-variant rounded-lg px-3 py-1.5 text-[12px] bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
            defaultValue=""
            onChange={e => {
              const id = e.target.value
              if (!id) return
              setLocal(prev => prev.map(c => c.id === id ? { ...c, visible: true } : c))
              e.target.value = ''
            }}
          >
            <option value="">Selecione uma coluna para adicionar...</option>
            {local.filter(c => !c.visible).map(c => {
              const def = defs.find(d => d.id === c.id)
              return def ? <option key={c.id} value={c.id}>{def.label}</option> : null
            })}
          </select>
          <Plus className="h-4 w-4 text-outline/50 flex-shrink-0" />
        </div>
      )}

      {/* Colunas ativas — drag para reordenar */}
      <p className="text-[11px] text-outline/50 mb-2">Colunas ativas — arraste ⠿ para reordenar</p>
      <div className="divide-y divide-outline-variant/20 select-none border border-outline-variant/30 rounded-xl overflow-hidden">
        {local.filter(c => c.visible).map((col) => {
          const visIdx = local.findIndex(c => c.id === col.id)
          const def = defs.find(d => d.id === col.id)
          if (!def) return null
          const isDraggingOver = dragOver === visIdx
          return (
            <div
              key={col.id}
              draggable
              onDragStart={() => handleDragStart(visIdx)}
              onDragOver={e => handleDragOver(e, visIdx)}
              onDrop={() => handleDrop(visIdx)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-2 py-2 px-3 transition-all cursor-grab active:cursor-grabbing bg-white ${
                isDraggingOver ? 'bg-primary/10' : 'hover:bg-surface-container-low'
              }`}
            >
              <GripVertical className="h-4 w-4 text-outline/30 flex-shrink-0" />
              <span className="flex-1 text-[13px] font-medium text-on-surface">{def.label}</span>
              {!def.alwaysVisible && (
                <button
                  onClick={() => toggleVisible(col.id)}
                  className="text-[11px] text-red-500 hover:text-red-700 font-semibold flex-shrink-0 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors"
                >
                  Remover
                </button>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

// ─── Trigger button (drop-in) ─────────────────────────────────────────────────

export function ColumnConfigButton({
  defs,
  config,
  onSave,
  onReset,
}: {
  defs: ColumnDef[]
  config: ColState[]
  onSave: (config: ColState[]) => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 text-outline/70 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors flex-shrink-0"
        title="Personalizar colunas"
      >
        <Settings2 className="h-4 w-4" />
      </button>
      <ColumnConfigModal
        open={open}
        onClose={() => setOpen(false)}
        defs={defs}
        config={config}
        onSave={onSave}
        onReset={onReset}
      />
    </>
  )
}
