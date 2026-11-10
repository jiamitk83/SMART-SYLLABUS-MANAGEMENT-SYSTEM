import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ChapterPickerFields, useChapterPicker } from '@/components/ChapterPicker';
import { Alert, Badge, Button, Card, DataTable, Field, Input, Modal, PageHeader, Pagination, Select, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { labelOf, useList } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';
import { useAuth } from '@/store/auth';

interface Assessment { _id: string; type: 'WORKSHEET' | 'TEST'; title: string; date: string; maxMarks: number; passMarks: number; status: string; class?: unknown; section?: unknown; subject?: unknown; chapters?: unknown[] }
interface Result { rollNo: string; studentName: string; marksObtained?: number | null; outcome?: string }
interface Detail extends Assessment { results: Result[]; summary: { students: number; graded: number; average: number; highest: number; lowest: number; passPercent: number } }

function CreateModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const p = useChapterPicker();
  const [type, setType] = useState('TEST');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [maxMarks, setMax] = useState('20');
  const [passMarks, setPass] = useState('8');
  const m = useMutation({
    mutationFn: () => api.post('/api/assessments', { type, title, section: p.section, subject: p.subject, chapters: [p.chapter], date, maxMarks: Number(maxMarks), passMarks: Number(passMarks), status: 'PLANNED' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['assessments'] }); onClose(); },
  });
  return (
    <Modal title="New assessment" onClose={onClose}>
      <div className="space-y-3">
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        <div className="grid gap-2"><ChapterPickerFields p={p} /></div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="TEST">Test</option><option value="WORKSHEET">Worksheet</option></Select></Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="col-span-2"><Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field></div>
          <Field label="Max marks"><Input type="number" min={0} value={maxMarks} onChange={(e) => setMax(e.target.value)} /></Field>
          <Field label="Pass marks"><Input type="number" min={0} value={passMarks} onChange={(e) => setPass(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!p.chapter || title.trim().length < 2 || m.isPending} onClick={() => m.mutate()}>Create</Button></div>
      </div>
    </Modal>
  );
}

function ResultsModal({ id, canEdit, onClose }: { id: string; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ['assessments', 'detail', id], queryFn: async () => (await api.get<{ data: Detail }>(`/assessments/${id}`)).data.data });
  const [rows, setRows] = useState<Result[] | null>(null);
  const cur = rows ?? d.data?.results ?? [];
  const save = useMutation({
    mutationFn: () => api.put(`/api/assessments/${id}/results`, { results: cur.filter((r) => r.rollNo.trim() && r.studentName.trim()).map((r) => ({ rollNo: r.rollNo.trim(), studentName: r.studentName.trim(), marksObtained: r.marksObtained ?? undefined, outcome: r.outcome || undefined })) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['assessments'] }); void qc.invalidateQueries({ queryKey: ['progress'] }); onClose(); },
  });
  const upd = (i: number, patch: Partial<Result>) => setRows(cur.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <Modal title={d.data ? `Results — ${d.data.title}` : 'Results'} onClose={onClose}>
      {d.isLoading ? <Spinner /> : (
        <div className="space-y-3">
          {save.error && <Alert>{errorMessage(save.error)}</Alert>}
          {d.data && d.data.summary.graded > 0 && <p className="text-xs text-slate-600">{d.data.summary.graded} graded · avg {d.data.summary.average} · high {d.data.summary.highest} · low {d.data.summary.lowest} · pass {d.data.summary.passPercent}% (max {d.data.maxMarks})</p>}
          <div className="max-h-80 space-y-1 overflow-auto">
            {cur.map((r, i) => (
              <div key={i} className="grid grid-cols-[4rem_1fr_5rem_2rem] gap-1">
                <Input placeholder="Roll" aria-label="Roll no" disabled={!canEdit} value={r.rollNo} onChange={(e) => upd(i, { rollNo: e.target.value })} />
                <Input placeholder="Student name" aria-label="Student name" disabled={!canEdit} value={r.studentName} onChange={(e) => upd(i, { studentName: e.target.value })} />
                <Input type="number" min={0} placeholder="Marks" aria-label="Marks" disabled={!canEdit} value={r.marksObtained ?? ''} onChange={(e) => upd(i, { marksObtained: e.target.value === '' ? undefined : Number(e.target.value) })} />
                {canEdit && <button type="button" aria-label="Remove row" className="text-red-600" onClick={() => setRows(cur.filter((_, k) => k !== i))}>×</button>}
              </div>
            ))}
          </div>
          {canEdit && (
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setRows([...cur, { rollNo: String(cur.length + 1), studentName: '' }])}>Add student</Button>
              <Button disabled={!cur.length || save.isPending} onClick={() => save.mutate()}>Save results</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function AssessmentsPage() {
  const can = useAuth((s) => s.can);
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const list = useList<Assessment>('assessments', '/assessments', { page, pageSize: 15, type: type || undefined });
  const manage = can('assessments:manage');
  return (
    <div className="space-y-4">
      <PageHeader title="Assessments" subtitle="Worksheets and tests feed the chapter progress" actions={manage ? <Button onClick={() => setCreating(true)}>New assessment</Button> : undefined} />
      <Card className="p-0">
        <div className="p-3"><Select className="w-44" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Type filter"><option value="">All types</option><option value="TEST">Tests</option><option value="WORKSHEET">Worksheets</option></Select></div>
        {list.isLoading ? <Spinner /> : list.error ? <div className="p-3"><Alert>{errorMessage(list.error)}</Alert></div> : (
          <>
            <DataTable<Assessment>
              rows={list.data?.data ?? []}
              columns={[
                { header: 'Title', cell: (a) => a.title },
                { header: 'Type', cell: (a) => <Badge>{a.type}</Badge> },
                { header: 'Class', cell: (a) => `${labelOf(a.class)}-${labelOf(a.section)} · ${labelOf(a.subject)}` },
                { header: 'Date', cell: (a) => fmtDate(a.date) },
                { header: 'Marks', cell: (a) => `${a.passMarks}/${a.maxMarks}` },
                { header: 'Status', cell: (a) => <Badge tone={a.status === 'CONDUCTED' ? 'green' : 'amber'}>{a.status}</Badge> },
                { header: '', cell: (a) => <Button size="sm" variant="outline" onClick={() => setOpen(a._id)}>{manage ? 'Results' : 'View'}</Button> },
              ]}
            />
            <Pagination page={page} pageSize={15} total={list.data?.meta.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
      {creating && <CreateModal onClose={() => setCreating(false)} />}
      {open && <ResultsModal id={open} canEdit={manage} onClose={() => setOpen(null)} />}
    </div>
  );
}
