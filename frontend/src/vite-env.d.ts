/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HIDE_PRONTA_ENTREGA?: string
  readonly VITE_TRIAL_LABEL?: string
  readonly VITE_SINGLE_COMMISSION?: string
  readonly VITE_FACTORY_COMMISSION?: string
  readonly VITE_MULTI_GRADE?: string
  readonly VITE_MIN_ORDER_VALUE?: string
  readonly VITE_PAYMENT_DRIVEN_DISCOUNT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
