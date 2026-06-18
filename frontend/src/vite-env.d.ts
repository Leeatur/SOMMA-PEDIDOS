/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HIDE_PRONTA_ENTREGA?: string
  readonly VITE_TRIAL_LABEL?: string
  readonly VITE_SINGLE_COMMISSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
