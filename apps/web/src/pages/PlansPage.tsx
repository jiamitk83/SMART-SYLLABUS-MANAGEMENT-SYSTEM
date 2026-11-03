import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ChapterPickerFields, useChapterPicker } from '@/components/ChapterPicker';
import { Alert, Badge, Button, Card, DataTable, Field, Input, Modal, PageHeader, Pagination, ProgressBar, Select, Spinner, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { labelOf, useList, useSessions } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';
import { useAuth } from '@/store/auth';

const LEVELS = ['ANNUAL', 'MONTHLY', 'WEEKLY'] as const;
interface Plan { _id: string; level: string; startDate: string; endDate: string; estimatedPeriods?: number; target?: string; status?: string; isActive?: boolean; chapter?: unknown; section?: unknown; class?: unknown; subject?: unknown; progress?: number }

function CreateModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const p = useChapterPicker({ restrictToAssignments: false });
  const [level, setLevel] = useState<string>('MONTHLY');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [periods, setPeriods] = useState('');
  const [target, setTarget] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const m = useMutation({
    mutationFn: () => api.post('/plans', { chapter: p.chapter, section: p.section || undefined, level, topics, startDate: start, endDate: end, estimatedPeriods: periods ? Number(periods) : undefined, target }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['plans'] }); onClose(); },
  });
  const tps = p.chapterObj?.topics.filter((t) => t.isActive) ?? [];
  return (
    <Modal title="New plan" onClose={onClose}>
      <div className="space-y-3">
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        <div className="grid gap-2"><ChapterPickerFields p={p} /></div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Level"><Select value={level} onChange={(e) => setLevel(e.target.value)}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</Select></Field>
          <Field label="Estimated periods"><Input type="number" min={0} value={periods} onChange={(e) => setPeriods(e.target.value)} /></Field>
          <Field label="Start"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {tps.length > 0 && <div className="max-h-32 overflow-auto rounded border p-2 text-sm"><div className="mb-1 text-xs text-slate-500">Topics covered</div>{tps.map((t) => <label key={t.id} className="flex items-center gap-2"><input type="checkbox" checked={topics.includes(t.id)} onChange={(e) => setTopics((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))} />{t.title}</label>)}</div>}
        <Field label="Target"><Textarea value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!p.chapter || !start || !end || m.isPending} onClick={() => m.mutate()}>Create</Button></div>
      </div>
    </Modal>
  );
}

function RescheduleModal({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const qc = useQueryClient();
  const [start, setStart] = useState(plan.startDate.slice(0, 10));
  const [end, setEnd] = useState(plan.endDate.slice(0, 10));
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api.post(`/plans/${plan._id}/reschedule`, { startDate: start, endDate: end, reason }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['plans'] }); onClose(); } });
  return (
    <Modal title="Reschedule plan" onClose={onClose}>
      <div className="space-y-3">
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        <Field label="Start"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="End"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>Reschedule</Button></div>
      </div>
    </Modal>
  );
}

export function PlansPage() {
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const { current } = useSessions();
  const [page, setPage] = useState(1);
  const [level, setLevel] = useState('');
  const [view, setView] = useState<'table' | 'calendar'>('table');
  const [creating, setCreating] = useState(false);
  const [resched, setResched] = useState<Plan | null>(null);
  const list = useList<Plan>('plans', '/plans', { academicSession: current?._id, level: level || undefined, withProgress: 'true', page, pageSize: view === 'table' ? 15 : 100 }, !!current);
  const cancel = useMutation({ mutationFn: (id: string) => api.delete(`/plans/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }) });
  const manage = can('plans:manage');
  const rows = list.data?.data ?? [];
  const byMonth = rows.reduce<Record<string, Plan[]>>((acc, r) => { (acc[r.startDate.slice(0, 7)] ??= []).push(r); return acc; }, {});
  return (
    <div className="space-y-4">
      <PageHeader title="Syllabus plans" subtitle="Annual, monthly and weekly planning" actions={manage ? <Button onClick={() => setCreating(true)}>New plan</Button> : undefined} />
      <Card className="p-0">
        <div className="flex gap-2 p-3">
          <Select className="w-40" value={level} onChange={(e) => { setLevel(e.target.value); setPage(1); }} aria-label="Level filter"><option value="">All levels</option>{LEVELS.map((l) => <option key={l}>{l}</option>)}</Select>
          <Button variant="outline" onClick={() => setView(view === 'table' ? 'calendar' : 'table')}>{view === 'table' ? 'Calendar view' : 'Table view'}</Button>
        </div>
        {cancel.error && <div className="px-3"><Alert>{errorMessage(cancel.error)}</Alert></div>}
        {list.isLoading ? <Spinner /> : list.error ? <div className="p-3"><Alert>{errorMessage(list.error)}</Alert></div> : view === 'table' ? (
          <>
            <DataTable<Plan>
              rows={rows}
              columns={[
                { header: 'Chapter', cell: (r) => labelOf(r.chapter) },
                { header: 'Class', cell: (r) => `${labelOf(r.class)}${r.section ? `-${labelOf(r.section)}` : ''} · ${labelOf(r.subject)}` },
                { header: 'Level', cell: (r) => <Badge>{r.level}</Badge> },
                { header: 'Dates', cell: (r) => `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}` },
                { header: 'Progress', cell: (r) => <div className="flex w-32 items-center gap-1"><ProgressBar value={r.progress ?? 0} /><span className="text-xs">{Math.round(r.progress ?? 0)}%</span></div> },
                { header: '', cell: (r) => manage && r.status !== 'CANCELLED' && (
                  <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => setResched(r)}>Reschedule</Button><Button size="sm" variant="outline" onClick={() => { if (window.confirm('Cancel this plan?')) cancel.mutate(r._id); }}>Cancel</Button></div>
                ) },
              ]}
            />
            <Pagination page={page} pageSize={15} total={list.data?.meta.total ?? 0} onPage={setPage} />
          </>
        ) : (
          <div className="space-y-4 p-3">
            {Object.keys(byMonth).sort().map((m) => (
              <div key={m}>
                <h3 className="mb-1 text-sm font-semibold">{m}</h3>
                <ul className="space-y-1 text-sm">{byMonth[m]!.map((r) => <li key={r._id} className="flex justify-between rounded border px-2 py-1"><span>{labelOf(r.chapter)} <span className="text-slate-500">({labelOf(r.class)}-{labelOf(r.section, 'all')} {labelOf(r.subject)})</span></span><span className="text-xs text-slate-500">{fmtDate(r.startDate)} – {fmtDate(r.endDate)}</span></li>)}</ul>
              </div>
            ))}
            {!rows.length && <div className="p-6 text-center text-sm text-slate-500">No plans.</div>}
          </div>
        )}
      </Card>
      {creating && <CreateModal onClose={() => setCreating(false)} />}
      {resched && <RescheduleModal plan={resched} onClose={() => setResched(null)} />}
    </div>
  );
}
