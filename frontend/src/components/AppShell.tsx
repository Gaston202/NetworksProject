import { NavLink, Outlet, useNavigate } from 'react-router'
import {
  Building2,
  CalendarPlus,
  CalendarRange,
  FileText,
  LogOut,
  ReceiptText,
  UserRound,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { RoleBadge } from '@/components/RoleBadge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { Role } from '@/lib/types'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** NavLink `end` — needed on index routes so they don't stay active. */
  end?: boolean
}

const NAV: Record<Role, NavItem[]> = {
  patient: [
    { to: '/patient', label: 'Book appointment', icon: CalendarPlus, end: true },
    { to: '/patient/appointments', label: 'My appointments', icon: CalendarRange },
    { to: '/patient/records', label: 'My records', icon: FileText },
  ],
  doctor: [{ to: '/doctor', label: 'My queue', icon: CalendarRange, end: true }],
  admin: [
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/admin/departments', label: 'Departments', icon: Building2 },
    { to: '/admin/patients', label: 'Patients & walk-in', icon: UserRound },
    { to: '/admin/billing', label: 'Billing', icon: ReceiptText },
  ],
}

/** Sidebar (md+) + header layout shared by every authenticated role's pages. */
export function AppShell({ role }: { role: Role }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const items = NAV[role]

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center px-4 text-sm font-semibold tracking-tight">
          Hospital Management System
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2 py-2">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive
                  ? 'rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary'
                  : 'rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
              }
            >
              <span className="flex items-center gap-2">
                <item.icon className="size-4" />
                {item.label}
              </span>
            </NavLink>
          ))}
        </nav>
        <Separator />
        <div className="flex items-center gap-2 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.full_name}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Log out">
            <LogOut className="size-4" />
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 md:px-6">
          <span className="font-semibold md:hidden">HMS</span>
          <nav className="flex items-center gap-1 overflow-x-auto md:hidden">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                aria-label={item.label}
                className={({ isActive }) =>
                  isActive
                    ? 'rounded-md bg-primary/10 p-2 text-primary'
                    : 'rounded-md p-2 text-muted-foreground hover:text-foreground'
                }
              >
                <item.icon className="size-4" />
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <RoleBadge role={role} />
            <Button variant="ghost" size="sm" onClick={handleLogout} className="md:hidden">
              <LogOut className="size-4" />
              Log out
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}