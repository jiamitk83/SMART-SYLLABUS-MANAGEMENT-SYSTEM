import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { ActiveBadge, CrudTable } from '@/components/CrudTable';
import { Alert, Badge, Button, PageHeader, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { idOf, labelOf, sectionLabel, useClassesSections, useSessions, useSubjects, useTeachers, type Assign, type Cls, type Sec, type Session, type Subj } from '@/lib/hooks';
import { fmtDate, toInputDate } from '@/lib/utils';
import { useAuth } from '@/store/auth';

const TABS = ['Sessions', 'Classes', 'Sections', 'Subjects', 'Teacher assignments'] as const;

const sessionSchema = z.object({ name: z.string().trim().min(3, 'Min 3 characters'), startDate: z.string().min(1, 'Required'), endDate: z.string().min(1, 'Required') }).refine((v) => v.endDate > v.startDate, { message: 'End date must be after start date', path: ['endDate'] });
const classSchema = z.object({ name: z.string().trim().min(1, 'Required'), order: z.number().int().min(0).optional() });
const sectionSchema = z.object({ class: z.string().min(1, 'Select a class'), name: z.string().trim().min(1, 'Required') });
const subjectSchema = z.object({ name: z.string().trim().min(2, 'Min 2 characters'), code: z.string().trim().min(2, 'Min 2 characters').max(12) });
const assignSchema = z.object({ section: z.string().min(1, 'Select a section'), subject: z.string().min(1, 'Select a subject'), teacher: z.string().min(1, 'Select a teacher') });

export function AcademicPage() {
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const write = can('academic:manage');
  const [tab, setTab] = useState<(typeof TABS)[number]>('Sessions');
  const { sessions, current } = useSessions();
  const [sessionId, setSessionId] = useState('');
  useEffect(() => { if (!sessionId && current) setSessionId(current._id); }, [current, sessionId]);
  const { classes, sections } = useClassesSections(sessionId);
  const subjects = useSubjects();
  const teachers = useTeachers();
  const setCurrent = useMutation({ mutationFn: (id: string) => api.post(`/api/academic-sessions/${id}/set-current`), onSuccess: () => qc.invalidateQueries() });
  const withSession = { academicSession: sessionId };
  const nameOf = (list: Array<{ _id: string; name?: string }>, id: unknown) => list.find((x) => x._id === idOf(id))?.name ?? labelOf(id);

  return (
    <div className="space-y-4">
      <PageHeader title="Academic setup" subtitle="Sessions, classes, sections, subjects and teacher assignments" actions={
        tab !== 'Sessions' && tab !== 'Subjects' ? (
          <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)} aria-label="Academic session">{sessions.map((s) => <option key={s._id} value={s._id}>{s.name}{s.isCurrent ? ' (current)' : ''}</option>)}</Select>
        ) : undefined
      } />
      <div className="flex flex-wrap gap-1 border-b" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-t-md px-3 py-2 text-sm ${tab === t ? 'border-b-2 border-brand-600 font-medium text-brand-700' : 'text-slate-600'}`}>{t}</button>)}
      </div>
      {setCurrent.error && <Alert>{errorMessage(setCurrent.error)}</Alert>}

      {tab === 'Sessions' && (
        <CrudTable<Session>
          title="Academic session" path="/api/academic-sessions" canWrite={write} activeToggle={false} schema={sessionSchema}
          fields={[{ name: 'name', label: 'Name (e.g. 2025-26)' }, { name: 'startDate', label: 'Start date', type: 'date' }, { name: 'endDate', label: 'End date', type: 'date' }]}
          toForm={(s) => ({ name: s.name, startDate: toInputDate(s.startDate), endDate: toInputDate(s.endDate) })}
          columns={[
            { header: 'Name', cell: (s) => s.name },
            { header: 'Dates', cell: (s) => `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}` },
            { header: 'Current', cell: (s) => (s.isCurrent ? <Badge tone="green">Current</Badge> : '') },
          ]}
          extraActions={(s) => (s.isCurrent ? null : <Button size="sm" variant="outline" onClick={() => setCurrent.mutate(s._id)}>Set current</Button>)}
        />
      )}
      {tab === 'Classes' && sessionId && (
        <CrudTable<Cls>
          title="Class" path="/api/classes" params={withSession} canWrite={write} schema={classSchema} searchable
          fields={[{ name: 'name', label: 'Class name' }, { name: 'order', label: 'Display order', type: 'number' }]}
          toBody={(v) => ({ ...v, academicSession: sessionId })}
          columns={[{ header: 'Class', cell: (c) => c.name }, { header: 'Order', cell: (c) => c.order ?? '—' }, { header: 'Status', cell: (c) => <ActiveBadge on={c.isActive} /> }]}
        />
      )}
      {tab === 'Sections' && sessionId && (
        <CrudTable<Sec>
          title="Section" path="/api/sections" params={withSession} canWrite={write} schema={sectionSchema} searchable
          fields={[{ name: 'class', label: 'Class', type: 'select', options: classes.map((c) => ({ value: c._id, label: c.name })), editable: false }, { name: 'name', label: 'Section name' }]}
          toForm={(s) => ({ class: idOf(s.class), name: s.name })}
          columns={[{ header: 'Class', cell: (s) => nameOf(classes, s.class) }, { header: 'Section', cell: (s) => s.name }, { header: 'Status', cell: (s) => <ActiveBadge on={s.isActive} /> }]}
        />
      )}
      {tab === 'Subjects' && (
        <CrudTable<Subj>
          title="Subject" path="/api/subjects" canWrite={write} schema={subjectSchema} searchable
          fields={[{ name: 'name', label: 'Subject name' }, { name: 'code', label: 'Code' }]}
          columns={[{ header: 'Subject', cell: (s) => s.name }, { header: 'Code', cell: (s) => s.code }, { header: 'Status', cell: (s) => <ActiveBadge on={s.isActive} /> }]}
        />
      )}
      {tab === 'Teacher assignments' && sessionId && (
        <CrudTable<Assign & { _id: string }>
          title="Teacher assignment" path="/api/teacher-assignments" params={withSession} canWrite={write} schema={assignSchema}
          fields={[
            { name: 'section', label: 'Section', type: 'select', options: sections.map((s) => ({ value: s._id, label: sectionLabel(s) })), editable: false },
            { name: 'subject', label: 'Subject', type: 'select', options: subjects.map((s) => ({ value: s._id, label: s.name })), editable: false },
            { name: 'teacher', label: 'Teacher', type: 'select', options: teachers.map((t) => ({ value: t.id, label: t.fullName })) },
          ]}
          toForm={(a) => ({ section: idOf(a.section), subject: idOf(a.subject), teacher: idOf(a.teacher) })}
          toBody={(v) => ({ ...v, academicSession: sessionId })}
          columns={[
            { header: 'Section', cell: (a) => { const s = sections.find((x) => x._id === idOf(a.section)); return s ? sectionLabel(s) : labelOf(a.section); } },
            { header: 'Subject', cell: (a) => nameOf(subjects, a.subject) },
            { header: 'Teacher', cell: (a) => teachers.find((t) => t.id === idOf(a.teacher))?.fullName ?? labelOf(a.teacher) },
            { header: 'Status', cell: (a) => <ActiveBadge on={a.isActive} /> },
          ]}
        />
      )}
    </div>
  );
}
