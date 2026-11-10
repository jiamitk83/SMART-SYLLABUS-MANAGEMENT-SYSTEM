import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ACTIVITY_STATUSES, ACTIVITY_STATUS_LABEL, ACTIVITY_TYPES, CORRECTION_REASON_MIN_LENGTH, activityStatusOf, type ActivityType, type DisplayActivityStatus } from '@ssms/shared';
import { ChapterPickerFields, useChapterPicker } from '@/components/ChapterPicker';
import { Alert, Badge, Button, Card, Empty, Modal, PageHeader, ProgressBar, Spinner, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/utils';
import { useAuth } from '@/store/auth';

export const ACTIVITY_LABEL: Record<string, string> = {
  TEACHING: 'Teaching', NOTEBOOK_WORK: 'Notebook work', NOTEBOOK_CORRECTION: 'Notebook correction', WORKSHEET: 'Worksheet', TEST: 'Test', REVISION: 'Revision',
};

interface Unit {
  chapter: string; chapterTitle: string; chapterOrder: number; progress: number; teachingPercent: number; isCompleted: boolean; completionStatus: string | null;
  plannedStart: string | null; plannedEnd: string | null; section: string; subject: string;
  activities: Array<{ type: ActivityType; applicable: boolean; percent: number; normalizedWeight: number }>;
}
interface Summary { planned: number; actual: number; chapters: number; completedChapters: number; delayedChapters: number }

function StatusBadge({ a }: { a: { applicable: boolean; percent: number } }) {
  const s = activityStatusOf(a);
  const tone = s === 'COMPLETED' ? 'green' : s === 'PENDING' ? 'amber' : s === 'PARTIAL' ? 'blue' : 'gray';
  return <Badge tone={tone}>{s === 'PARTIAL' ? `Partial ${a.percent}%` : ACTIVITY_STATUS_LABEL[s]}</Badge>;
}

function ActivityEditor({ unit, section, onClose }: { unit: Unit; section: string; onClose: () => void }) {
  const qc = useQueryClient();
  const current = (t: ActivityType) => unit.activities.find((a) => a.type === t);
  const [rows, setRows] = useState<Record<string, DisplayActivityStatus>>(() => Object.fromEntries(unit.activities.map((a) => [a.type, activityStatusOf(a)])));
  const [reason, setReason] = useState('');
  const reasonOk = reason.trim().length >= CORRECTION_REASON_MIN_LENGTH;
  const changed = ACTIVITY_TYPES.filter((t) => t !== 'TEACHING' && rows[t] !== activityStatusOf(current(t)));
  const save = useMutation({
    mutationFn: async () => {
      for (const t of changed) await api.put('/api/activities', { section, chapter: unit.chapter, activityType: t, status: rows[t], reason: reason.trim() });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['progress'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); void qc.invalidateQueries({ queryKey: ['activity-history'] }); onClose(); },
  });
  return (
    <Modal title={`Correct activities — ${unit.chapterTitle}`} onClose={onClose}>
      <div className="space-y-3">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <p className="text-xs text-slate-500">Teaching ({unit.teachingPercent.toFixed(0)}%) is calculated automatically from submitted teaching entries. Choose a status for each activity: Completed counts as 100%, Pending as 0%, and N/A is left out of the total. Every change is saved with its previous status, your name and the reason below; history is never deleted.</p>
        {ACTIVITY_TYPES.filter((t) => t !== 'TEACHING').map((t) => {
          const cur = current(t);
          const legacyPartial = activityStatusOf(cur) === 'PARTIAL';
          const options: DisplayActivityStatus[] = legacyPartial ? ['PARTIAL', ...ACTIVITY_STATUSES] : [...ACTIVITY_STATUSES];
          return (
            <div key={t} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{ACTIVITY_LABEL[t]}</span>
              <div role="radiogroup" aria-label={`${ACTIVITY_LABEL[t]} status`} className="flex gap-1">
                {options.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={rows[t] === s}
                    onClick={() => setRows((r) => ({ ...r, [t]: s }))}
                    className={`rounded border px-3 py-1 text-xs ${rows[t] === s ? (s === 'COMPLETED' ? 'border-green-600 bg-green-600 text-white' : s === 'PENDING' ? 'border-amber-500 bg-amber-500 text-white' : s === 'PARTIAL' ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-600 bg-slate-600 text-white') : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    {s === 'PARTIAL' ? `Partial ${cur?.percent}% (existing)` : ACTIVITY_STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <label className="block text-sm">Reason for correction (required)<Input value={reason} maxLength={500} aria-label="Correction reason" placeholder="e.g. Worksheet marked completed by mistake" onChange={(e) => setReason(e.target.value)} /></label>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending || !reasonOk || changed.length === 0} onClick={() => save.mutate()}>Save correction</Button></div>
      </div>
    </Modal>
  );
}

interface HistoryRow {
  at: string; kind?: string; activityType: string; applicable: boolean; percent: number; previousApplicable?: boolean; previousPercent?: number; reason?: string; by?: { fullName?: string } | null;
}

const statusText = (applicable: boolean | undefined, percent: number | undefined) => {
  if (applicable === undefined || percent === undefined) return '—';
  const s = activityStatusOf({ applicable, percent });
  return s === 'PARTIAL' ? `Partial ${percent}%` : ACTIVITY_STATUS_LABEL[s];
};
const fmtVal = statusText;

function HistoryModal({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['activity-history', unit.section, unit.chapter],
    queryFn: async () => (await api.get<{ data: HistoryRow[] }>('/api/activities/history', { params: { section: unit.section, chapter: unit.chapter } })).data.data,
  });
  return (
    <Modal title={`Correction history — ${unit.chapterTitle}`} onClose={onClose}>
      {q.isLoading ? <Spinner /> : q.error ? <Alert>{errorMessage(q.error)}</Alert> : !q.data?.length ? <Empty>No activity corrections recorded.</Empty> : (
        <ul className="max-h-96 space-y-2 overflow-auto text-sm">
          {q.data.map((h, i) => (
            <li key={i} className="rounded border p-2">
              <div className="font-medium">{ACTIVITY_LABEL[h.activityType] ?? h.activityType}: {fmtVal(h.previousApplicable, h.previousPercent)} → {fmtVal(h.applicable, h.percent)}</div>
              <div className="text-xs text-slate-500">{fmtDate(h.at)} · {h.by?.fullName ?? 'Unknown user'}{h.kind === 'ASSESSMENT_SYNC' ? ' · automatic (assessment)' : ''}</div>
              {h.reason && <div className="text-xs">Reason: {h.reason}</div>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function ProgressPage() {
  const can = useAuth((s) => s.can);
  const p = useChapterPicker({ restrictToAssignments: false });
  const [editing, setEditing] = useState<Unit | null>(null);
  const [history, setHistory] = useState<Unit | null>(null);
  const params = { academicSession: p.scope.current?._id, section: p.section || undefined, subject: p.subject || undefined };
  useEffect(() => undefined, []);
  const q = useQuery({
    queryKey: ['progress', params],
    enabled: !!p.scope.current,
    queryFn: async () => (await api.get<{ data: Unit[]; summary: Summary }>('/api/progress/chapters', { params })).data,
  });
  const canEdit = can('activities:manage');
  return (
    <div className="space-y-4">
      <PageHeader title="Syllabus progress" subtitle="Weighted chapter progress: teaching, notebooks, worksheets, tests and revision" />
      <Card className="grid gap-3 md:grid-cols-3"><ChapterPickerFields p={p} withChapter={false} /></Card>
      {q.isLoading ? <Spinner /> : q.error ? <Alert>{errorMessage(q.error)}</Alert> : !q.data?.data.length ? <Empty>No chapters match. Check teacher assignments and syllabus.</Empty> : (
        <>
          <Card>
            <div className="mb-1 flex justify-between text-sm"><span>Actual vs planned ({q.data.summary.completedChapters}/{q.data.summary.chapters} chapters approved complete, {q.data.summary.delayedChapters} delayed)</span><span>{q.data.summary.actual.toFixed(1)}% / {q.data.summary.planned.toFixed(1)}%</span></div>
            <ProgressBar value={q.data.summary.actual} planned={q.data.summary.planned} />
          </Card>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Chapter</th><th className="px-3 py-2">Planned</th><th className="w-48 px-3 py-2">Progress</th>{ACTIVITY_TYPES.map((t) => <th key={t} className="px-2 py-2">{ACTIVITY_LABEL[t]}</th>)}<th className="px-3 py-2">Status</th><th /></tr></thead>
              <tbody className="divide-y">
                {q.data.data.map((u) => (
                  <tr key={`${u.section}-${u.chapter}`}>
                    <td className="px-3 py-2">{u.chapterOrder}. {u.chapterTitle}</td>
                    <td className="px-3 py-2 text-xs">{u.plannedStart ? `${fmtDate(u.plannedStart)} – ${fmtDate(u.plannedEnd)}` : '—'}</td>
                    <td className="px-3 py-2"><div className="flex items-center gap-2"><ProgressBar value={u.progress} /><span className="w-12 text-right">{u.progress.toFixed(0)}%</span></div></td>
                    {u.activities.map((a) => <td key={a.type} className="px-2 py-2 text-center text-xs">{a.type === 'TEACHING' ? `${u.teachingPercent.toFixed(0)}%` : <StatusBadge a={a} />}</td>)}
                    <td className="px-3 py-2"><Badge tone={u.isCompleted ? 'green' : u.completionStatus === 'PENDING_APPROVAL' ? 'amber' : 'gray'}>{u.isCompleted ? 'Completed' : (u.completionStatus ?? 'In progress').replace('_', ' ')}</Badge></td>
                    <td className="px-3 py-2"><div className="flex gap-1">{canEdit && <Button size="sm" variant="outline" onClick={() => setEditing(u)}>Correct</Button>}<Button size="sm" variant="outline" onClick={() => setHistory(u)}>History</Button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
      {history && <HistoryModal unit={history} onClose={() => setHistory(null)} />}
      {editing && <ActivityEditor unit={editing} section={editing.section} onClose={() => setEditing(null)} />}
    </div>
  );
}
