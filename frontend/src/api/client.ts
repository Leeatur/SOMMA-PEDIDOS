import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '../stores/authStore'

const API_URL = '/api'

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 15000,
})

// Request interceptor: attach token
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

let isRefreshing = false
let failedQueue: Array<{
  resolve: (value: string) => void
  reject: (reason?: unknown) => void
}> = []

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token!)
    }
  })
  failedQueue = []
}

// Response interceptor: handle 401 + auto-refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    if (error.response?.status === 401 && !originalRequest._retry) {
      const { refreshToken, setAccessToken, logout } = useAuthStore.getState()

      if (!refreshToken) {
        logout()
        window.location.href = '/login'
        return Promise.reject(error)
      }

      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`
            }
            return apiClient(originalRequest)
          })
          .catch((err) => Promise.reject(err))
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken })
        const newToken = data.accessToken
        setAccessToken(newToken)
        processQueue(null, newToken)
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`
        }
        return apiClient(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        logout()
        window.location.href = '/login'
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  }
)

// --- API helpers ---

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post('/auth/login', { email, password }),
  me: () => apiClient.get('/auth/me'),
  logout: (refreshToken: string) =>
    apiClient.post('/auth/logout', { refreshToken }),
}

export const factoriesApi = {
  list: () => apiClient.get('/factories'),
  create: (data: { name: string; contact?: string; notes?: string }) =>
    apiClient.post('/factories', data),
  update: (id: string, data: { name: string; contact?: string; notes?: string }) =>
    apiClient.put(`/factories/${id}`, data),
}

export const priceTablesApi = {
  list: (factory_id?: string) =>
    apiClient.get('/price-tables', { params: { factory_id } }),
  get: (id: string) => apiClient.get(`/price-tables/${id}`),
  preview: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return apiClient.post('/price-tables/preview', fd)
  },
  import: (file: File, data: {
    factory_id: string
    name: string
    collection?: string
    season?: string
    year?: number
    discount_rules: string
  }) => {
    const fd = new FormData()
    fd.append('file', file)
    Object.entries(data).forEach(([k, v]) => {
      if (v !== undefined && v !== null) fd.append(k, String(v))
    })
    return apiClient.post('/price-tables/import', fd)
  },
  importCatalog: (file: File, price_table_id: string, overwrite = false) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('price_table_id', price_table_id)
    if (overwrite) fd.append('overwrite', 'true')
    return apiClient.post('/price-tables/import-catalog', fd, {
      timeout: 600000, // 10 min — PDFs grandes podem demorar
    })
  },
  uploadPhotoByRef: (
    priceTableId: string,
    reference: string,
    imageBlob: Blob,
    overwrite = false,
  ) => {
    const fd = new FormData()
    fd.append('file', imageBlob, `${reference}.jpg`)
    return apiClient.post(
      `/price-tables/${priceTableId}/photo-by-ref?reference=${encodeURIComponent(reference)}&overwrite=${overwrite}`,
      fd,
      { timeout: 60_000 },
    )
  },
  clearProductImages: (id: string) => apiClient.delete(`/price-tables/${id}/images`),
  delete: (id: string) => apiClient.delete(`/price-tables/${id}`),
}

export const productsApi = {
  list: (params: { price_table_id?: string; search?: string; type?: string; include_inactive?: boolean }) =>
    apiClient.get('/products', { params }),
  update: (id: string, data: {
    reference: string
    product_name?: string | null
    model?: string | null
    size_range?: string | null
    base_price: number
    category?: string | null
    observation?: string | null
    type: 'regular' | 'pack'
  }) => apiClient.patch(`/products/${id}`, data),
  uploadImage: (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return apiClient.post(`/products/${id}/image`, fd)
  },
  updateGrade: (product_id: string, grade_configs: Array<{
    color: string | null
    sizes: Record<string, number>
    sort_order: number
  }>) =>
    apiClient.put(`/products/${product_id}/grade`, { grade_configs }),
  setAvailability: (id: string, active: boolean) =>
    apiClient.patch(`/products/${id}/availability`, { active }),
  setBlockedSizes: (id: string, blocked_sizes: string[]) =>
    apiClient.patch(`/products/${id}/blocked-sizes`, { blocked_sizes }),
}

export const clientsApi = {
  list: (search?: string) => apiClient.get('/clients', { params: { search } }),
  create: (data: Partial<ClientPayload>) => apiClient.post('/clients', data),
  update: (id: string, data: Partial<ClientPayload>) =>
    apiClient.put(`/clients/${id}`, data),
  delete: (id: string) => apiClient.delete(`/clients/${id}`),
  importPreview: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return apiClient.post('/clients/import/preview', fd)
  },
  importConfirm: (file: File, mapping: Record<string, string>) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('mapping', JSON.stringify(mapping))
    return apiClient.post('/clients/import/confirm', fd)
  },
}

export interface ClientPayload {
  name: string
  trade_name: string
  cnpj: string
  cpf: string
  state_registration: string
  address: string
  city: string
  state: string
  zip: string
  phone: string
  whatsapp: string
  email: string
  notes: string
}

export const ordersApi = {
  list: (params?: {
    status_id?: string
    factory_id?: string
    rep_id?: string
    date_from?: string
    date_to?: string
    search?: string
  }) => apiClient.get('/orders', { params }),
  get: (id: string) => apiClient.get(`/orders/${id}`),
  create: (data: {
    client_id: string
    factory_id: string
    price_table_id: string
    items: Array<{ product_id: string; reference: string; boxes_count: number; unit_price: number; sizes?: Record<string, number> }>
    discount_pct: number
    notes?: string
    offline_id?: string
    payment_terms?: string
    freight_type?: string
    delivery_date?: string
    industry_order_number?: string
    buyer_name?: string
  }) => apiClient.post('/orders', data),
  updateStatus: (id: string, status_id: string, notes?: string) =>
    apiClient.patch(`/orders/${id}/status`, { status_id, notes }),
  updateInfo: (id: string, data: {
    payment_terms?: string | null
    delivery_date?: string | null
    freight_type?: string | null
    notes?: string | null
    buyer_name?: string | null
    industry_order_number?: string | null
    client_id?: string | null
    rep_id?: string | null
    transportadora?: string | null
  }) => apiClient.patch(`/orders/${id}/info`, data),
  addItems: (id: string, items: Array<{ product_id: string; reference: string; boxes_count: number; unit_price: number; sizes?: Record<string, number> }>) =>
    apiClient.post(`/orders/${id}/items`, { items }),
  removeItem: (id: string, item_id: string) => apiClient.delete(`/orders/${id}/items/${item_id}`),
  updateItem: (id: string, item_id: string, data: { sizes?: Record<string, number>; boxes_count?: number; custom_grade?: Array<{color: string | null; sizes: Record<string, number>; total_pieces: number; sort_order: number}> }) =>
    apiClient.patch(`/orders/${id}/items/${item_id}`, data),
  changePriceTable: (id: string, price_table_id: string, discount_pct: number) =>
    apiClient.put(`/orders/${id}/price-table`, { price_table_id, discount_pct }),
  sync: (orders: unknown[]) => apiClient.post('/orders/sync', { orders }),
  duplicate: (id: string) => apiClient.post(`/orders/${id}/duplicate`, {}),
  delete: (id: string) => apiClient.delete(`/orders/${id}`),
  listTrash: () => apiClient.get('/orders/trash'),
  restore: (id: string) => apiClient.patch(`/orders/${id}/restore`, {}),
}

export const reportsApi = {
  orders: (params: { date_from?: string; date_to?: string; factory_id?: string; rep_id?: string }) =>
    apiClient.get('/reports/orders', { params }),
  commissions: (params: { date_from?: string; date_to?: string; rep_id?: string; factory_id?: string }) =>
    apiClient.get('/reports/commissions', { params }),
  clients: (params: { date_from?: string; date_to?: string; factory_id?: string; rep_id?: string }) =>
    apiClient.get('/reports/clients', { params }),
  products: (params: { date_from?: string; date_to?: string; factory_id?: string; rep_id?: string }) =>
    apiClient.get('/reports/products', { params }),
  collections: (params: { date_from?: string; date_to?: string; factory_id?: string; rep_id?: string }) =>
    apiClient.get('/reports/collections', { params }),
  catalog: (params: { price_table_id?: string; factory_id?: string }) =>
    apiClient.get('/reports/catalog', { params }),
}

export const companyApi = {
  get: () => apiClient.get('/company'),
  update: (data: Record<string, string>) => apiClient.put('/company', data),
  uploadLogo: (file: File) => {
    const fd = new FormData()
    fd.append('logo', file)
    return apiClient.post('/company/logo', fd)
  },
  deleteLogo: () => apiClient.delete('/company/logo'),
}

export const statusesApi = {
  list: () => apiClient.get('/statuses'),
  create: (data: { name: string; color: string; sort_order?: number; is_initial?: boolean; is_final?: boolean }) =>
    apiClient.post('/statuses', data),
  update: (id: string, data: { name?: string; color?: string; sort_order?: number; is_initial?: boolean; is_final?: boolean; active?: boolean }) =>
    apiClient.put(`/statuses/${id}`, data),
  delete: (id: string) => apiClient.delete(`/statuses/${id}`),
}

export const usersApi = {
  list: () => apiClient.get('/users'),
  create: (data: { name: string; email: string; password: string; role: string; factory_ids?: string[] }) =>
    apiClient.post('/users', data),
  update: (id: string, data: { name?: string; email?: string; password?: string; role?: string; active?: boolean; factory_ids?: string[] }) =>
    apiClient.put(`/users/${id}`, data),
  delete: (id: string) => apiClient.delete(`/users/${id}`),
}
