import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ATTENDANCE_REASON_MIN_LENGTH } from '@ssms/shared';
import { Alert, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { downloadReport, StateBadge, todayStr, useScopeSelection } from './common';

interface ReportTable { title: string; subtitle: string; columns: string[]; rows: Array<Array<string | number>> }

const TYPES: Array<[string, string]> = [
  ['register', 'Monthly register (section)'],
  ['monthly', 'Monthly report (section)'],
  ['class', 'Class-wise report'],
  ['student', 'Student-wise report'],
  ['annual', 'Annual report'],
  ['cumulative', 'Cumulative attendance'],
  ['low', 'Low-attendance students'],
];

export function AttendanceReportsPage() {
  const sel = useScopeSelection();
  const [type, setType] = useState('class');
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [threshold, setThreshold] = useState('');
  const [student, setStudent] = useState('');
  const [err, setErr] = useState('');
  const students = useQuery({
    queryKey: ['att-students-pick', sel.sectionId],
    queryFn: async () => (await api.get<{ data: Array<{ _id: string; name: string; rollNumber: string }> }>('/attendance/students', { params: { section: sel.sectionId, active: 'all', pageSize: 200 } })).data.data,
    enabled: !!sel.sectionId && type === 'student',
  });
  const params = { academicSession: sel.sessionId, class: sel.classId, section: sel.sectionId, month, from, to, threshold, student };
  const preview = useMutation({
    mutationFn: async () => (await api.get<{ data: ReportTable }>(`/attendance/reports/${type}`, { params: { ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)), format: 'json' } })).data.data,
    onError: (e) => setErr(errorMessage(e)),
    onSuccess: () => setErr(''),
  });
  const dl = (f: 'xlsx' | 'csv' | 'pdf') => { setErr(''); downloadReport(type, f, params, `attendance-${type}`).catch((e) => setErr(errorMessage(e))); };
  const t = preview.data;

  return (
    <div>
      <PageHeader title="Attendance Reports" subtitle="Preview on screen, export as PDF, Excel or CSV" />
      {sel.bar(
        <>
          <Field label="Report">
            <Select value={type} onChange={(e) => { setType(e.target.value); preview.reset(); }}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          {type === 'low' && <Field label="Threshold %"><Input type="number" min={1} max={100} value={threshold} placeholder="Default" onChange={(e) => setThreshold(e.target.value)} /></Field>}
          {type === 'student' && (
            <Field label="Student">
              <Select value={student} onChange={(e) => setStudent(e.target.value)}>
                <option value="">Select student</option>
                {(students.data ?? []).map((s) => <option key={s._id} value={s._id}>{s.rollNumber}. {s.name}</option>)}
              </Select>
            </Field>
          )}
        </>,
      )}
      <div className="no-print mb-3 flex flex-wrap gap-2">
        <Button onClick={() => preview.mutate()} disabled={preview.isPending}>Preview</Button>
        <Button variant="outline" onClick={() => dl('pdf')}>PDF</Button>
        <Button variant="outline" onClick={() => dl('xlsx')}>Excel</Button>
        <Button variant="outline" onClick={() => dl('csv')}>CSV</Button>
        {t && <Button variant="outline" onClick={() => window.print()}>Print</Button>}
      </div>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      {preview.isPending && <Spinner />}
      {t && (
        <Card className="overflow-x-auto p-4">
          <h2 className="font-semibold">{t.title}</h2>
          <p className="mb-2 text-sm text-slate-500">{t.subtitle}</p>
          {!t.rows.length ? <Empty /> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-slate-500">{t.columns.map((c) => <th key={c} className="p-1.5">{c}</th>)}</tr></thead>
              <tbody>{t.rows.map((r, i) => <tr key={i} className="border-b">{r.map((c, j) => <td key={j} className="p-1.5">{c}</td>)}</tr>)}</tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

interface HolidayRow { _id: string; date: string; name: string; description?: string }

export function HolidaysPage() {
  const sel = useScopeSelection();
  const { can } = useAuth();
  const manage = can('attendance:manage');
  const qc = useQueryClient();
  const [edit, setEdit] = useState<null | { id?: string; date: string; name: string; description: string }>(null);
  const [err, setErr] = useState('');
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const q = useQuery({
    queryKey: ['att-holidays', sel.sessionId],
    queryFn: async () => (await api.get<{ data: HolidayRow[]; weeklyOffDays: number[] }>('/attendance/holidays', { params: { academicSession: sel.sessionId } })).data,
    enabled: !!sel.sessionId,
  });
  const save = useMutation({
    mutationFn: async (h: NonNullable<typeof edit>) => {
      const body = { academicSession: sel.sessionId, date: h.date, name: h.name, description: h.description || undefined };
      return h.id ? api.patch(`/api/attendance/holidays/${h.id}`, body) : api.post('/api/attendance/holidays', body);
    },
    onSuccess: () => { setEdit(null); setErr(''); void qc.invalidateQueries({ queryKey: ['att-holidays'] }); },
    onError: (e) => setErr(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: async (id: string) => api.delete(`/api/attendance/holidays/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['att-holidays'] }),
    onError: (e) => setErr(errorMessage(e)),
  });
  const items = q.data?.data ?? [];
  const off = q.data?.weeklyOffDays ?? [];
  const byDate = new Map(items.map((h) => [h.date, h]));
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  return (
    <div>
      <PageHeader title="Holidays & Calendar" subtitle="Holidays are excluded from working days" actions={manage && <Button onClick={() => setEdit({ date: todayStr(), name: '', description: '' })}>Add holiday</Button>} />
      {sel.bar(<Field label="Calendar month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>, false)}
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      {q.isLoading ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="font-medium text-slate-500">{d}</div>)}
              {cells.map((d, i) => {
                if (!d) return <div key={i} />;
                const date = `${month}-${String(d).padStart(2, '0')}`;
                const h = byDate.get(date);
                const weekly = off.includes((first + d - 1) % 7);
                return <div key={i} title={h?.name} className={`rounded p-2 ${h ? 'bg-amber-200 font-semibold' : weekly ? 'bg-slate-200 text-slate-500' : 'bg-slate-50'}`}>{d}</div>;
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500"><span className="rounded bg-amber-200 px-1">Holiday</span> <span className="rounded bg-slate-200 px-1">Weekly off</span></p>
          </Card>
          <Card className="p-4">
            {!items.length ? <Empty>No holidays added.</Empty> : (
              <table className="w-full text-sm">
                <tbody>{items.map((h) => (
                  <tr key={h._id} className="border-b"><td className="p-2">{h.date}</td><td className="p-2">{h.name}</td>
                    {manage && <td className="p-2 text-right"><Button size="sm" variant="outline" onClick={() => setEdit({ id: h._id, date: h.date, name: h.name, description: h.description ?? '' })}>Edit</Button>{' '}<Button size="sm" variant="danger" onClick={() => { if (window.confirm(`Remove holiday "${h.name}"?`)) del.mutate(h._id); }}>Remove</Button></td>}
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Card>
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit holiday' : 'Add holiday'} onClose={() => setEdit(null)}>
          <div className="space-y-3">
            <Field label="Date"><Input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field>
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Description"><Textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit.name.trim() || save.isPending} onClick={() => save.mutate(edit)}>Save</Button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

interface HistoryRow { _id: string; at: string; date: string; action: string; studentName?: string; rollNumber?: string; previousStatus?: string; newStatus?: string; reason?: string; byName?: string }

export function AttendanceHistoryPage() {
  const sel = useScopeSelection();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('');
  const [date, setDate] = useState(todayStr());
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  const q = useQuery({
    queryKey: ['att-history', sel.sessionId, sel.classId, sel.sectionId, from, to, action],
    queryFn: async () => (await api.get<{ data: HistoryRow[] }>('/attendance/history', { params: { academicSession: sel.sessionId, class: sel.classId || undefined, section: sel.sectionId || undefined, from: from || undefined, to: to || undefined, action: action || undefined, pageSize: 100 } })).data.data,
    enabled: !!sel.sessionId,
  });
  const regs = useQuery({
    queryKey: ['att-regs', sel.sectionId, date],
    queryFn: async () => (await api.get<{ data: Array<{ state: string }> }>('/attendance/registers', { params: { section: sel.sectionId, from: date, to: date } })).data.data,
    enabled: !!sel.sectionId && can('attendance:lock'),
  });
  const state = regs.data?.[0]?.state;
  const lockOp = useMutation({
    mutationFn: async (op: 'lock' | 'unlock') => api.post(`/api/attendance/registers/${op}`, { section: sel.sectionId, date, ...(op === 'unlock' ? { reason: reason.trim() } : {}) }),
    onSuccess: (_d, op) => { setMsg({ tone: 'green', text: op === 'lock' ? 'Register locked.' : 'Register unlocked.' }); setReason(''); void qc.invalidateQueries(); },
    onError: (e) => setMsg({ tone: 'red', text: errorMessage(e) }),
  });

  return (
    <div>
      <PageHeader title="Attendance History" subtitle="Complete audit trail of marks, corrections, locks and unlocks" />
      {sel.bar(
        <>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Action">
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All</option>{['MARK', 'CORRECT', 'SUBMIT', 'LOCK', 'UNLOCK'].map((a) => <option key={a}>{a}</option>)}
            </Select>
          </Field>
        </>,
      )}
      {can('attendance:lock') && sel.sectionId && (
        <Card className="no-print mb-4 p-4">
          <h3 className="mb-2 font-medium">Lock / unlock register {state && <StateBadge state={state} />}</h3>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label={`Unlock reason (min ${ATTENDANCE_REASON_MIN_LENGTH} chars)`}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Button variant="outline" disabled={lockOp.isPending || state === 'LOCKED'} onClick={() => lockOp.mutate('lock')}>Lock</Button>
            <Button variant="danger" disabled={lockOp.isPending || state !== 'LOCKED' || reason.trim().length < ATTENDANCE_REASON_MIN_LENGTH} onClick={() => lockOp.mutate('unlock')}>Unlock</Button>
          </div>
          {msg && <div className="mt-2"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
        </Card>
      )}
      {q.isLoading ? <Spinner /> : q.error ? <Alert>{errorMessage(q.error)}</Alert> : (
        <Card className="overflow-x-auto p-4">
          {!q.data?.length ? <Empty /> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-slate-500"><th className="p-2">When</th><th className="p-2">Date</th><th className="p-2">Action</th><th className="p-2">Student</th><th className="p-2">Previous</th><th className="p-2">New</th><th className="p-2">Reason</th><th className="p-2">By</th></tr></thead>
              <tbody>{q.data.map((h) => (
                <tr key={h._id} className="border-b"><td className="p-2 whitespace-nowrap">{new Date(h.at).toLocaleString()}</td><td className="p-2">{h.date}</td><td className="p-2">{h.action}</td><td className="p-2">{h.studentName ? `${h.rollNumber}. ${h.studentName}` : '—'}</td><td className="p-2">{h.previousStatus ?? '—'}</td><td className="p-2">{h.newStatus ?? '—'}</td><td className="p-2">{h.reason ?? ''}</td><td className="p-2">{h.byName}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
