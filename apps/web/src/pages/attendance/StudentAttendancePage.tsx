import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { downloadReport, pctText, STATUS_LABEL, useScopeSelection, type Status } from './common';

interface Summary { present: number; absent: number; leave: number; recorded: number; denominator: number; percentage: number | null }
interface StudentView {
  student: { id: string; name: string; rollNumber: string; admissionNumber: string; isActive: boolean };
  from: string; to: string; summary: Summary; lowAttendance: boolean; threshold: number;
  monthly: Array<Summary & { month: string }>;
  records: Array<{ date: string; status: Status }>;
}
interface StudentRow { _id: string; name: string; rollNumber: string; admissionNumber: string }

export function StudentAttendancePage() {
  const sel = useScopeSelection();
  const [studentId, setStudentId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [err, setErr] = useState('');
  const students = useQuery({
    queryKey: ['att-students-pick', sel.sectionId],
    queryFn: async () => (await api.get<{ data: StudentRow[] }>('/attendance/students', { params: { section: sel.sectionId, active: 'all', pageSize: 200 } })).data.data,
    enabled: !!sel.sectionId,
  });
  const view = useQuery({
    queryKey: ['att-student', studentId, from, to],
    queryFn: async () => (await api.get<{ data: StudentView }>(`/attendance/student/${studentId}`, { params: { from: from || undefined, to: to || undefined } })).data.data,
    enabled: !!studentId,
  });
  const v = view.data;

  return (
    <div>
      <PageHeader title="Student Attendance" subtitle="Individual attendance history and percentage" />
      {sel.bar(
        <>
          <Field label="Student">
            <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">Select student</option>
              {(students.data ?? []).map((s) => <option key={s._id} value={s._id}>{s.rollNumber}. {s.name} ({s.admissionNumber})</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </>,
      )}
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      {!studentId ? <Card><Empty>Select a section, then a student.</Empty></Card> : view.isLoading ? <Spinner /> : view.error ? <Alert>{errorMessage(view.error)}</Alert> : v && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{v.student.name}</h2>
            <span className="text-sm text-slate-500">Roll {v.student.rollNumber} · Adm {v.student.admissionNumber}</span>
            {!v.student.isActive && <Badge tone="gray">Inactive</Badge>}
            {v.lowAttendance && <Badge tone="red">Below {v.threshold}%</Badge>}
            <Button className="no-print ml-auto" variant="outline" size="sm" onClick={() => downloadReport('student', 'pdf', { student: studentId, from, to }, `student-${v.student.admissionNumber}`).catch((e) => setErr(errorMessage(e)))}>PDF</Button>
            <Button className="no-print" variant="outline" size="sm" onClick={() => downloadReport('student', 'xlsx', { student: studentId, from, to }, `student-${v.student.admissionNumber}`).catch((e) => setErr(errorMessage(e)))}>Excel</Button>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-5">
            <div className="rounded bg-green-100 p-2">Present <b>{v.summary.present}</b></div>
            <div className="rounded bg-red-100 p-2">Absent <b>{v.summary.absent}</b></div>
            <div className="rounded bg-amber-100 p-2">Leave <b>{v.summary.leave}</b></div>
            <div className="rounded bg-slate-100 p-2">Recorded <b>{v.summary.recorded}</b></div>
            <div className="rounded bg-brand-100 p-2">Attendance <b>{pctText(v.summary.percentage)}</b></div>
          </div>
          <h3 className="mb-1 font-medium">Month-wise</h3>
          <table className="mb-4 w-full text-sm">
            <thead><tr className="border-b text-left text-slate-500"><th className="p-1">Month</th><th className="p-1">P</th><th className="p-1">A</th><th className="p-1">L</th><th className="p-1">%</th></tr></thead>
            <tbody>{v.monthly.map((m) => <tr key={m.month} className="border-b"><td className="p-1">{m.month}</td><td className="p-1">{m.present}</td><td className="p-1">{m.absent}</td><td className="p-1">{m.leave}</td><td className="p-1">{pctText(m.percentage)}</td></tr>)}</tbody>
          </table>
          <h3 className="mb-1 font-medium">Daily records ({v.records.length})</h3>
          <div className="flex flex-wrap gap-1">
            {v.records.map((r) => <span key={r.date} className={`rounded px-2 py-0.5 text-xs ${r.status === 'PRESENT' ? 'bg-green-100' : r.status === 'ABSENT' ? 'bg-red-100' : 'bg-amber-100'}`} title={STATUS_LABEL[r.status]}>{r.date.slice(5)} {r.status[0]}</span>)}
          </div>
        </Card>
      )}
    </div>
  );
}
