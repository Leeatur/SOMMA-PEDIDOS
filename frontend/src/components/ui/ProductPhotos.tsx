import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight, Images } from 'lucide-react'

// Galeria de fotos do produto: mostra a capa como miniatura; ao clicar abre
// um lightbox em tela cheia com navegação ‹ › entre todas as fotos.
// Funciona com 1 foto (vira só zoom) ou várias.
export function ProductPhotos({
  images, alt, className, imgClassName, fallbackIcon,
}: {
  images: (string | null | undefined)[]
  alt?: string
  className?: string
  imgClassName?: string
  fallbackIcon?: React.ReactNode
}) {
  const list = (images || []).filter((u): u is string => !!u)
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key === 'ArrowRight') setIdx(i => (i + 1) % list.length)
      if (e.key === 'ArrowLeft') setIdx(i => (i - 1 + list.length) % list.length)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, list.length])

  if (list.length === 0) return <>{fallbackIcon ?? null}</>

  const go = (d: number, e: React.MouseEvent) => { e.stopPropagation(); setIdx(i => (i + d + list.length) % list.length) }

  return (
    <>
      <div className={`relative ${className || ''} cursor-zoom-in`} onClick={(e) => { e.stopPropagation(); setIdx(0); setOpen(true) }} title="Clique para ampliar">
        <img src={list[0]} alt={alt} className={imgClassName || 'w-full h-full object-cover'} />
        {list.length > 1 && (
          <span className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5 bg-black/60 text-white text-[10px] font-semibold px-1 py-0.5 rounded">
            <Images className="h-3 w-3" />{list.length}
          </span>
        )}
      </div>

      {open && createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4 cursor-zoom-out" onClick={() => setOpen(false)}>
          <img
            src={list[idx]} alt={alt}
            className="max-w-full max-h-full object-contain select-none"
            style={{ touchAction: 'pinch-zoom' }}
            onClick={(e) => e.stopPropagation()}
          />
          <button type="button" onClick={() => setOpen(false)} className="absolute top-4 right-4 p-2 rounded-full bg-white/15 text-white hover:bg-white/25" aria-label="Fechar"><X className="h-6 w-6" /></button>
          {list.length > 1 && (
            <>
              <button type="button" onClick={(e) => go(-1, e)} className="absolute left-4 p-2 rounded-full bg-white/15 text-white hover:bg-white/25" aria-label="Anterior"><ChevronLeft className="h-7 w-7" /></button>
              <button type="button" onClick={(e) => go(1, e)} className="absolute right-4 p-2 rounded-full bg-white/15 text-white hover:bg-white/25" aria-label="Próxima"><ChevronRight className="h-7 w-7" /></button>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <span className="text-white/90 text-[12px] font-semibold bg-black/40 px-2 py-1 rounded-full">{idx + 1} / {list.length}</span>
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
