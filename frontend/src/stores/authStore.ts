import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: 'admin' | 'representante'
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  refreshToken: string | null
  login: (user: AuthUser, accessToken: string, refreshToken: string) => void
  setAccessToken: (token: string) => void
  logout: () => void
  isAdmin: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,

      login: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken }),

      setAccessToken: (token) => set({ accessToken: token }),

      logout: () => set({ user: null, accessToken: null, refreshToken: null }),

      isAdmin: () => get().user?.role === 'admin',
    }),
    {
      name: 'somma-auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    }
  )
)
