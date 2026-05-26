import Dexie, { Table } from 'dexie'

export interface OfflineProduct {
  id: string
  price_table_id: string
  reference: string
  type: 'regular' | 'pack'
  product_name: string | null
  model: string | null
  size_range: string | null
  base_price: number
  category: string | null
  image_url: string | null
  grade_configs: GradeConfig[]
  cachedAt: number
}

export interface GradeConfig {
  id: string
  product_id: string
  color: string | null
  sizes: Record<string, number>
  total_pieces: number
  sort_order: number
}

export interface OfflineClient {
  id: string
  name: string
  trade_name: string | null
  cnpj: string | null
  cpf: string | null
  city: string | null
  state: string | null
  phone: string | null
  email: string | null
  rep_id: string | null
  cachedAt: number
}

export interface PendingOrder {
  offline_id: string
  client_id: string
  factory_id: string
  price_table_id: string
  items: PendingOrderItem[]
  discount_pct: number
  notes: string | null
  createdAt: number
  status: 'pending' | 'syncing' | 'error'
  errorMessage?: string
}

export interface PendingOrderItem {
  product_id: string
  reference: string
  boxes_count: number
  unit_price: number
}

class SommaDB extends Dexie {
  products!: Table<OfflineProduct>
  clients!: Table<OfflineClient>
  pendingOrders!: Table<PendingOrder>

  constructor() {
    super('SommaDB')
    this.version(1).stores({
      products: 'id, price_table_id, reference, type',
      clients: 'id, name, rep_id',
      pendingOrders: 'offline_id, status, createdAt',
    })
  }
}

export const db = new SommaDB()
