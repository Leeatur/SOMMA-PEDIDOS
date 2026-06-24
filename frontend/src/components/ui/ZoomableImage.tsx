import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// Imagem clicável que abre uma versão ampliada em tela cheia (lightbox).
// Usada nas telas de pedido (FV) e onde mais quisermos ampliar a foto do produto.
export function ZoomableImage({
  src, alt, className, imgClassName,
}: {
  src: string
  alt?: string
  className?: string          // classes do wrapper/thumb (ex.: tamanho/borda)
  imgClassName?: string       // classes da <img> interna
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open])

  return (
    <>
      <img
        src={src}
        alt={alt}
        className={`${className || ''} ${imgClassName || ''} cursor-zoom-in`}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        title="Clique para ampliar"
      />
      {open && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4 cursor-zoom-out"
          onClick={() => setOpen(false)}
        >
          <img
            src={src}
            alt={alt}
            className="max-w-full max-h-full object-contain select-none"
            style={{ touchAction: 'pinch-zoom' }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/15 text-white hover:bg-white/25"
            aria-label="Fechar"
          >
            <X className="h-6 w-6" />
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
