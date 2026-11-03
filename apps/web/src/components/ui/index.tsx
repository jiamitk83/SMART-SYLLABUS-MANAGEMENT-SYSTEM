import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const variants = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-200',
  outline: 'border border-slate-300 bg-white hover:bg-slate-50 text-slate-700',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost: 'text-slate-600 hover:bg-slate-100',
};

export function Button({ variant = 'primary', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: 'sm' | 'md' }) {
  return (
    <button
      {...p}
      className={cn('inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:cursor-not-allowed', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm', variants[variant], className)}
    />
  );
}

const field = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} {...p} className={cn(field, className)} />);
Input.displayName = 'Input';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} {...p} className={cn(field, className)} />);
Select.displayName = 'Select';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} rows={3} {...p} className={cn(field, className)} />);
Textarea.displayName = 'Textarea';

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error && <span role="alert" className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn('rounded-xl border border-slate-200 bg-white p-4 shadow-sm', className)}>{children}</div>
);

const tones = { blue: 'bg-brand-100 text-brand-800', green: 'bg-green-100 text-green-800', red: 'bg-red-100 text-red-800', amber: 'bg-amber-100 text-amber-800', gray: 'bg-slate-100 text-slate-700' };
export const Badge = ({ tone = 'gray', children }: { tone?: keyof typeof tones; children: ReactNode }) => (
  <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>
);

export function ProgressBar({ value, planned }: { value: number; planned?: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-brand-600" style={{ width: `${v}%` }} />
      {planned !== undefined && <div className="absolute top-0 h-full w-0.5 bg-amber-500" style={{ left: `${Math.min(100, planned)}%` }} title={`Planned ${Math.round(planned)}%`} />}
    </div>
  );
}

export const Spinner = () => <div className="p-6 text-center text-sm text-slate-500">Loading…</div>;
export const Alert = ({ tone = 'red', children }: { tone?: 'red' | 'green' | 'amber'; children: ReactNode }) => (
  <div role="alert" className={cn('rounded-md border px-3 py-2 text-sm', tone === 'red' && 'border-red-200 bg-red-50 text-red-800', tone === 'green' && 'border-green-200 bg-green-50 text-green-800', tone === 'amber' && 'border-amber-200 bg-amber-50 text-amber-800')}>{children}</div>
);
export const Empty = ({ children = 'No records found.' }: { children?: ReactNode }) => <div className="p-8 text-center text-sm text-slate-500">{children}</div>;

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T extends { _id?: string }>({ columns, rows }: { columns: Column<T>[]; rows: T[] }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
          <tr>{columns.map((c) => <th key={c.header} className={cn('px-3 py-2 font-medium', c.className)}>{c.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={r._id ?? i} className="hover:bg-slate-50">
              {columns.map((c) => <td key={c.header} className={cn('px-3 py-2 align-top', c.className)}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t px-3 py-2 text-sm text-slate-600">
      <span>{total} record{total === 1 ? '' : 's'}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages}</span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
