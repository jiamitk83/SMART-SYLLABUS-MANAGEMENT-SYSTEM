import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CHAPTER_IMPORTANCE } from '@ssms/shared';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import { idOf, labelOf, useClassesSections, useSessions, useSubjects } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';
import { useAuth } from '@/store/auth';

interface Sub { id: string; title: string; isActive: boolean }
interface Topic { id: string; title: string; estimatedPeriods?: number; isActive: boolean; subtopics: Sub[] }
interface Chapter { id: string; title: string; order: number; estimatedPeriods?: number; importance?: string; weight?: number; isActive: boolean; topics: Topic[] }
type Target = { kind: 'chapters' | 'topics' | 'subtopics'; parent?: string; item?: { id: string; title: string; estimatedPeriods?: number; importance?: string } };

function ItemModal({ target, base, onClose }: { target: Target; base: { class: string; subject: string; academicSession: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const it = target.item;
  const [title, setTitle] = useState(it?.title ?? '');
  const [periods, setPeriods] = useState(it?.estimatedPeriods?.toString() ?? '');
  const [importance, setImportance] = useState(it?.importance ?? 'MEDIUM');
  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { title: title.trim() };
      if (target.kind !== 'subtopics' && periods !== '') body.estimatedPeriods = Number(periods);
      if (target.kind === 'chapters') body.importance = importance;
      if (it) return api.patch(`/${target.kind}/${it.id}`, body);
      if (target.kind === 'chapters') Object.assign(body, base);
      if (target.kind === 'topics') body.chapter = target.parent;
      if (target.kind === 'subtopics') body.topic = target.parent;
      return api.post(`/${target.kind}`, body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tree'] }); onClose(); },
  });
  const label = target.kind === 'chapters' ? 'chapter' : target.kind === 'topics' ? 'topic' : 'subtopic';
  return (
    <Modal title={`${it ? 'Edit' : 'Add'} ${label}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (title.trim()) m.mutate(); }}>
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>
        {target.kind !== 'subtopics' && <Field label="Estimated periods"><Input type="number" min={0} value={periods} onChange={(e) => setPeriods(e.target.value)} /></Field>}
        {target.kind === 'chapters' && <Field label="Importance"><Select value={importance} onChange={(e) => setImportance(e.target.value)}>{CHAPTER_IMPORTANCE.map((i) => <option key={i}>{i}</option>)}</Select></Field>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!title.trim() || m.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}

function ImportModal({ base, onClose }: { base: { class: string; subject: string; academicSession: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const run = async () => {
    setErr('');
    try {
      const parsed = JSON.parse(text) as { chapters?: unknown } | unknown[];
      const chapters = Array.isArray(parsed) ? parsed : parsed.chapters;
      const r = await api.post<{ chaptersCreated: number; topicsCreated: number; subtopicsCreated: number }>('/syllabus/import', { ...base, chapters });
      setDone(`Created ${r.data.chaptersCreated} chapters, ${r.data.topicsCreated} topics, ${r.data.subtopicsCreated} subtopics.`);
      void qc.invalidateQueries({ queryKey: ['tree'] });
    } catch (e) {
      setErr(e instanceof SyntaxError ? 'Invalid JSON' : errorMessage(e));
    }
  };
  return (
    <Modal title="Import syllabus (JSON)" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Paste JSON like {'{"chapters":[{"title":"Ch 1","topics":[{"title":"T1","subtopics":[{"title":"S1"}]}]}]}'}. Existing chapters with the same title are skipped.</p>
        {err && <Alert>{err}</Alert>}
        {done && <Alert tone="green">{done}</Alert>}
        <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} aria-label="Syllabus JSON" />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={!text.trim()} onClick={run}>Import</Button></div>
      </div>
    </Modal>
  );
}

export function SyllabusPage() {
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const write = can('syllabus:manage');
  const { sessions, current } = useSessions();
  const subjects = useSubjects();
  const [sessionId, setSessionId] = useState('');
  const [cls, setCls] = useState('');
  const [subject, setSubject] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [importing, setImporting] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  useEffect(() => { if (!sessionId && current) setSessionId(current._id); }, [current, sessionId]);
  const { classes } = useClassesSections(sessionId);
  const base = { class: cls, subject, academicSession: sessionId };
  const ready = !!(cls && subject && sessionId);

  const tree = useQuery({ queryKey: ['tree', base], enabled: ready, queryFn: async () => (await api.get<{ data: Chapter[] }>('/syllabus/tree', { params: base })).data.data });
  const versions = useQuery({ queryKey: ['tree', 'versions', base], enabled: ready && showVersions, queryFn: async () => (await api.get<{ data: Array<{ _id: string; version: number; note?: string; createdAt: string; changedBy?: unknown }> }>('/syllabus/versions', { params: base })).data.data });
  const toggle = useMutation({
    mutationFn: ({ kind, id, on }: { kind: string; id: string; on: boolean }) => api.patch(`/${kind}/${id}/active`, { isActive: on }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tree'] }),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.post('/chapters/reorder', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tree'] }),
  });
  const copy = useMutation({
    mutationFn: () => api.post('/syllabus/copy', { fromSession: copyFrom, toSession: sessionId, class: undefined, subject: undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tree'] }),
  });
  const exportJson = async () => {
    const r = await api.get('/syllabus/export', { params: base, responseType: 'blob' });
    downloadBlob(r.data as Blob, 'syllabus.json');
  };
  const move = (i: number, d: number) => {
    const ids = (tree.data ?? []).map((c) => c.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };
  const err = toggle.error ?? reorder.error ?? copy.error;

  return (
    <div className="space-y-4">
      <PageHeader title="Syllabus" subtitle="Chapters, topics and subtopics per class and subject" actions={
        ready && write ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImporting(true)}>Import</Button>
            <Button onClick={() => setTarget({ kind: 'chapters' })}>Add chapter</Button>
          </div>
        ) : undefined
      } />
      <Card className="flex flex-wrap gap-3">
        <Select className="w-44" value={sessionId} onChange={(e) => { setSessionId(e.target.value); setCls(''); }} aria-label="Session">{sessions.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
        <Select className="w-40" value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Class"><option value="">Class…</option>{classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select>
        <Select className="w-48" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject"><option value="">Subject…</option>{subjects.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
        {ready && <Button variant="outline" onClick={exportJson}>Export JSON</Button>}
        {ready && <Button variant="outline" onClick={() => setShowVersions((v) => !v)}>{showVersions ? 'Hide' : 'Show'} versions</Button>}
      </Card>
      {write && sessions.length > 1 && sessionId && (
        <Card className="flex flex-wrap items-center gap-2 text-sm">
          <span>Copy whole syllabus into this session from:</span>
          <Select className="w-44" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} aria-label="Copy from session"><option value="">Choose session…</option>{sessions.filter((s) => s._id !== sessionId).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
          <Button size="sm" variant="outline" disabled={!copyFrom || copy.isPending} onClick={() => copy.mutate()}>Copy</Button>
          {copy.isSuccess && <Badge tone="green">Copied</Badge>}
        </Card>
      )}
      {err && <Alert>{errorMessage(err)}</Alert>}
      {showVersions && ready && (
        <Card>
          <h2 className="mb-2 font-medium">Version history</h2>
          {versions.isLoading ? <Spinner /> : !versions.data?.length ? <Empty /> : (
            <ul className="divide-y text-sm">{versions.data.map((v) => <li key={v._id} className="py-1.5">v{v.version} · {v.note ?? 'Change'} · {labelOf(v.changedBy)} · {fmtDate(v.createdAt)}</li>)}</ul>
          )}
        </Card>
      )}
      {!ready ? <Empty>Select a class and subject to view its syllabus.</Empty> : tree.isLoading ? <Spinner /> : tree.error ? <Alert>{errorMessage(tree.error)}</Alert> : !tree.data?.length ? <Empty>No chapters yet.</Empty> : (
        <div className="space-y-3">
          {tree.data.map((c, i) => (
            <Card key={c.id} className={c.isActive ? '' : 'opacity-60'}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{c.order}. {c.title} {c.importance && <Badge tone={c.importance === 'HIGH' ? 'red' : c.importance === 'LOW' ? 'gray' : 'amber'}>{c.importance}</Badge>} {c.estimatedPeriods != null && <span className="text-xs text-slate-500">{c.estimatedPeriods} periods</span>}</div>
                {write && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</Button>
                    <Button size="sm" variant="outline" onClick={() => move(i, 1)} disabled={i === tree.data.length - 1} aria-label="Move down">↓</Button>
                    <Button size="sm" variant="outline" onClick={() => setTarget({ kind: 'chapters', item: c })}>Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => setTarget({ kind: 'topics', parent: c.id })}>Add topic</Button>
                    <Button size="sm" variant="outline" onClick={() => toggle.mutate({ kind: 'chapters', id: c.id, on: !c.isActive })}>{c.isActive ? 'Deactivate' : 'Activate'}</Button>
                  </div>
                )}
              </div>
              <ul className="mt-2 space-y-1 border-l pl-4 text-sm">
                {c.topics.map((t) => (
                  <li key={t.id} className={t.isActive ? '' : 'opacity-60'}>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span>{t.title}</span>
                      {write && (
                        <span className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setTarget({ kind: 'topics', parent: c.id, item: t })}>Edit</Button>
                          <Button size="sm" variant="ghost" onClick={() => setTarget({ kind: 'subtopics', parent: t.id })}>Add subtopic</Button>
                          <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ kind: 'topics', id: t.id, on: !t.isActive })}>{t.isActive ? 'Deactivate' : 'Activate'}</Button>
                        </span>
                      )}
                    </div>
                    <ul className="ml-4 list-disc text-slate-600">
                      {t.subtopics.map((s) => (
                        <li key={s.id} className={s.isActive ? '' : 'opacity-60'}>
                          {s.title}
                          {write && (
                            <span className="ml-2 inline-flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setTarget({ kind: 'subtopics', parent: t.id, item: s })}>Edit</Button>
                              <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ kind: 'subtopics', id: s.id, on: !s.isActive })}>{s.isActive ? 'Deactivate' : 'Activate'}</Button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {target && <ItemModal target={target} base={base} onClose={() => setTarget(null)} />}
      {importing && <ImportModal base={base} onClose={() => setImporting(false)} />}
    </div>
  );
}

export { idOf };
