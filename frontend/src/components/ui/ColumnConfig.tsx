import { useState, useEffect } from 'react'
import { Settings2, ChevronUp, ChevronDown, Eye, EyeOff } from 'lucide-react'
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

  // Sync local state every time the modal opens
  useEffect(() => {
    if (open) setLocal(config.map(c => ({ ...c })))
  }, [open, config])

  const toggleVisible = (id: string) => {
    const def = defs.find(d => d.id === id)
    if (def?.alwaysVisible) return
    setLocal(prev => prev.map(c => c.id === id ? { ...c, visible: !c.visible } : c))
  }

  const move = (idx: number, dir: -1 | 1) => {
    const next = idx + dir
    if (next < 0 || next >= local.length) return
    setLocal(prev => {
      const arr = [...prev]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr
    })
  }

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
          <button
            onClick={handleReset}
            className="text-[13px] text-primary hover:text-primary"
          >
            Restaurar padrão
          </button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
          </div>
        </div>
      }
    >
      <p className="text-[13px] text-outline/70 mb-3">
        Ative/desative colunas e use ▲▼ para reordenar.
      </p>
      <div className="divide-y divide-outline-variant/50">
        {local.map((col, idx) => {
          const def = defs.find(d => d.id === col.id)
          if (!def) return null
          return (
            <div
              key={col.id}
              className={`flex items-center gap-2 py-1 px-1 transition-colors ${
                col.visible ? '' : 'opacity-50'
              }`}
            >
              {/* Visibility toggle */}
              <button
                onClick={() => toggleVisible(col.id)}
                disabled={def.alwaysVisible}
                className={`flex-shrink-0 p-0.5 rounded transition-colors ${
                  def.alwaysVisible
                    ? 'opacity-30 cursor-default'
                    : 'hover:bg-surface-container cursor-pointer'
                }`}
                title={col.visible ? 'Ocultar' : 'Mostrar'}
              >
                {col.visible
                  ? <Eye className="h-4 w-4 text-primary" />
                  : <EyeOff className="h-4 w-4 text-outline/70" />
                }
              </button>

              {/* Label */}
              <span className={`flex-1 text-[13px] ${col.visible ? 'font-medium text-on-surface' : 'text-outline/70'}`}>
                {def.label}
              </span>

              {/* Up / Down */}
              <div className="flex gap-0.5">
                <button
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  className="p-0.5 text-outline/50 hover:text-on-surface-variant disabled:opacity-20 disabled:cursor-default rounded"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => move(idx, 1)}
                  disabled={idx === local.length - 1}
                  className="p-0.5 text-outline/50 hover:text-on-surface-variant disabled:opacity-20 disabled:cursor-default rounded"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
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
