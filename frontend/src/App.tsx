import { Route, Routes } from 'react-router'
import { RequireRole, RoleRedirect } from '@/auth/RequireRole'
import { AppShell } from '@/components/AppShell'
import LoginPage from '@/pages/login/LoginPage'
import RegisterPage from '@/pages/login/RegisterPage'
import BookPage from '@/pages/patient/BookPage'
import PatientHomePage from '@/pages/patient/HomePage'
import MyAppointmentsPage from '@/pages/patient/MyAppointmentsPage'
import MyRecordsPage from '@/pages/patient/MyRecordsPage'
import DoctorAppointmentsPage from '@/pages/doctor/DoctorAppointmentsPage'
import SchedulePage from '@/pages/doctor/SchedulePage'
import DoctorHomePage from '@/pages/doctor/HomePage'
import AdminHomePage from '@/pages/admin/HomePage'
import UsersPage from '@/pages/admin/UsersPage'
import DepartmentsPage from '@/pages/admin/DepartmentsPage'
import PatientsPage from '@/pages/admin/PatientsPage'
import BillingPage from '@/pages/admin/BillingPage'
import ProfilePage from '@/pages/ProfilePage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route path="/patient" element={<RequireRole role="patient" />}>
        <Route element={<AppShell role="patient" />}>
          <Route index element={<PatientHomePage />} />
          <Route path="book" element={<BookPage />} />
          <Route path="appointments" element={<MyAppointmentsPage />} />
          <Route path="records" element={<MyRecordsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="/doctor" element={<RequireRole role="doctor" />}>
        <Route element={<AppShell role="doctor" />}>
          <Route index element={<DoctorHomePage />} />
          <Route path="queue" element={<DoctorAppointmentsPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="/admin" element={<RequireRole role="admin" />}>
        <Route element={<AppShell role="admin" />}>
          <Route index element={<AdminHomePage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="departments" element={<DepartmentsPage />} />
          <Route path="patients" element={<PatientsPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="*" element={<RoleRedirect />} />
    </Routes>
  )
}