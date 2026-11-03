import { useQuery } from '@tanstack/react-query';
import { api, type Page } from './api';

export interface Ref { _id: string; name?: string; title?: string; code?: string; fullName?: string }
export interface Session { _id: string; name: string; isCurrent: boolean; isActive: boolean; startDate: string; endDate: string }
export interface Cls { _id: string; name: string; order?: number; isActive: boolean; academicSession: string }
export interface Sec { _id: string; name: string; class: Ref | string; isActive: boolean }
export interface Subj { _id: string; name: string; code: string; isActive: boolean }
export interface Assign { _id: string; section: Ref | string; subject: Ref | string; teacher: Ref | string; isActive?: boolean }
export interface UserRow { id: string; _id?: string; username: string; email: string; fullName: string; role: string; isActive: boolean; employeeCode?: string; phone?: string; lastLoginAt?: string }

export const idOf = (x: unknown): string => (x && typeof x === 'object' ? String((x as { _id: string })._id) : String(x ?? ''));
export const labelOf = (x: unknown, fallback = '—'): string => {
  if (!x) return fallback;
  if (typeof x !== 'object') return String(x);
  const r = x as Ref;
  return r.fullName ?? r.name ?? r.title ?? fallback;
};

export async function fetchList<T>(path: string, params: Record<string, unknown> = {}): Promise<Page<T>> {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
  return (await api.get<Page<T>>(path, { params: { pageSize: 200, ...clean } })).data;
}

export function useList<T>(key: string, path: string, params: Record<string, unknown> = {}, enabled = true) {
  return useQuery({ queryKey: [key, path, params], queryFn: () => fetchList<T>(path, params), enabled });
}

export function useSessions() {
  const q = useList<Session>('lookup', '/academic-sessions');
  const current = q.data?.data.find((s) => s.isCurrent) ?? q.data?.data[0];
  return { ...q, sessions: q.data?.data ?? [], current };
}

export function useSubjects() {
  return useList<Subj>('lookup', '/subjects').data?.data ?? [];
}

export function useClassesSections(sessionId?: string) {
  const classes = useList<Cls>('lookup', '/classes', { academicSession: sessionId }, !!sessionId).data?.data ?? [];
  const sections = useList<Sec>('lookup', '/sections', { academicSession: sessionId }, !!sessionId).data?.data ?? [];
  return { classes, sections };
}

export function useTeachers() {
  return useList<UserRow>('lookup', '/teachers').data?.data ?? [];
}

export const sectionLabel = (s: Sec) => `${labelOf(s.class)}-${s.name}`;
