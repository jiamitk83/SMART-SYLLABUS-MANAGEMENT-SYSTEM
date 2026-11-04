import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Field, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import { useSessions } from '@/lib/hooks';

export interface Scope {
  academicSession: string;
  schoolWide: boolean;
  classes: Array<{ id: string; name: string }>;
  sections: Array<{ id: string; name: string; classId: string }>;
  capabilities: { mark?: boolean; correct?: boolean; lock?: boolean; manage?: boolean };
}

export type Status = 'PRESENT' | 'ABSENT' | 'LEAVE';
export const STATUS_LABEL: Record<Status, string> = { PRESENT: 'Present', ABSENT: 'Absent', LEAVE: 'Leave' };

export const pad = (n: number) => String(n).padStart(2, '0');
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const pctText = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${v}%`);

const STATE_TONE: Record<string, 'gray' | 'amber' | 'green' | 'blue' | 'red'> = {
  NOT_STARTED: 'gray',
  DRAFT: 'amber',
  SUBMITTED: 'green',
  UPDATED: 'blue',
  LOCKED: 'red',
};
export const StateBadge = ({ state }: { state: string }) => <Badge tone={STATE_TONE[state] ?? 'gray'}>{state.replace('_', ' ')}</Badge>;

/** Session → Class → Section selection limited to what the backend says the user may access. */
export function useScopeSelection(initialSection = '') {
  const { sessions, current } = useSessions();
  const [session, setSession] = useState('');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState(initialSection);
  const sessionId = session || current?._id || '';
  const scopeQ = useQuery({
    queryKey: ['att-scope', sessionId],
    queryFn: async () => (await api.get<{ data: Scope }>('/attendance/scope', { params: { academicSession: sessionId } })).data.data,
    enabled: !!sessionId,
  });
  const scope = scopeQ.data;
  const sections = (scope?.sections ?? []).filter((s) => !classId || s.classId === classId);

  useEffect(() => {
    if (initialSection && scope && !classId) {
      const s = scope.sections.find((x) => x.id === initialSection);
      if (s) setClassId(s.classId);
    }
  }, [initialSection, scope, classId]);

  const sectionLabel = (id: string) => {
    const s = scope?.sections.find((x) => x.id === id);
    const c = scope?.classes.find((x) => x.id === s?.classId);
    return s ? `${c?.name ?? ''}-${s.name}` : '';
  };

  const bar = (extra?: ReactNode, withSection = true) => (
    <Card className="no-print mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
      <Field label="Session">
        <Select value={sessionId} onChange={(e) => { setSession(e.target.value); setClassId(''); setSectionId(''); }}>
          {sessions.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
        </Select>
      </Field>
      <Field label="Class">
        <Select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }}>
          <option value="">{withSection ? 'Select class' : 'All classes'}</option>
          {(scope?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      {withSection && (
        <Field label="Section">
          <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">Select section</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      )}
      {extra}
    </Card>
  );

  return { sessionId, classId, sectionId, setSectionId, setClassId, scope, scopeLoading: scopeQ.isLoading, bar, sectionLabel };
}

export async function downloadReport(type: string, format: 'xlsx' | 'csv' | 'pdf', params: Record<string, unknown>, filename: string) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
  const res = await api.get(`/attendance/reports/${type}`, { params: { ...clean, format }, responseType: 'blob' });
  downloadBlob(res.data as Blob, `${filename}.${format}`);
}
