import { Navigate, Outlet } from 'react-router'
import { HOME_PATH } from '@/lib/paths'
import type { Role } from '@/lib/types'
import { useAuth } from './AuthContext'

/**
 * Route guard for layout routes: not logged in → /login; logged in as the
 * wrong role → that role's home. Wrap the role's routes like
 * `<Route path="/patient" element={<RequireRole role="patient" />}>`.
 */
export function RequireRole({ role }: { role?: Role }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user === null) return <Navigate to="/login" replace />
  if (role !== undefined && user.role !== role) {
    return <Navigate to={HOME_PATH[user.role]} replace />
  }
  return <Outlet />
}

/** Landing route for `/` (and any unmatched path): each role's home, or login. */
export function RoleRedirect() {
  const { user, loading } = useAuth()
  if (loading) return null
  return <Navigate to={user ? HOME_PATH[user.role] : '/login'} replace />
}