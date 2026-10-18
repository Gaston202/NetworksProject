import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router'
import { RequireRole, RoleRedirect } from '@/auth/RequireRole'
import { AppShell } from '@/components/AppShell'
import { PageLoading } from '@/components/PageState'
import LoginPage from '@/pages/login/LoginPage'
import RegisterPage from '@/pages/login/RegisterPage'

// Role pages are split per route: a patient never downloads the admin screens.
const BookPage = lazy(() => import('@/pages/patient/BookPage'))
const PatientHomePage = lazy(() => import('@/pages/patient/HomePage'))
const MyAppointmentsPage = lazy(() => import('@/pages/patient/MyAppointmentsPage'))
const MyRecordsPage = lazy(() => import('@/pages/patient/MyRecordsPage'))
const DoctorAppointmentsPage = lazy(() => import('@/pages/doctor/DoctorAppointmentsPage'))
const SchedulePage = lazy(() => import('@/pages/doctor/SchedulePage'))
const DoctorHomePage = lazy(() => import('@/pages/doctor/HomePage'))
const AdminHomePage = lazy(() => import('@/pages/admin/HomePage'))
const UsersPage = lazy(() => import('@/pages/admin/UsersPage'))
const DepartmentsPage = lazy(() => import('@/pages/admin/DepartmentsPage'))
const PatientsPage = lazy(() => import('@/pages/admin/PatientsPage'))
const BillingPage = lazy(() => import('@/pages/admin/BillingPage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <PageLoading rows={4} />
        </div>
      }
    >
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
    </Suspense>
  )
}