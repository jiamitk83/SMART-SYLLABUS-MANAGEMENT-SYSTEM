import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Select } from '@/components/ui';
import { api } from '@/lib/api';
import { idOf, sectionLabel, useClassesSections, useList, useSessions, useSubjects, type Assign } from '@/lib/hooks';
import { useAuth } from '@/store/auth';

export interface TreeChapter { id: string; title: string; order: number; isActive: boolean; topics: Array<{ id: string; title: string; isActive: boolean; subtopics: Array<{ id: string; title: string; isActive: boolean }> }> }

export function useScope() {
  const user = useAuth((s) => s.user);
  const { current, sessions } = useSessions();
  const { sections } = useClassesSections(current?._id);
  const subjects = useSubjects();
  const assignments = useList<Assign>('lookup', '/teacher-assignments', { academicSession: current?._id, isActive: 'true' }, !!current).data?.data ?? [];
  const isTeacher = user?.role === 'TEACHER';
  const mine = isTeacher ? assignments.filter((a) => idOf(a.teacher) === user?.id) : assignments;
  return { current, sessions, sections, subjects, assignments: mine, isTeacher };
}

export function useChapterPicker(opts: { restrictToAssignments?: boolean } = {}) {
  const scope = useScope();
  const [section, setSection] = useState('');
  const [subject, setSubject] = useState('');
  const [chapter, setChapter] = useState('');
  const restrict = opts.restrictToAssignments ?? scope.isTeacher;
  const sectionOptions = useMemo(() => {
    const allowed = restrict ? new Set(scope.assignments.map((a) => idOf(a.section))) : null;
    return scope.sections.filter((s) => s.isActive && (!allowed || allowed.has(s._id)));
  }, [scope.sections, scope.assignments, restrict]);
  const subjectOptions = useMemo(() => {
    if (!restrict) return scope.subjects.filter((s) => s.isActive);
    const ids = new Set(scope.assignments.filter((a) => idOf(a.section) === section).map((a) => idOf(a.subject)));
    return scope.subjects.filter((s) => ids.has(s._id));
  }, [scope.subjects, scope.assignments, section, restrict]);
  const classId = idOf(scope.sections.find((s) => s._id === section)?.class);
  const tree = useQuery({
    queryKey: ['tree', 'picker', scope.current?._id, classId, subject],
    enabled: !!(scope.current && classId && subject),
    queryFn: async () => (await api.get<{ data: TreeChapter[] }>('/syllabus/tree', { params: { academicSession: scope.current!._id, class: classId, subject } })).data.data,
  });
  useEffect(() => { setSubject(''); setChapter(''); }, [section]);
  useEffect(() => { setChapter(''); }, [subject]);
  const chapters = (tree.data ?? []).filter((c) => c.isActive);
  const chapterObj = chapters.find((c) => c.id === chapter);
  return { scope, section, setSection, subject, setSubject, chapter, setChapter, sectionOptions, subjectOptions, chapters, chapterObj, classId, treeLoading: tree.isLoading };
}

type Picker = ReturnType<typeof useChapterPicker>;

export function ChapterPickerFields({ p, withChapter = true }: { p: Picker; withChapter?: boolean }) {
  return (
    <>
      <Select value={p.section} onChange={(e) => p.setSection(e.target.value)} aria-label="Section"><option value="">Class-section…</option>{p.sectionOptions.map((s) => <option key={s._id} value={s._id}>{sectionLabel(s)}</option>)}</Select>
      <Select value={p.subject} onChange={(e) => p.setSubject(e.target.value)} aria-label="Subject" disabled={!p.section}><option value="">Subject…</option>{p.subjectOptions.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
      {withChapter && <Select value={p.chapter} onChange={(e) => p.setChapter(e.target.value)} aria-label="Chapter" disabled={!p.subject}><option value="">{p.treeLoading ? 'Loading…' : 'Chapter…'}</option>{p.chapters.map((c) => <option key={c.id} value={c.id}>{c.order}. {c.title}</option>)}</Select>}
    </>
  );
}
