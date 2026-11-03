import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));
export const fmtDate = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const toInputDate = (d?: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');
export const pct = (n?: number | null) => `${Math.round((n ?? 0) * 10) / 10}%`;

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  PRINCIPAL: 'Principal',
  ACADEMIC_COORDINATOR: 'Academic Coordinator',
  TEACHER: 'Teacher',
};
