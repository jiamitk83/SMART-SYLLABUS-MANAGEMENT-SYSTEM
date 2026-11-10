import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ROLES } from '@ssms/shared';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Pagination, Spinner, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useList } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';
import { useAuth } from '@/store/auth';

interface Note { _id: string; type: string; title: string; message?: string; link?: string; readAt?: string | null; createdAt: string }

function Announce({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [roles, setRoles] = useState<string[]>(['TEACHER']);
  const m = useMutation({ mutationFn: () => api.post('/api/notifications/announce', { title, message, roles }), onSuccess: onClose });
  return (
    <Modal title="Send announcement" onClose={onClose}>
      <div className="space-y-3">
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Message"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-3 text-sm">{ROLES.map((r) => <label key={r} className="flex items-center gap-1"><input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles((s) => (e.target.checked ? [...s, r] : s.filter((x) => x !== r)))} />{r.replace('_', ' ')}</label>)}</div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={title.trim().length < 2 || !roles.length || m.isPending} onClick={() => m.mutate()}>Send</Button></div>
      </div>
    </Modal>
  );
}

export function NotificationsPage() {
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [unread, setUnread] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const list = useList<Note>('notifications', '/notifications', { page, pageSize: 15, unread: unread ? 'true' : undefined });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readOne = useMutation({ mutationFn: (id: string) => api.post(`/api/notifications/${id}/read`), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api.post('/api/notifications/read-all'), onSuccess: refresh });
  const gen = useMutation({ mutationFn: () => api.post('/api/notifications/generate'), onSuccess: refresh });
  return (
    <div className="space-y-4">
      <PageHeader title="Notifications" actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setUnread((u) => !u)}>{unread ? 'Show all' : 'Unread only'}</Button>
          <Button variant="outline" onClick={() => readAll.mutate()}>Mark all read</Button>
          {can('notifications:manage') && <><Button variant="outline" disabled={gen.isPending} onClick={() => gen.mutate()}>Generate reminders</Button><Button onClick={() => setAnnounce(true)}>Announce</Button></>}
        </div>
      } />
      {gen.error && <Alert>{errorMessage(gen.error)}</Alert>}
      <Card className="p-0">
        {list.isLoading ? <Spinner /> : list.error ? <div className="p-3"><Alert>{errorMessage(list.error)}</Alert></div> : !(list.data?.data.length) ? <div className="p-8 text-center text-sm text-slate-500">No notifications.</div> : (
          <ul className="divide-y">
            {list.data.data.map((n) => (
              <li key={n._id} className={`flex items-start justify-between gap-3 p-3 ${n.readAt ? '' : 'bg-brand-50'}`}>
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">{n.title}<Badge>{n.type.replace('_', ' ')}</Badge></div>
                  {n.message && <p className="text-sm text-slate-600">{n.message}</p>}
                  <p className="text-xs text-slate-400">{fmtDate(n.createdAt)} {n.link && <Link className="ml-2 text-brand-700 underline" to={n.link}>Open</Link>}</p>
                </div>
                {!n.readAt && <Button size="sm" variant="outline" onClick={() => readOne.mutate(n._id)}>Mark read</Button>}
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} pageSize={15} total={list.data?.meta.total ?? 0} onPage={setPage} />
      </Card>
      {announce && <Announce onClose={() => { setAnnounce(false); void refresh(); }} />}
    </div>
  );
}
