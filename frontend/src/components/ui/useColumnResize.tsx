import { useState, useCallback, useRef } from 'react'

const STORAGE_PREFIX = 'somma-col-width-v1-'

export function useColumnResize(pageKey: string, defaultWidths: Record<string, number>) {
  const storageKey = `${STORAGE_PREFIX}${pageKey}`

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) return { ...defaultWidths, ...JSON.parse(saved) }
    } catch {}
    return defaultWidths
  })

  const save = useCallback((newWidths: Record<string, number>) => {
    setWidths(newWidths)
    try { localStorage.setItem(storageKey, JSON.stringify(newWidths)) } catch {}
  }, [storageKey])

  const reset = useCallback(() => {
    setWidths(defaultWidths)
    try { localStorage.removeItem(storageKey) } catch {}
  }, [storageKey, defaultWidths])

  // Returns props to spread onto a <th> to enable drag-resize
  const getResizeProps = useCallback((colId: string, minWidth = 60) => {
    return {
      style: { width: widths[colId] ?? defaultWidths[colId], minWidth, position: 'relative' as const },
      'data-col-id': colId,
    }
  }, [widths, defaultWidths])

  return { widths, save, reset, getResizeProps }
}

// ─── ResizeHandle — coloca na borda direita de cada <th> ─────────────────────

interface ResizeHandleProps {
  colId: string
  onResize: (colId: string, delta: number) => void
}

export function ResizeHandle({ colId, onResize }: ResizeHandleProps) {
  const startX = useRef<number>(0)
  const isDragging = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    startX.current = e.clientX
    isDragging.current = true

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const delta = ev.clientX - startX.current
      startX.current = ev.clientX
      onResize(colId, delta)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [colId, onResize])

  return (
    <div
      onMouseDown={handleMouseDown}
      className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 group flex items-center justify-center z-10"
      title="Arraste para redimensionar"
    >
      <div className="w-px h-4 bg-outline/30 group-hover:bg-primary/60" />
    </div>
  )
}
