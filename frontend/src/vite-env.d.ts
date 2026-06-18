/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HIDE_PRONTA_ENTREGA?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
