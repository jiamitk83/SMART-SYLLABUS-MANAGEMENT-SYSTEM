import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PERMISSION_DESCRIPTIONS, ROLES, type Permission } from '@ssms/shared';
import { Alert, Badge, Button, Card, DataTable, Field, Input, Modal, PageHeader, Pagination, Select, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useList, type UserRow } from '@/lib/hooks';
import { passwordSchema } from '@/lib/schemas';
import { ROLE_LABEL, fmtDate } from '@/lib/utils';

const createSchema = z.object({
  username: z.string().trim().min(3, 'Min 3 characters').regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits . _ - only'),
  email: z.string().trim().email('Valid email required'),
  fullName: z.string().trim().min(2, 'Required'),
  role: z.enum(ROLES),
  password: passwordSchema,
  employeeCode: z.string().optional(),
  phone: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

function CreateUser({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState } = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { role: 'TEACHER' } });
  const m = useMutation({
    mutationFn: (v: CreateForm) => api.post('/api/users', { ...v, username: v.username.toLowerCase(), employeeCode: v.employeeCode || undefined, phone: v.phone || undefined, mustChangePassword: true }),
    onSuccess: () => { void qc.invalidateQueries(); onClose(); },
  });
  return (
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={handleSubmit((v) => m.mutate(v))} className="space-y-3" noValidate>
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        <Field label="Full name" error={formState.errors.fullName?.message}><Input {...register('fullName')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username" error={formState.errors.username?.message}><Input {...register('username')} /></Field>
          <Field label="Role"><Select {...register('role')}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
        </div>
        <Field label="Email" error={formState.errors.email?.message}><Input type="email" {...register('email')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employee code"><Input {...register('employeeCode')} /></Field>
          <Field label="Phone"><Input {...register('phone')} /></Field>
        </div>
        <Field label="Temporary password" error={formState.errors.password?.message}><Input type="password" autoComplete="new-password" {...register('password')} /></Field>
        <p className="text-xs text-slate-500">The user must change this password at first sign-in.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={m.isPending}>Create</Button></div>
      </form>
    </Modal>
  );
}

function ResetPassword({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const check = passwordSchema.safeParse(pw);
  const m = useMutation({ mutationFn: () => api.post(`/api/users/${user.id}/reset-password`, { password: pw }), onSuccess: onClose });
  return (
    <Modal title={`Reset password — ${user.fullName}`} onClose={onClose}>
      <div className="space-y-3">
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        <Field label="New temporary password" error={pw && !check.success ? check.error.issues[0]?.message : undefined}><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!check.success || m.isPending} onClick={() => m.mutate()}>Reset</Button></div>
      </div>
    </Modal>
  );
}

export function UsersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const list = useList<UserRow>('users', '/users', { page, pageSize: 20, q, role });
  const toggle = useMutation({
    mutationFn: (u: UserRow) => api.patch(`/api/users/${u.id}/active`, { isActive: !u.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const changeRole = useMutation({
    mutationFn: ({ u, r }: { u: UserRow; r: string }) => api.patch(`/api/users/${u.id}`, { role: r }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  return (
    <div>
      <PageHeader title="Users" subtitle="Manage staff accounts and roles" actions={<Button onClick={() => setAdding(true)}>Add user</Button>} />
      <Card className="p-0">
        <div className="flex flex-wrap gap-2 p-3">
          <Input placeholder="Search name, username, email" className="max-w-xs" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search users" />
          <Select className="w-48" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Filter by role">
            <option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </div>
        {toggle.error && <div className="px-3"><Alert>{errorMessage(toggle.error)}</Alert></div>}
        {changeRole.error && <div className="px-3"><Alert>{errorMessage(changeRole.error)}</Alert></div>}
        {list.isLoading ? <Spinner /> : list.error ? <div className="p-3"><Alert>{errorMessage(list.error)}</Alert></div> : (
          <>
            <DataTable<UserRow>
              rows={list.data?.data ?? []}
              columns={[
                { header: 'Name', cell: (u) => <div><div className="font-medium">{u.fullName}</div><div className="text-xs text-slate-500">{u.username} · {u.email}</div></div> },
                { header: 'Role', cell: (u) => <Select value={u.role} onChange={(e) => changeRole.mutate({ u, r: e.target.value })} aria-label={`Role of ${u.fullName}`}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select> },
                { header: 'Status', cell: (u) => <Badge tone={u.isActive ? 'green' : 'gray'}>{u.isActive ? 'Active' : 'Inactive'}</Badge> },
                { header: 'Last login', cell: (u) => fmtDate(u.lastLoginAt) },
                { header: '', cell: (u) => <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => toggle.mutate(u)}>{u.isActive ? 'Deactivate' : 'Activate'}</Button><Button size="sm" variant="outline" onClick={() => setResetting(u)}>Reset password</Button></div> },
              ]}
            />
            <Pagination page={page} pageSize={20} total={list.data?.meta.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
      {adding && <CreateUser onClose={() => setAdding(false)} />}
      {resetting && <ResetPassword user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

interface RoleDoc { name: string; permissions: string[] }

export function RolesPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['roles'], queryFn: async () => (await api.get<{ data: RoleDoc[]; allPermissions: string[] }>('/roles')).data });
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  const save = useMutation({
    mutationFn: ({ name, permissions }: { name: string; permissions: string[] }) => api.patch(`/api/roles/${name}`, { permissions }),
    onSuccess: (_r, v) => { setEdits((e) => { const n = { ...e }; delete n[v.name]; return n; }); void qc.invalidateQueries({ queryKey: ['roles'] }); },
  });
  if (isLoading) return <Spinner />;
  if (error || !data) return <Alert>{errorMessage(error)}</Alert>;
  return (
    <div className="space-y-4">
      <PageHeader title="Roles & permissions" subtitle="Super Admin always holds every permission and cannot be edited" />
      {save.error && <Alert>{errorMessage(save.error)}</Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        {ROLES.filter((r) => r !== 'SUPER_ADMIN').map((r) => {
          const current = edits[r] ?? data.data.find((d) => d.name === r)?.permissions ?? [];
          const dirty = !!edits[r];
          return (
            <Card key={r}>
              <h2 className="mb-2 font-medium">{ROLE_LABEL[r]}</h2>
              <div className="max-h-96 space-y-1 overflow-auto text-sm">
                {data.allPermissions.map((p) => (
                  <label key={p} className="flex items-center gap-2">
                    <input type="checkbox" checked={current.includes(p)} onChange={(e) => setEdits((s) => ({ ...s, [r]: e.target.checked ? [...current, p] : current.filter((x) => x !== p) }))} />
                    <span title={PERMISSION_DESCRIPTIONS[p as Permission]}>{p}</span>
                  </label>
                ))}
              </div>
              <Button className="mt-3" disabled={!dirty || save.isPending} onClick={() => save.mutate({ name: r, permissions: current })}>Save</Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
