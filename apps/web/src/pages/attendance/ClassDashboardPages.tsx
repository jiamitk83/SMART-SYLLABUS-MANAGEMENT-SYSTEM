import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, Empty, Field, Input, PageHeader, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { downloadReport, pctText, StateBadge, todayStr, useScopeSelection } from './common';

interface ClassRow { section: string; label: string; students: number; present: number; absent: number; leave: number; recorded: number; percentage: number | null; lowAttendanceStudents: number }

export function ClassAttendancePage() {
  const sel = useScopeSelection();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [err, setErr] = useState('');
  const q = useQuery({
    queryKey: ['att-class', sel.sessionId, sel.classId, from, to],
    queryFn: async () => (await api.get<{ data: { from: string; to: string; threshold: number; rows: ClassRow[] } }>('/attendance/class', { params: { academicSession: sel.sessionId, class: sel.classId || undefined, from: from || undefined, to: to || undefined } })).data.data,
    enabled: !!sel.sessionId,
  });
  const d = q.data;
  return (
    <div>
      <PageHeader title="Class Attendance" subtitle="Section-wise attendance summary" actions={d && <Button variant="outline" onClick={() => downloadReport('class', 'xlsx', { academicSession: sel.sessionId, class: sel.classId, from, to }, 'class-attendance').catch((e) => setErr(errorMessage(e)))}>Excel</Button>} />
      {sel.bar(<><Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></>, false)}
      {err && <Alert>{err}</Alert>}
      {q.isLoading ? <Spinner /> : q.error ? <Alert>{errorMessage(q.error)}</Alert> : d && (
        <Card className="overflow-x-auto p-4">
          <p className="mb-2 text-sm text-slate-500">{d.from} to {d.to} · low-attendance threshold {d.threshold}%</p>
          {!d.rows.length ? <Empty /> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-slate-500"><th className="p-2">Section</th><th className="p-2">Students</th><th className="p-2">Present</th><th className="p-2">Absent</th><th className="p-2">Leave</th><th className="p-2">%</th><th className="p-2">Low-attendance students</th></tr></thead>
              <tbody>{d.rows.map((r) => (
                <tr key={r.section} className="border-b"><td className="p-2 font-medium">{r.label}</td><td className="p-2">{r.students}</td><td className="p-2">{r.present}</td><td className="p-2">{r.absent}</td><td className="p-2">{r.leave}</td><td className="p-2">{pctText(r.percentage)}</td><td className="p-2">{r.lowAttendanceStudents > 0 ? <Badge tone="red">{r.lowAttendanceStudents}</Badge> : 0}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

interface Dash { date: string; nonWorking: boolean; sections: Array<{ section: string; label: string; state: string; students: number; present: number; absent: number; leave: number }>; totals: { students: number; present: number; absent: number; leave: number }; pendingSections: number; lowAttendanceStudents: number; threshold: number }

export function AttendanceDashboardPage() {
  const sel = useScopeSelection();
  const [date, setDate] = useState(todayStr());
  const q = useQuery({
    queryKey: ['att-dash', sel.sessionId, date],
    queryFn: async () => (await api.get<{ data: Dash }>('/attendance/dashboard', { params: { academicSession: sel.sessionId, date } })).data.data,
    enabled: !!sel.sessionId,
  });
  const d = q.data;
  const tile = (label: string, value: number | string, cls = 'bg-slate-100') => <div className={`rounded-lg p-3 ${cls}`}><div className="text-xs text-slate-600">{label}</div><div className="text-2xl font-semibold">{value}</div></div>;
  return (
    <div>
      <PageHeader title="Attendance Dashboard" subtitle="Daily snapshot across sections" />
      {sel.bar(<Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>, false)}
      {q.isLoading ? <Spinner /> : q.error ? <Alert>{errorMessage(q.error)}</Alert> : d && (
        <>
          {d.nonWorking && <div className="mb-3"><Alert tone="amber">This date is a holiday or weekly off.</Alert></div>}
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
            {tile('Students', d.totals.students)}{tile('Present', d.totals.present, 'bg-green-100')}{tile('Absent', d.totals.absent, 'bg-red-100')}{tile('Leave', d.totals.leave, 'bg-amber-100')}{tile('Pending registers', d.pendingSections, 'bg-amber-50')}{tile(`Below ${d.threshold}%`, d.lowAttendanceStudents, 'bg-red-50')}
          </div>
          <Card className="overflow-x-auto p-4">
            {!d.sections.length ? <Empty /> : (
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-slate-500"><th className="p-2">Section</th><th className="p-2">State</th><th className="p-2">Students</th><th className="p-2">P</th><th className="p-2">A</th><th className="p-2">L</th><th className="p-2" /></tr></thead>
                <tbody>{d.sections.map((s) => (
                  <tr key={s.section} className="border-b"><td className="p-2 font-medium">{s.label}</td><td className="p-2"><StateBadge state={s.state} /></td><td className="p-2">{s.students}</td><td className="p-2">{s.present}</td><td className="p-2">{s.absent}</td><td className="p-2">{s.leave}</td><td className="p-2"><Link className="text-brand-700 underline" to={`/attendance/daily?section=${s.section}`}>Open</Link></td></tr>
                ))}</tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
