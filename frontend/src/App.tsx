import { Navigate, Route, Routes } from 'react-router'
import { RequireRole, RoleRedirect } from '@/auth/RequireRole'
import { AppShell } from '@/components/AppShell'
import LoginPage from '@/pages/login/LoginPage'
import RegisterPage from '@/pages/login/RegisterPage'
import BookPage from '@/pages/patient/BookPage'
import MyAppointmentsPage from '@/pages/patient/MyAppointmentsPage'
import MyRecordsPage from '@/pages/patient/MyRecordsPage'
import DoctorAppointmentsPage from '@/pages/doctor/DoctorAppointmentsPage'
import UsersPage from '@/pages/admin/UsersPage'
import DepartmentsPage from '@/pages/admin/DepartmentsPage'
import PatientsPage from '@/pages/admin/PatientsPage'
import BillingPage from '@/pages/admin/BillingPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route path="/patient" element={<RequireRole role="patient" />}>
        <Route element={<AppShell role="patient" />}>
          <Route index element={<BookPage />} />
          <Route path="appointments" element={<MyAppointmentsPage />} />
          <Route path="records" element={<MyRecordsPage />} />
        </Route>
      </Route>

      <Route path="/doctor" element={<RequireRole role="doctor" />}>
        <Route element={<AppShell role="doctor" />}>
          <Route index element={<DoctorAppointmentsPage />} />
        </Route>
      </Route>

      <Route path="/admin" element={<RequireRole role="admin" />}>
        <Route element={<AppShell role="admin" />}>
          <Route index element={<Navigate to="/admin/users" replace />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="departments" element={<DepartmentsPage />} />
          <Route path="patients" element={<PatientsPage />} />
          <Route path="billing" element={<BillingPage />} />
        </Route>
      </Route>

      <Route path="*" element={<RoleRedirect />} />
    </Routes>
  )
}