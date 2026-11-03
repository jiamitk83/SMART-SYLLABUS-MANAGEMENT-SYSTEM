import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, PageHeader, ProgressBar, Spinner, Alert } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/utils';
import { useAuth } from '@/store/auth';

const pct = (n?: number | null) => Math.round((n ?? 0) * 10) / 10;

interface Summary { planned: number; actual: number; chapters: number; completedChapters: number; delayedChapters: number }
interface Group extends Summary { key: string; name: string }
interface Dash {
  role: string;
  overall: Summary;
  bySubject: Group[];
  byClass: Group[];
  delayed: Array<{ chapter: string; class?: string; section?: string; subject?: string; progress: number; plannedEnd?: string }>;
  pendingApprovals: number;
  todayRecords: number;
  draftRecords: number;
  unreadNotifications: number;
  recentTeaching: Array<{ _id: string; date: string; description?: string; teachingStatus: string; periodNumber: number }>;
  counts?: Record<string, number>;
  myAssignments?: number;
  teacherPerformance?: Array<Summary & { teacher: string }>;
}

function Stat({ label, value, to, tone }: { label: string; value: string | number; to?: string; tone?: string }) {
  const body = (
    <Card className="h-full">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone ?? ''}`}>{value}</div>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function GroupChart({ title, data }: { title: string; data: Group[] }) {
  const rows = data.map((g) => ({ name: g.name, Planned: pct(g.planned), Actual: pct(g.actual) }));
  return (
    <Card>
      <h2 className="mb-2 font-medium">{title}</h2>
      {rows.length === 0 ? <Empty /> : (
        <div className="h-64" aria-label={title}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis domain={[0, 100]} fontSize={12} unit="%" />
              <Tooltip />
              <Legend />
              <Bar dataKey="Planned" fill="#94a3b8" />
              <Bar dataKey="Actual" fill="#2563eb" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: async () => (await api.get<{ data: Dash }>('/dashboard')).data.data });
  if (isLoading) return <Spinner />;
  if (error || !data) return <Alert>{errorMessage(error)}</Alert>;
  const o = data.overall;
  const isTeacher = data.role === 'TEACHER';
  return (
    <div className="space-y-4">
      <PageHeader title={`Welcome, ${user?.fullName ?? ''}`} subtitle="Syllabus progress for the current academic session" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Actual progress" value={`${pct(o.actual)}%`} tone="text-brand-700" />
        <Stat label="Planned progress" value={`${pct(o.planned)}%`} />
        <Stat label="Chapters completed" value={`${o.completedChapters} / ${o.chapters}`} to="/completions" />
        <Stat label="Delayed chapters" value={o.delayedChapters} tone={o.delayedChapters ? 'text-red-600' : ''} to="/reports" />
        {isTeacher ? (
          <>
            <Stat label="Today's entries" value={data.todayRecords} to="/teaching" />
            <Stat label="Draft entries" value={data.draftRecords} to="/teaching" />
            <Stat label="My assignments" value={data.myAssignments ?? 0} />
          </>
        ) : (
          <>
            <Stat label="Pending approvals" value={data.pendingApprovals} to="/completions" />
            <Stat label="Today's entries" value={data.todayRecords} />
            {Object.entries(data.counts ?? {}).map(([k, v]) => <Stat key={k} label={k} value={v} />)}
          </>
        )}
        <Stat label="Unread notifications" value={data.unreadNotifications} to="/notifications" />
      </div>
      <Card>
        <div className="mb-1 flex justify-between text-sm"><span>Overall syllabus progress</span><span>{pct(o.actual)}% of {pct(o.planned)}% planned</span></div>
        <ProgressBar value={o.actual} planned={o.planned} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <GroupChart title="Progress by subject" data={data.bySubject} />
        <GroupChart title="Progress by class" data={data.byClass} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-medium">Delayed chapters</h2>
          {data.delayed.length === 0 ? <Empty>No delayed chapters.</Empty> : (
            <ul className="divide-y text-sm">
              {data.delayed.map((d, i) => (
                <li key={i} className="flex items-center justify-between py-2">
                  <span>{d.chapter} <span className="text-slate-500">({d.class}-{d.section} {d.subject})</span></span>
                  <Badge tone="red">{pct(d.progress)}%</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 font-medium">Recent teaching entries</h2>
          {data.recentTeaching.length === 0 ? <Empty /> : (
            <ul className="divide-y text-sm">
              {data.recentTeaching.map((t) => (
                <li key={t._id} className="flex justify-between py-2"><span>{fmtDate(t.date)} · P{t.periodNumber} · {t.description || '—'}</span><Badge tone={t.teachingStatus === 'COMPLETED' ? 'green' : 'amber'}>{t.teachingStatus}</Badge></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {data.teacherPerformance && data.teacherPerformance.length > 0 && (
        <Card>
          <h2 className="mb-2 font-medium">Teachers needing attention (lowest progress)</h2>
          <ul className="divide-y text-sm">
            {data.teacherPerformance.map((t) => (
              <li key={t.teacher} className="grid grid-cols-[1fr_8rem_4rem] items-center gap-2 py-2"><span>{t.teacher}</span><ProgressBar value={t.actual} planned={t.planned} /><span className="text-right">{pct(t.actual)}%</span></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
