import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { TEACHING_STATUSES } from '@ssms/shared';
import { ChapterPickerFields, useChapterPicker } from '@/components/ChapterPicker';
import { Alert, Badge, Button, Card, DataTable, Field, Input, PageHeader, Pagination, Select, Spinner, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { labelOf, useList } from '@/lib/hooks';
import { fmtDate, toInputDate } from '@/lib/utils';

interface Rec {
  _id: string; date: string; periodNumber: number; state: 'DRAFT' | 'SUBMITTED'; teachingStatus: string; description?: string; remarks?: string;
  class?: unknown; section?: unknown; subject?: unknown; chapter?: unknown; topic?: unknown; subtopic?: unknown;
}

const today = () => toInputDate(new Date());

export function TeachingPage() {
  const qc = useQueryClient();
  const p = useChapterPicker({ restrictToAssignments: true });
  const [date, setDate] = useState(today());
  const [period, setPeriod] = useState('1');
  const [topic, setTopic] = useState('');
  const [subtopic, setSubtopic] = useState('');
  const [status, setStatus] = useState<string>('COMPLETED');
  const [description, setDescription] = useState('');
  const [remarks, setRemarks] = useState('');
  const [msg, setMsg] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState('');
  const history = useList<Rec>('teaching', '/teaching-records', { page, pageSize: 10, state });

  const topics = p.chapterObj?.topics.filter((t) => t.isActive) ?? [];
  const subtopics = topics.find((t) => t.id === topic)?.subtopics.filter((s) => s.isActive) ?? [];
  const valid = p.section && p.subject && p.chapter && date && Number(period) >= 1;

  const save = useMutation({
    mutationFn: (submit: boolean) =>
      api.post('/teaching-records', { date, section: p.section, subject: p.subject, chapter: p.chapter, topic: topic || undefined, subtopic: subtopic || undefined, periodNumber: Number(period), description, teachingStatus: status, remarks, submit }),
    onSuccess: (_r, submit) => {
      setMsg(submit ? 'Teaching entry submitted.' : 'Draft saved.');
      setDescription('');
      setRemarks('');
      setPeriod(String(Number(period) + 1));
      void qc.invalidateQueries({ queryKey: ['teaching'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const act = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'submit' | 'delete' }) => (kind === 'submit' ? api.post(`/teaching-records/${id}/submit`) : api.delete(`/teaching-records/${id}`)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['teaching'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Daily teaching" subtitle="Record what was taught in each period" />
      <Card className="space-y-3">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        {msg && !save.error && <Alert tone="green">{msg}</Alert>}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Date"><Input type="date" max={today()} value={date} onChange={(e) => { setDate(e.target.value); setMsg(''); }} /></Field>
          <Field label="Period number"><Input type="number" min={1} max={20} value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{TEACHING_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select></Field>
        </div>
        <div className="grid gap-3 md:grid-cols-3"><ChapterPickerFields p={p} /></div>
        {p.scope.isTeacher && p.sectionOptions.length === 0 && <Alert tone="amber">You have no class/subject assignments in the current session. Ask the coordinator to assign you.</Alert>}
        <div className="grid gap-3 md:grid-cols-2">
          <Select value={topic} onChange={(e) => { setTopic(e.target.value); setSubtopic(''); }} aria-label="Topic" disabled={!p.chapter}><option value="">Topic (optional)…</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select>
          <Select value={subtopic} onChange={(e) => setSubtopic(e.target.value)} aria-label="Subtopic" disabled={!topic}><option value="">Subtopic (optional)…</option>{subtopics.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</Select>
        </div>
        <Field label="What was taught"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></Field>
        <Field label="Remarks"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={1000} /></Field>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!valid || save.isPending} onClick={() => save.mutate(false)}>Save draft</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate(true)}>Submit</Button>
        </div>
      </Card>
      <Card className="p-0">
        <div className="flex items-center justify-between p-3">
          <h2 className="font-medium">My entries</h2>
          <Select className="w-40" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} aria-label="Filter state"><option value="">All</option><option value="DRAFT">Drafts</option><option value="SUBMITTED">Submitted</option></Select>
        </div>
        {act.error && <div className="px-3"><Alert>{errorMessage(act.error)}</Alert></div>}
        {history.isLoading ? <Spinner /> : history.error ? <div className="p-3"><Alert>{errorMessage(history.error)}</Alert></div> : (
          <>
            <DataTable<Rec>
              rows={history.data?.data ?? []}
              columns={[
                { header: 'Date', cell: (r) => `${fmtDate(r.date)} · P${r.periodNumber}` },
                { header: 'Class', cell: (r) => `${labelOf(r.class)}-${labelOf(r.section)} ${labelOf(r.subject)}` },
                { header: 'Chapter / topic', cell: (r) => <div>{labelOf(r.chapter)}<div className="text-xs text-slate-500">{labelOf(r.topic, '')}</div></div> },
                { header: 'Status', cell: (r) => <Badge tone={r.teachingStatus === 'COMPLETED' ? 'green' : r.teachingStatus === 'PARTIAL' ? 'amber' : 'red'}>{r.teachingStatus.replace('_', ' ')}</Badge> },
                { header: 'State', cell: (r) => <Badge tone={r.state === 'SUBMITTED' ? 'blue' : 'gray'}>{r.state}</Badge> },
                { header: '', cell: (r) => r.state === 'DRAFT' && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r._id, kind: 'submit' })}>Submit</Button>
                    <Button size="sm" variant="outline" onClick={() => { if (window.confirm('Delete this draft?')) act.mutate({ id: r._id, kind: 'delete' }); }}>Delete</Button>
                  </div>
                ) },
              ]}
            />
            <Pagination page={page} pageSize={10} total={history.data?.meta.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
