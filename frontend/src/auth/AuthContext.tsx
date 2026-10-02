import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { UNAUTHORIZED_EVENT, request } from '@/lib/api'
import { clearSession, readSession, writeSession } from '@/lib/session'
import type { RegisterIn, TokenOut, UserOut } from '@/lib/types'

interface AuthContextValue {
  user: UserOut | null
  /** True until the stored token has been validated (or found absent). */
  loading: boolean
  login: (email: string, password: string) => Promise<UserOut>
  register: (payload: RegisterIn) => Promise<UserOut>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserOut | null>(null)
  const [loading, setLoading] = useState(true)

  // Boot rehydration: a stored token is validated against /auth/me once; a
  // 401 means it expired/invalid — the API layer clears storage and fires
  // the unauthorized event, and we just drop the in-memory user.
  useEffect(() => {
    const stored = readSession()
    if (stored === null) {
      setLoading(false)
      return
    }
    request<UserOut>('/auth/me')
      .then((me) => {
        setUser(me)
        writeSession({ token: stored.token, user: me })
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const issued = await request<TokenOut>('/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    // The /me result is authoritative (id, email): optimistic store first so
    // the /auth/me request itself carries the Bearer token, then overwrite.
    writeSession({
      token: issued.access_token,
      user: { id: 0, full_name: issued.full_name, email, role: issued.role },
    })
    const me = await request<UserOut>('/auth/me')
    writeSession({
      token: issued.access_token,
      user: {
        id: me.id,
        full_name: me.full_name,
        email: me.email,
        role: me.role,
      },
    })
    setUser(me)
    return me
  }, [])

  // /auth/register always creates a Patient (ADR-0007), auto-logged-in.
  const register = useCallback(async (payload: RegisterIn) => {
    // The returned token is discarded: login() below issues (and stores) its own.
    await request<TokenOut>('/auth/register', {
      method: 'POST',
      body: { ...payload },
    })
    return login(payload.email, payload.password).catch((error) => {
      // Auto-login failed only in pathological cases (token just issued) —
      // surface it but keep the account created.
      clearSession()
      throw error
    })
  }, [login])

  const logout = useCallback(() => {
    clearSession()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error('useAuth must be used within <AuthProvider>')
  }
  return context
}