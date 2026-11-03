import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ACTIVITY_TYPES, type ActivityType } from '@ssms/shared';
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

function ActivityEditor({ unit, section, onClose }: { unit: Unit; section: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState(() => Object.fromEntries(unit.activities.map((a) => [a.type, { applicable: a.applicable, percent: a.percent }])));
  const save = useMutation({
    mutationFn: async () => {
      for (const t of ACTIVITY_TYPES.filter((x) => x !== 'TEACHING')) {
        const prev = unit.activities.find((a) => a.type === t);
        const cur = rows[t]!;
        if (prev && prev.applicable === cur.applicable && prev.percent === cur.percent) continue;
        await api.put('/activities', { section, chapter: unit.chapter, activityType: t, applicable: cur.applicable, percent: cur.percent });
      }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['progress'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); onClose(); },
  });
  return (
    <Modal title={`Activities — ${unit.chapterTitle}`} onClose={onClose}>
      <div className="space-y-3">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <p className="text-xs text-slate-500">Teaching progress ({unit.teachingPercent.toFixed(0)}%) is computed from submitted teaching entries. Mark an activity not applicable to exclude it from the weighted total.</p>
        {ACTIVITY_TYPES.filter((t) => t !== 'TEACHING').map((t) => (
          <div key={t} className="grid grid-cols-[1fr_auto_6rem] items-center gap-2 text-sm">
            <span>{ACTIVITY_LABEL[t]}</span>
            <label className="flex items-center gap-1"><input type="checkbox" checked={rows[t]!.applicable} onChange={(e) => setRows((r) => ({ ...r, [t]: { ...r[t]!, applicable: e.target.checked } }))} /> Applicable</label>
            <Input type="number" min={0} max={100} disabled={!rows[t]!.applicable} value={rows[t]!.percent} aria-label={`${ACTIVITY_LABEL[t]} percent`} onChange={(e) => setRows((r) => ({ ...r, [t]: { ...r[t]!, percent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } }))} />
          </div>
        ))}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
      </div>
    </Modal>
  );
}

export function ProgressPage() {
  const can = useAuth((s) => s.can);
  const p = useChapterPicker({ restrictToAssignments: false });
  const [editing, setEditing] = useState<Unit | null>(null);
  const params = { academicSession: p.scope.current?._id, section: p.section || undefined, subject: p.subject || undefined };
  useEffect(() => undefined, []);
  const q = useQuery({
    queryKey: ['progress', params],
    enabled: !!p.scope.current,
    queryFn: async () => (await api.get<{ data: Unit[]; summary: Summary }>('/progress/chapters', { params })).data,
  });
  const canEdit = can('teaching:write');
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
                    {u.activities.map((a) => <td key={a.type} className="px-2 py-2 text-center text-xs">{a.type === 'TEACHING' ? `${u.teachingPercent.toFixed(0)}%` : a.applicable ? `${a.percent}%` : 'N/A'}</td>)}
                    <td className="px-3 py-2"><Badge tone={u.isCompleted ? 'green' : u.completionStatus === 'PENDING_APPROVAL' ? 'amber' : 'gray'}>{u.isCompleted ? 'Completed' : (u.completionStatus ?? 'In progress').replace('_', ' ')}</Badge></td>
                    <td className="px-3 py-2">{canEdit && <Button size="sm" variant="outline" onClick={() => setEditing(u)}>Activities</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
      {editing && <ActivityEditor unit={editing} section={editing.section} onClose={() => setEditing(null)} />}
    </div>
  );
}
