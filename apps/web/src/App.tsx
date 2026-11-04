import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { Permission } from '@ssms/shared';
import { Layout } from '@/components/Layout';
import { refreshSession } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { Spinner } from '@/components/ui';
import { LoginPage, ForgotPasswordPage, ResetPasswordPage } from '@/pages/AuthPages';
import { DashboardPage } from '@/pages/DashboardPage';
import { UsersPage, RolesPage } from '@/pages/UsersPage';
import { AcademicPage } from '@/pages/AcademicPage';
import { SyllabusPage } from '@/pages/SyllabusPage';
import { PlansPage } from '@/pages/PlansPage';
import { TeachingPage } from '@/pages/TeachingPage';
import { CompletionsPage } from '@/pages/CompletionsPage';
import { ProgressPage } from '@/pages/ProgressPage';
import { AssessmentsPage } from '@/pages/AssessmentsPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { AuditPage } from '@/pages/AuditPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { MarkAttendancePage } from '@/pages/attendance/MarkAttendancePage';
import { DailyRegisterPage } from '@/pages/attendance/DailyRegisterPage';
import { MonthlyRegisterPage } from '@/pages/attendance/MonthlyRegisterPage';
import { StudentAttendancePage } from '@/pages/attendance/StudentAttendancePage';
import { AttendanceDashboardPage, ClassAttendancePage } from '@/pages/attendance/ClassDashboardPages';
import { AttendanceReportsPage, AttendanceHistoryPage, HolidaysPage } from '@/pages/attendance/ReportsHolidaysHistoryPages';
import { AttendanceSettingsPage, StudentsPage } from '@/pages/attendance/SettingsStudentsPages';

export function Guard({ perm, children }: { perm?: Permission; children: JSX.Element }) {
  const { user, ready, can } = useAuth();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/profile" replace state={{ forced: true }} />;
  if (perm && !can(perm)) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  const { ready, setReady, user } = useAuth();
  useEffect(() => {
    void refreshSession().finally(setReady);
  }, [setReady]);

  if (!ready) return <Spinner />;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={user ? <Layout /> : <Navigate to="/login" replace />}>
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/" element={<Guard perm="dashboard:read"><DashboardPage /></Guard>} />
        <Route path="/progress" element={<Guard perm="dashboard:read"><ProgressPage /></Guard>} />
        <Route path="/attendance" element={<Guard perm="attendance:read"><AttendanceDashboardPage /></Guard>} />
        <Route path="/attendance/mark" element={<Guard perm="attendance:mark"><MarkAttendancePage /></Guard>} />
        <Route path="/attendance/daily" element={<Guard perm="attendance:read"><DailyRegisterPage /></Guard>} />
        <Route path="/attendance/monthly" element={<Guard perm="attendance:read"><MonthlyRegisterPage /></Guard>} />
        <Route path="/attendance/student" element={<Guard perm="attendance:read"><StudentAttendancePage /></Guard>} />
        <Route path="/attendance/class" element={<Guard perm="attendance:read"><ClassAttendancePage /></Guard>} />
        <Route path="/attendance/reports" element={<Guard perm="attendance:read"><AttendanceReportsPage /></Guard>} />
        <Route path="/attendance/holidays" element={<Guard perm="attendance:read"><HolidaysPage /></Guard>} />
        <Route path="/attendance/history" element={<Guard perm="attendance:read"><AttendanceHistoryPage /></Guard>} />
        <Route path="/attendance/settings" element={<Guard perm="attendance:manage"><AttendanceSettingsPage /></Guard>} />
        <Route path="/attendance/students" element={<Guard perm="attendance:manage"><StudentsPage /></Guard>} />
        <Route path="/users" element={<Guard perm="users:manage"><UsersPage /></Guard>} />
        <Route path="/roles" element={<Guard perm="roles:manage"><RolesPage /></Guard>} />
        <Route path="/academic" element={<Guard perm="academic:read"><AcademicPage /></Guard>} />
        <Route path="/syllabus" element={<Guard perm="syllabus:read"><SyllabusPage /></Guard>} />
        <Route path="/plans" element={<Guard perm="plans:read"><PlansPage /></Guard>} />
        <Route path="/teaching" element={<Guard perm="teaching:write"><TeachingPage /></Guard>} />
        <Route path="/completions" element={<Guard perm="dashboard:read"><CompletionsPage /></Guard>} />
        <Route path="/assessments" element={<Guard perm="assessments:read"><AssessmentsPage /></Guard>} />
        <Route path="/reports" element={<Guard perm="reports:read"><ReportsPage /></Guard>} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/audit" element={<Guard perm="audit:read"><AuditPage /></Guard>} />
        <Route path="/settings" element={<Guard perm="settings:manage"><SettingsPage /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
