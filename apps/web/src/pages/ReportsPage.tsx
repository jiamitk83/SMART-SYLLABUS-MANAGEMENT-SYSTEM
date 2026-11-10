import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Input, PageHeader, Select, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import { useClassesSections, useSessions, useSubjects, useTeachers, sectionLabel } from '@/lib/hooks';

const KINDS: Array<[string, string]> = [
  ['daily-teaching', 'Daily teaching'], ['teacher-wise', 'Teacher-wise progress'], ['class-wise', 'Class-wise progress'], ['subject-wise', 'Subject-wise progress'],
  ['chapter-completion', 'Chapter completion'], ['monthly', 'Monthly'], ['annual', 'Annual'], ['pending', 'Pending syllabus'], ['delayed', 'Delayed chapters'],
];
interface Table { title: string; subtitle?: string; columns: string[]; rows: Array<Array<string | number>> }

export function ReportsPage() {
  const { current } = useSessions();
  const { sections } = useClassesSections(current?._id);
  const subjects = useSubjects();
  const teachers = useTeachers();
  const [kind, setKind] = useState('daily-teaching');
  const [section, setSection] = useState('');
  const [subject, setSubject] = useState('');
  const [teacher, setTeacher] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [run, setRun] = useState<Record<string, string> | null>(null);
  const [dlErr, setDlErr] = useState('');

  const build = () => {
    const p: Record<string, string> = { academicSession: current?._id ?? '' };
    if (section) p.section = section;
    if (subject) p.subject = subject;
    if (teacher) p.teacher = teacher;
    if (from) p.from = from;
    if (to) p.to = to;
    if (kind === 'monthly') p.month = month;
    return p;
  };
  const q = useQuery({
    queryKey: ['report', kind, run],
    enabled: !!run,
    queryFn: async () => { const d = (await api.get(`/api/reports/${kind}`, { params: { ...run, format: 'json' } })).data as { data?: Table } & Table; return d.data ?? d; },
  });
  const download = async (format: 'xlsx' | 'pdf') => {
    setDlErr('');
    try {
      const r = await api.get(`/api/reports/${kind}`, { params: { ...build(), format }, responseType: 'blob' });
      downloadBlob(r.data as Blob, `${kind}.${format}`);
    } catch (e) { setDlErr(errorMessage(e)); }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle="Preview on screen, export to Excel or PDF" />
      <Card className="space-y-3">
        <div className="grid gap-2 md:grid-cols-3">
          <Select value={kind} onChange={(e) => { setKind(e.target.value); setRun(null); }} aria-label="Report type">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section"><option value="">All sections</option>{sections.map((s) => <option key={s._id} value={s._id}>{sectionLabel(s)}</option>)}</Select>
          <Select value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject"><option value="">All subjects</option>{subjects.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
          <Select value={teacher} onChange={(e) => setTeacher(e.target.value)} aria-label="Teacher"><option value="">All teachers</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}</Select>
          {kind === 'monthly' ? <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" /> : <>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </>}
        </div>
        <div className="flex gap-2">
          <Button disabled={!current} onClick={() => setRun(build())}>Generate</Button>
          <Button variant="outline" disabled={!current} onClick={() => void download('xlsx')}>Excel</Button>
          <Button variant="outline" disabled={!current} onClick={() => void download('pdf')}>PDF</Button>
        </div>
        {dlErr && <Alert>{dlErr}</Alert>}
      </Card>
      {run && (q.isLoading ? <Spinner /> : q.error ? <Alert>{errorMessage(q.error)}</Alert> : q.data && (
        <Card className="overflow-x-auto p-0">
          <div className="p-3"><h2 className="font-medium">{q.data.title}</h2>{q.data.subtitle && <p className="text-xs text-slate-500">{q.data.subtitle}</p>}</div>
          {q.data.rows.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No data for these filters.</div> : (
            <table className="w-full text-left text-sm">
              <thead className="border-y bg-slate-50 text-xs uppercase text-slate-500"><tr>{q.data.columns.map((c) => <th key={c} className="px-3 py-2">{c}</th>)}</tr></thead>
              <tbody className="divide-y">{q.data.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="px-3 py-2">{v}</td>)}</tr>)}</tbody>
            </table>
          )}
        </Card>
      ))}
    </div>
  );
}
