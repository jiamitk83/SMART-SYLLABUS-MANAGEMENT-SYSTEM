import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useScopeSelection } from './common';

interface Settings { lowThreshold: number; weeklyOffDays: number[]; leaveExcluded: boolean; schoolName: string; logoDataUrl: string }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function AttendanceSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['att-settings'], queryFn: async () => (await api.get<{ data: Settings }>('/attendance/settings')).data.data });
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: async (v: Settings) => api.put('/api/attendance/settings', v),
    onSuccess: () => { setMsg({ tone: 'green', text: 'Settings saved.' }); void qc.invalidateQueries({ queryKey: ['att-settings'] }); },
    onError: (e) => setMsg({ tone: 'red', text: errorMessage(e) }),
  });
  const onLogo = (file?: File) => {
    if (!file || !s) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 250_000) { setMsg({ tone: 'red', text: 'Logo must be a PNG or JPEG under 250 KB.' }); return; }
    const r = new FileReader();
    r.onload = () => setS({ ...s, logoDataUrl: String(r.result) });
    r.readAsDataURL(file);
  };
  if (q.isLoading || !s) return <Spinner />;
  return (
    <div>
      <PageHeader title="Attendance Settings" subtitle="Applies to all attendance calculations and printed registers" />
      <Card className="max-w-2xl space-y-4 p-4">
        <Field label="School name (printed on registers)"><Input value={s.schoolName} onChange={(e) => setS({ ...s, schoolName: e.target.value })} /></Field>
        <Field label="School logo (PNG/JPEG, optional)">
          <div className="flex items-center gap-3">
            {s.logoDataUrl && <img src={s.logoDataUrl} alt="School logo" className="h-12" />}
            <input type="file" accept="image/png,image/jpeg" onChange={(e) => onLogo(e.target.files?.[0])} aria-label="Logo file" />
            {s.logoDataUrl && <Button variant="outline" size="sm" onClick={() => setS({ ...s, logoDataUrl: '' })}>Remove</Button>}
          </div>
        </Field>
        <Field label="Low-attendance threshold (%)"><Input type="number" min={1} max={100} value={s.lowThreshold} onChange={(e) => setS({ ...s, lowThreshold: Number(e.target.value) })} /></Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Weekly off days</legend>
          <div className="flex flex-wrap gap-3">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={s.weeklyOffDays.includes(i)} onChange={(e) => setS({ ...s, weeklyOffDays: e.target.checked ? [...s.weeklyOffDays, i] : s.weeklyOffDays.filter((x) => x !== i) })} />{d}</label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={s.leaveExcluded} onChange={(e) => setS({ ...s, leaveExcluded: e.target.checked })} />
          <span>Exclude Leave from the percentage denominator (percentage = Present ÷ (Present + Absent)). Off by default: Present ÷ (Present + Absent + Leave).</span>
        </label>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Button disabled={save.isPending || !s.schoolName.trim()} onClick={() => { setMsg(null); save.mutate(s); }}>Save settings</Button>
      </Card>
    </div>
  );
}

interface StudentRow { _id: string; name: string; rollNumber: string; admissionNumber: string; gender?: string; guardianName?: string; guardianPhone?: string; isActive: boolean }
type Form = { id?: string; rollNumber: string; admissionNumber: string; name: string; gender: string; guardianName: string; guardianPhone: string };
const EMPTY: Form = { rollNumber: '', admissionNumber: '', name: '', gender: '', guardianName: '', guardianPhone: '' };

export function StudentsPage() {
  const sel = useScopeSelection();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [bulk, setBulk] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  const q = useQuery({
    queryKey: ['att-students', sel.sectionId, search],
    queryFn: async () => (await api.get<{ data: StudentRow[] }>('/attendance/students', { params: { section: sel.sectionId, q: search || undefined, active: 'all', pageSize: 200 } })).data.data,
    enabled: !!sel.sectionId,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['att-students'] });
  const save = useMutation({
    mutationFn: async (f: Form) => {
      const body = { rollNumber: f.rollNumber, name: f.name, gender: f.gender || undefined, guardianName: f.guardianName || undefined, guardianPhone: f.guardianPhone || undefined };
      return f.id ? api.patch(`/api/attendance/students/${f.id}`, body) : api.post('/api/attendance/students', { section: sel.sectionId, admissionNumber: f.admissionNumber, ...body });
    },
    onSuccess: () => { setForm(null); setMsg(null); refresh(); },
    onError: (e) => setMsg({ tone: 'red', text: errorMessage(e) }),
  });
  const toggle = useMutation({
    mutationFn: async (st: StudentRow) => api.patch(`/api/attendance/students/${st._id}`, { isActive: !st.isActive }),
    onSuccess: refresh,
    onError: (e) => setMsg({ tone: 'red', text: errorMessage(e) }),
  });
  const importBulk = useMutation({
    mutationFn: async (text: string) => {
      const students = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const [rollNumber = '', admissionNumber = '', ...name] = l.split(',').map((x) => x.trim());
        return { rollNumber, admissionNumber, name: name.join(', ') };
      });
      return (await api.post<{ data: { created: number; skipped: unknown[] } }>('/attendance/students/bulk', { section: sel.sectionId, students })).data.data;
    },
    onSuccess: (r) => { setBulk(null); setMsg({ tone: 'green', text: `Added ${r.created} students; skipped ${r.skipped.length} duplicates/invalid.` }); refresh(); },
    onError: (e) => setMsg({ tone: 'red', text: errorMessage(e) }),
  });

  return (
    <div>
      <PageHeader title="Students" subtitle="Student master used by attendance. Students are deactivated, never deleted." actions={sel.sectionId && <div className="flex gap-2"><Button variant="outline" onClick={() => setBulk('')}>Bulk add</Button><Button onClick={() => { setMsg(null); setForm(EMPTY); }}>Add student</Button></div>} />
      {sel.bar(<Field label="Search"><Input value={search} onChange={(e) => setSearch(e.target.value)} /></Field>)}
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {!sel.sectionId ? <Card><Empty>Select a class and section.</Empty></Card> : q.isLoading ? <Spinner /> : (
        <Card className="overflow-x-auto p-4">
          {!q.data?.length ? <Empty>No students yet.</Empty> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-slate-500"><th className="p-2">Roll</th><th className="p-2">Adm. No.</th><th className="p-2">Name</th><th className="p-2">Guardian</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
              <tbody>{q.data.map((s) => (
                <tr key={s._id} className="border-b"><td className="p-2">{s.rollNumber}</td><td className="p-2">{s.admissionNumber}</td><td className="p-2">{s.name}</td><td className="p-2">{s.guardianName}</td><td className="p-2">{s.isActive ? 'Active' : 'Inactive'}</td>
                  <td className="p-2 text-right"><Button size="sm" variant="outline" onClick={() => { setMsg(null); setForm({ id: s._id, rollNumber: s.rollNumber, admissionNumber: s.admissionNumber, name: s.name, gender: s.gender ?? '', guardianName: s.guardianName ?? '', guardianPhone: s.guardianPhone ?? '' }); }}>Edit</Button>{' '}
                    <Button size="sm" variant="outline" onClick={() => toggle.mutate(s)}>{s.isActive ? 'Deactivate' : 'Activate'}</Button></td></tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      )}
      {form && (
        <Modal title={form.id ? 'Edit student' : 'Add student'} onClose={() => setForm(null)}>
          <div className="space-y-3">
            <Field label="Roll number"><Input value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} /></Field>
            <Field label="Admission number"><Input value={form.admissionNumber} disabled={!!form.id} onChange={(e) => setForm({ ...form, admissionNumber: e.target.value })} /></Field>
            <Field label="Student name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Gender"><Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="">—</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></Select></Field>
            <Field label="Guardian name"><Input value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} /></Field>
            <Field label="Guardian phone"><Input value={form.guardianPhone} onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })} /></Field>
            {msg?.tone === 'red' && <Alert>{msg.text}</Alert>}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setForm(null)}>Cancel</Button><Button disabled={save.isPending || !form.rollNumber || !form.name || !form.admissionNumber} onClick={() => save.mutate(form)}>Save</Button></div>
          </div>
        </Modal>
      )}
      {bulk !== null && (
        <Modal title="Bulk add students" onClose={() => setBulk(null)}>
          <p className="mb-2 text-sm text-slate-600">One student per line: <code>roll, admission no, name</code>. Duplicates are skipped.</p>
          <textarea className="h-48 w-full rounded-md border border-slate-300 p-2 text-sm" value={bulk} onChange={(e) => setBulk(e.target.value)} aria-label="Students list" />
          <div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={() => setBulk(null)}>Cancel</Button><Button disabled={!bulk.trim() || importBulk.isPending} onClick={() => importBulk.mutate(bulk)}>Import</Button></div>
        </Modal>
      )}
    </div>
  );
}
