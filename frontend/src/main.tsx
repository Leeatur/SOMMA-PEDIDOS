import React from 'react'
import ReactDOM from 'react-dom/client'

// Auto-reload when new service worker takes control (ensures updates apply immediately)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload()
  })
  // Force check for new SW every time the app gains focus or becomes visible
  const checkUpdate = () =>
    navigator.serviceWorker.getRegistration().then(reg => reg?.update()).catch(() => {})
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate() })
  window.addEventListener('focus', checkUpdate)
  checkUpdate()
}
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutos — reduz refetch desnecessário
      retry: (failureCount, error) => {
        // Don't retry 401/403
        const status = (error as { response?: { status: number } })?.response?.status
        if (status === 401 || status === 403) return false
        return failureCount < 2
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
)
