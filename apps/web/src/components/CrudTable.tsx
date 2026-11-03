import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, type FieldValues, type Resolver } from 'react-hook-form';
import type { ZodTypeAny } from 'zod';
import { Alert, Badge, Button, Card, DataTable, Field, Input, Modal, Pagination, Select, Spinner, type Column } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useList } from '@/lib/hooks';

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: Array<{ value: string; label: string }>;
  editable?: boolean;
}

interface Props<T> {
  title: string;
  path: string;
  params?: Record<string, unknown>;
  columns: Column<T>[];
  fields: FieldDef[];
  schema: ZodTypeAny;
  createDefaults?: Record<string, unknown>;
  toBody?: (v: Record<string, unknown>) => Record<string, unknown>;
  toForm?: (row: T) => Record<string, unknown>;
  canWrite: boolean;
  searchable?: boolean;
  activeToggle?: boolean;
  extraActions?: (row: T) => React.ReactNode;
}

type Row = { _id: string; isActive?: boolean };

export function CrudTable<T extends Row>({ title, path, params = {}, columns, fields, schema, createDefaults, toBody, toForm, canWrite, searchable, activeToggle = true, extraActions }: Props<T>) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const list = useList<T>('crud', path, { ...params, page, pageSize: 20, q });
  const toggle = useMutation({
    mutationFn: (r: T) => api.patch(`${path}/${r._id}/active`, { isActive: !r.isActive }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const cols: Column<T>[] = [...columns];
  if (canWrite) {
    cols.push({
      header: '',
      cell: (r) => (
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setEditing(r)}>Edit</Button>
          {activeToggle && <Button size="sm" variant="outline" onClick={() => toggle.mutate(r)}>{r.isActive === false ? 'Activate' : 'Deactivate'}</Button>}
          {extraActions?.(r)}
        </div>
      ),
    });
  }

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <h2 className="font-medium">{title}</h2>
        <div className="flex gap-2">
          {searchable && <Input placeholder="Search" className="w-48" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label={`Search ${title}`} />}
          {canWrite && <Button size="sm" onClick={() => setEditing('new')}>Add</Button>}
        </div>
      </div>
      {toggle.error && <div className="px-3"><Alert>{errorMessage(toggle.error)}</Alert></div>}
      {list.isLoading ? <Spinner /> : list.error ? <div className="p-3"><Alert>{errorMessage(list.error)}</Alert></div> : (
        <>
          <DataTable<T> rows={list.data?.data ?? []} columns={cols} />
          <Pagination page={page} pageSize={20} total={list.data?.meta.total ?? 0} onPage={setPage} />
        </>
      )}
      {editing && (
        <EditModal<T> title={title} path={path} fields={fields} schema={schema} row={editing === 'new' ? null : editing} defaults={createDefaults} toBody={toBody} toForm={toForm} onClose={() => setEditing(null)} />
      )}
    </Card>
  );
}

function EditModal<T extends Row>({ title, path, fields, schema, row, defaults, toBody, toForm, onClose }: { title: string; path: string; fields: FieldDef[]; schema: ZodTypeAny; row: T | null; defaults?: Record<string, unknown>; toBody?: Props<T>['toBody']; toForm?: Props<T>['toForm']; onClose: () => void }) {
  const qc = useQueryClient();
  const visible = row ? fields.filter((f) => f.editable !== false) : fields;
  const { register, handleSubmit, formState } = useForm<FieldValues>({
    resolver: zodResolver(schema) as Resolver<FieldValues>,
    defaultValues: row ? (toForm ? toForm(row) : (row as unknown as FieldValues)) : defaults,
  });
  const m = useMutation({
    mutationFn: (v: FieldValues) => {
      const body = toBody ? toBody(v) : v;
      return row ? api.patch(`${path}/${row._id}`, body) : api.post(path, body);
    },
    onSuccess: () => { void qc.invalidateQueries(); onClose(); },
  });
  return (
    <Modal title={`${row ? 'Edit' : 'Add'} ${title}`} onClose={onClose}>
      <form onSubmit={handleSubmit((v) => m.mutate(v))} className="space-y-3" noValidate>
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        {visible.map((f) => {
          const err = formState.errors[f.name]?.message as string | undefined;
          return (
            <Field key={f.name} label={f.label} error={err}>
              {f.type === 'select' ? (
                <Select {...register(f.name)}>
                  <option value="">Select…</option>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ) : (
                <Input type={f.type ?? 'text'} step={f.type === 'number' ? 'any' : undefined} {...register(f.name, f.type === 'number' ? { setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)) } : undefined)} />
              )}
            </Field>
          );
        })}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={m.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}

export const ActiveBadge = ({ on }: { on?: boolean }) => <Badge tone={on === false ? 'gray' : 'green'}>{on === false ? 'Inactive' : 'Active'}</Badge>;
