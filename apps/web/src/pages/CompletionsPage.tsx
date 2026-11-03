import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ChapterPickerFields, useChapterPicker } from '@/components/ChapterPicker';
import { Alert, Badge, Button, Card, DataTable, Field, Input, Modal, PageHeader, Pagination, Select, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { labelOf, useList } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';
import { useAuth } from '@/store/auth';

interface Comp { _id: string; status: string; remarks?: string; updatedAt: string; chapter?: unknown; section?: unknown; class?: unknown; subject?: unknown; requestedBy?: unknown; reviewedBy?: unknown }
const TONE: Record<string, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = { APPROVED: 'green', PENDING_APPROVAL: 'amber', REJECTED: 'red', REOPENED: 'blue' };

function RequestModal({ onClose, canDirect }: { onClose: () => void; canDirect: boolean }) {
  const qc = useQueryClient();
  const p = useChapterPicker();
  const [remarks, setRemarks] = useState('');
  const [direct, setDirect] = useState(false);
  const m = useMutation({
    mutationFn: () => api.post('/chapter-completions', { section: p.section, chapter: p.chapter, remarks: remarks || undefined, direct: direct || undefined }),
    onSuccess: () => { void qc.invalidateQueries(); onClose(); },
  });
  return (
    <Modal title="Request chapter completion" onClose={onClose}>
      <div className="space-y-3">
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        <div className="grid gap-2"><ChapterPickerFields p={p} /></div>
        <Field label="Remarks"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        {canDirect && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} /> Approve directly (skip review)</label>}
        <p className="text-xs text-slate-500">A chapter counts as completed only after the completion is approved. Daily topic entries never complete a chapter on their own.</p>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!p.section || !p.chapter || m.isPending} onClick={() => m.mutate()}>Submit request</Button></div>
      </div>
    </Modal>
  );
}

export function CompletionsPage() {
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [asking, setAsking] = useState(false);
  const list = useList<Comp>('completions', '/chapter-completions', { status, page, pageSize: 15 });
  const review = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' | 'reopen' }) => {
      const remarks = action === 'approve' ? '' : window.prompt(`Remarks for ${action} (optional)`) ?? '';
      return api.post(`/chapter-completions/${id}/${action}`, { remarks: remarks || undefined });
    },
    onSuccess: () => qc.invalidateQueries(),
  });
  const approve = can('completion:approve');
  return (
    <div className="space-y-4">
      <PageHeader title="Chapter completion" subtitle="Teachers request; coordinators or the principal approve" actions={can('completion:record') || approve ? <Button onClick={() => setAsking(true)}>Request completion</Button> : undefined} />
      <Card className="p-0">
        <div className="p-3"><Select className="w-52" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status filter"><option value="">All statuses</option><option value="PENDING_APPROVAL">Pending approval</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="REOPENED">Reopened</option></Select></div>
        {review.error && <div className="px-3"><Alert>{errorMessage(review.error)}</Alert></div>}
        {list.isLoading ? <Spinner /> : list.error ? <div className="p-3"><Alert>{errorMessage(list.error)}</Alert></div> : (
          <>
            <DataTable<Comp>
              rows={list.data?.data ?? []}
              columns={[
                { header: 'Chapter', cell: (c) => labelOf(c.chapter) },
                { header: 'Class', cell: (c) => `${labelOf(c.class)}-${labelOf(c.section)} · ${labelOf(c.subject)}` },
                { header: 'Status', cell: (c) => <Badge tone={TONE[c.status] ?? 'gray'}>{c.status.replace('_', ' ')}</Badge> },
                { header: 'Requested by', cell: (c) => labelOf(c.requestedBy) },
                { header: 'Reviewed by', cell: (c) => labelOf(c.reviewedBy) },
                { header: 'Updated', cell: (c) => fmtDate(c.updatedAt) },
                { header: '', cell: (c) => approve && (
                  <div className="flex gap-1">
                    {c.status === 'PENDING_APPROVAL' && <><Button size="sm" onClick={() => review.mutate({ id: c._id, action: 'approve' })}>Approve</Button><Button size="sm" variant="outline" onClick={() => review.mutate({ id: c._id, action: 'reject' })}>Reject</Button></>}
                    {c.status === 'APPROVED' && <Button size="sm" variant="outline" onClick={() => review.mutate({ id: c._id, action: 'reopen' })}>Reopen</Button>}
                  </div>
                ) },
              ]}
            />
            <Pagination page={page} pageSize={15} total={list.data?.meta.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
      {asking && <RequestModal canDirect={approve} onClose={() => setAsking(false)} />}
    </div>
  );
}
