import { useQuery } from '@tanstack/react-query';
import { Bell, BookOpen, CalendarDays, CheckSquare, ClipboardList, FileBarChart, GraduationCap, LayoutDashboard, LineChart, LogOut, ScrollText, Settings, ShieldCheck, Users, UserCircle, FlaskConical, UserCheck, type LucideIcon } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { Permission } from '@ssms/shared';
import { api } from '@/lib/api';
import { ROLE_LABEL, cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';

const NAV: Array<{ to: string; label: string; icon: LucideIcon; perm?: Permission }> = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard:read' },
  { to: '/progress', label: 'Progress', icon: LineChart, perm: 'dashboard:read' },
  { to: '/teaching', label: 'Daily Teaching', icon: ClipboardList, perm: 'teaching:write' },
  { to: '/completions', label: 'Chapter Completion', icon: CheckSquare, perm: 'dashboard:read' },
  { to: '/plans', label: 'Planning', icon: CalendarDays, perm: 'plans:read' },
  { to: '/syllabus', label: 'Syllabus', icon: BookOpen, perm: 'syllabus:read' },
  { to: '/assessments', label: 'Worksheets & Tests', icon: FlaskConical, perm: 'assessments:read' },
  { to: '/attendance', label: 'Attendance', icon: UserCheck, perm: 'attendance:read' },
  { to: '/attendance/mark', label: 'Mark Attendance', icon: UserCheck, perm: 'attendance:mark' },
  { to: '/attendance/daily', label: 'Daily Register', icon: UserCheck, perm: 'attendance:read' },
  { to: '/attendance/monthly', label: 'Monthly Register', icon: UserCheck, perm: 'attendance:read' },
  { to: '/attendance/student', label: 'Student Attendance', icon: UserCheck, perm: 'attendance:read' },
  { to: '/attendance/class', label: 'Class Attendance', icon: UserCheck, perm: 'attendance:read' },
  { to: '/attendance/reports', label: 'Attendance Reports', icon: UserCheck, perm: 'attendance:read' },
  { to: '/attendance/holidays', label: 'Holidays & Calendar', icon: UserCheck, perm: 'attendance:read' },
  { to: '/attendance/history', label: 'Attendance History', icon: UserCheck, perm: 'attendance:read' },
  { to: '/attendance/students', label: 'Students', icon: UserCheck, perm: 'attendance:manage' },
  { to: '/attendance/settings', label: 'Attendance Settings', icon: UserCheck, perm: 'attendance:manage' },
  { to: '/reports', label: 'Reports', icon: FileBarChart, perm: 'reports:read' },
  { to: '/academic', label: 'Academic Setup', icon: GraduationCap, perm: 'academic:read' },
  { to: '/users', label: 'Users', icon: Users, perm: 'users:manage' },
  { to: '/roles', label: 'Roles', icon: ShieldCheck, perm: 'roles:manage' },
  { to: '/settings', label: 'Settings', icon: Settings, perm: 'settings:manage' },
  { to: '/audit', label: 'Audit Log', icon: ScrollText, perm: 'audit:read' },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/profile', label: 'Profile', icon: UserCircle },
];

export function Layout() {
  const { user, can, setSession } = useAuth();
  const navigate = useNavigate();
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: async () => (await api.get<{ meta: { unread: number } }>('/notifications', { params: { pageSize: 1 } })).data.meta.unread,
    refetchInterval: 60_000,
  });

  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setSession(null, null);
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-brand-900 text-brand-100 md:flex">
        <div className="px-4 py-5 text-lg font-semibold text-white">SSMS</div>
        <nav className="flex-1 space-y-0.5 px-2" aria-label="Main">
          {NAV.filter((n) => !n.perm || can(n.perm)).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/' || to === '/attendance'} className={({ isActive }) => cn('flex items-center gap-2 rounded-md px-3 py-2 text-sm', isActive ? 'bg-brand-700 text-white' : 'hover:bg-brand-800')}>
              <Icon size={16} />
              <span className="flex-1">{label}</span>
              {to === '/notifications' && !!unread.data && <span className="rounded-full bg-amber-500 px-1.5 text-xs text-white">{unread.data}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-white px-4 py-3">
          <span className="font-medium text-brand-800 md:hidden">SSMS</span>
          <span className="hidden text-sm text-slate-500 md:block">Smart Syllabus Management System</span>
          <div className="flex items-center gap-3 text-sm">
            <span>{user?.fullName} <span className="text-slate-400">· {user ? ROLE_LABEL[user.role] : ''}</span></span>
            <button onClick={logout} className="flex items-center gap-1 rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"><LogOut size={15} /> Sign out</button>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b bg-white px-2 py-1 md:hidden" aria-label="Mobile">
          {NAV.filter((n) => !n.perm || can(n.perm)).map(({ to, label }) => (
            <NavLink key={to} to={to} end={to === '/' || to === '/attendance'} className={({ isActive }) => cn('whitespace-nowrap rounded px-2 py-1 text-xs', isActive ? 'bg-brand-600 text-white' : 'text-slate-600')}>{label}</NavLink>
          ))}
        </nav>
        <main className="flex-1 p-4 md:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
