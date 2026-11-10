import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ATTENDANCE_REASON_MIN_LENGTH } from '@ssms/shared';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { StateBadge, STATUS_LABEL, todayStr, useScopeSelection, type Status } from './common';

export interface SheetStudent { id: string; rollNumber: string; admissionNumber: string; name: string; status: Status | null }
export interface Sheet {
  section: { id: string; name: string; className: string };
  date: string;
  state: string;
  nonWorking: boolean;
  holiday: boolean;
  inSession: boolean;
  students: SheetStudent[];
  summary: { present: number; absent: number; leave: number; unmarked: number; total: number };
}

export function useSheet(section: string, date: string, kind: 'sheet' | 'daily' = 'sheet') {
  return useQuery({
    queryKey: ['att-sheet', kind, section, date],
    queryFn: async () => (await api.get<{ data: Sheet }>(`/attendance/${kind}`, { params: { section, date } })).data.data,
    enabled: !!section && !!date,
  });
}

const STATUSES: Status[] = ['PRESENT', 'ABSENT', 'LEAVE'];
const TONE: Record<Status, string> = {
  PRESENT: 'bg-green-600 text-white border-green-600',
  ABSENT: 'bg-red-600 text-white border-red-600',
  LEAVE: 'bg-amber-500 text-white border-amber-500',
};

export function MarkAttendancePage() {
  const [params] = useSearchParams();
  const sel = useScopeSelection(params.get('section') ?? '');
  const [date, setDate] = useState(params.get('date') ?? todayStr());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | Status | 'UNMARKED'>('ALL');
  const [local, setLocal] = useState<Record<string, Status>>({});
  const [confirm, setConfirm] = useState<null | { submit: boolean }>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  const qc = useQueryClient();
  const sheetQ = useSheet(sel.sectionId, date);
  const sheet = sheetQ.data;

  useEffect(() => {
    if (sheet) setLocal(Object.fromEntries(sheet.students.filter((s) => s.status).map((s) => [s.id, s.status as Status])));
  }, [sheet]);

  const locked = sheet?.state === 'LOCKED';
  const blocked = !!sheet && (sheet.nonWorking || !sheet.inSession || date > todayStr());
  const readOnly = locked || blocked || !sel.scope?.capabilities.mark && !sel.scope?.capabilities.correct;
  const afterSubmit = !!sheet && ['SUBMITTED', 'UPDATED'].includes(sheet.state);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, leave: 0, unmarked: 0 };
    for (const s of sheet?.students ?? []) {
      const st = local[s.id];
      if (st === 'PRESENT') c.present += 1;
      else if (st === 'ABSENT') c.absent += 1;
      else if (st === 'LEAVE') c.leave += 1;
      else c.unmarked += 1;
    }
    return c;
  }, [sheet, local]);

  const visible = (sheet?.students ?? []).filter((s) => {
    const q = search.trim().toLowerCase();
    if (q && !`${s.name} ${s.rollNumber} ${s.admissionNumber}`.toLowerCase().includes(q)) return false;
    const st = local[s.id];
    if (filter === 'UNMARKED') return !st;
    return filter === 'ALL' || st === filter;
  });

  const markAll = (status: Status | null) => {
    if (!sheet) return;
    setLocal(status ? Object.fromEntries(sheet.students.map((s) => [s.id, status])) : {});
  };
  const dirty = !!sheet && sheet.students.some((s) => (local[s.id] ?? null) !== s.status);

  const save = useMutation({
    mutationFn: async (p: { submit: boolean; reason?: string }) =>
      api.put('/api/attendance/mark', {
        section: sel.sectionId,
        date,
        entries: Object.entries(local).map(([student, status]) => ({ student, status })),
        submit: p.submit,
        ...(p.reason ? { reason: p.reason } : {}),
      }),
    onSuccess: (_d, p) => {
      setMsg({ tone: 'green', text: p.submit ? 'Attendance submitted.' : 'Attendance saved.' });
      setConfirm(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['att-sheet'] });
    },
    onError: (e) => { setMsg({ tone: 'red', text: errorMessage(e) }); setConfirm(null); },
  });

  const request = (submit: boolean) => {
    setMsg(null);
    if (afterSubmit) setConfirm({ submit });
    else save.mutate({ submit });
  };
  const reasonOk = reason.trim().length >= ATTENDANCE_REASON_MIN_LENGTH;

  return (
    <div>
      <PageHeader title="Mark Attendance" subtitle="Session → Class → Section → Date → Students" />
      {sel.bar(
        <Field label="Date">
          <Input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
        </Field>,
      )}
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {!sel.sectionId ? <Card><Empty>Select a class and section to begin.</Empty></Card> : sheetQ.isLoading ? <Spinner /> : sheetQ.error ? <Alert>{errorMessage(sheetQ.error)}</Alert> : sheet && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <strong>{sheet.section.className}-{sheet.section.name}</strong>
            <span className="text-sm text-slate-500">{sheet.date}</span>
            <StateBadge state={sheet.state} />
            {sheet.holiday && <Badge tone="amber">Holiday</Badge>}
            {sheet.nonWorking && !sheet.holiday && <Badge tone="amber">Weekly off</Badge>}
            {!sheet.inSession && <Badge tone="red">Outside session</Badge>}
          </div>
          {locked && <div className="mb-3"><Alert tone="amber">This register is locked. Ask an authorised user to unlock it with a reason.</Alert></div>}
          {blocked && !locked && <div className="mb-3"><Alert tone="amber">Attendance cannot be marked for this date (holiday, weekly off, future or outside the session).</Alert></div>}
          {afterSubmit && !readOnly && <div className="mb-3"><Alert tone="amber">Already submitted. Saving changes is a correction and needs a reason.</Alert></div>}
          <div className="mb-3 grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-5" aria-label="Counts">
            <div className="rounded bg-slate-100 p-2">Total <b>{sheet.summary.total}</b></div>
            <div className="rounded bg-green-100 p-2">Present <b>{counts.present}</b></div>
            <div className="rounded bg-red-100 p-2">Absent <b>{counts.absent}</b></div>
            <div className="rounded bg-amber-100 p-2">Leave <b>{counts.leave}</b></div>
            <div className="rounded bg-slate-100 p-2">Unmarked <b>{counts.unmarked}</b></div>
          </div>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <Input className="max-w-xs" placeholder="Search name, roll or admission no." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search students" />
            <select className="rounded-md border border-slate-300 px-2 py-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter status">
              <option value="ALL">All</option><option value="PRESENT">Present</option><option value="ABSENT">Absent</option><option value="LEAVE">Leave</option><option value="UNMARKED">Unmarked</option>
            </select>
            {!readOnly && (
              <>
                <Button variant="outline" size="sm" onClick={() => markAll('PRESENT')}>Mark all Present</Button>
                <Button variant="outline" size="sm" onClick={() => markAll('ABSENT')}>Mark all Absent</Button>
                <Button variant="outline" size="sm" onClick={() => markAll(null)}>Clear</Button>
              </>
            )}
          </div>
          {!sheet.students.length ? <Empty>No active students in this section. Add students under Students.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-slate-500"><th className="p-2">Roll</th><th className="p-2">Adm. No.</th><th className="p-2">Student</th><th className="p-2">Status</th></tr></thead>
                <tbody>
                  {visible.map((s) => (
                    <tr key={s.id} className="border-b">
                      <td className="p-2">{s.rollNumber}</td>
                      <td className="p-2">{s.admissionNumber}</td>
                      <td className="p-2">{s.name}</td>
                      <td className="p-2">
                        <div className="flex gap-1" role="group" aria-label={`Status for ${s.name}`}>
                          {STATUSES.map((st) => (
                            <button
                              key={st}
                              type="button"
                              disabled={readOnly}
                              aria-pressed={local[s.id] === st}
                              onClick={() => setLocal((p) => ({ ...p, [s.id]: st }))}
                              className={`rounded border px-3 py-1 text-xs font-medium disabled:opacity-60 ${local[s.id] === st ? TONE[st] : 'bg-white text-slate-600'}`}
                            >{STATUS_LABEL[st]}</button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!readOnly && sheet.students.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={!dirty || save.isPending || !Object.keys(local).length} onClick={() => request(false)}>{afterSubmit ? 'Save correction' : 'Save draft'}</Button>
              <Button variant="outline" disabled={save.isPending || counts.unmarked > 0} onClick={() => request(true)} title={counts.unmarked ? 'Mark every student before submitting' : ''}>Submit register</Button>
            </div>
          )}
        </Card>
      )}
      {confirm && (
        <Modal title="Overwrite submitted attendance?" onClose={() => setConfirm(null)}>
          <p className="mb-3 text-sm text-slate-600">Previous values will be kept in the attendance history. A reason is required (min {ATTENDANCE_REASON_MIN_LENGTH} characters).</p>
          <Field label="Correction reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button disabled={!reasonOk || save.isPending} onClick={() => save.mutate({ submit: confirm.submit, reason: reason.trim() })}>Confirm overwrite</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
