import { useState } from 'react';
import { Alert, Card, DataTable, Input, PageHeader, Pagination, Spinner } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useList } from '@/lib/hooks';

interface Log { _id: string; createdAt: string; actorName?: string; action: string; entityType?: string; entityId?: string; details?: unknown; ip?: string }

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = useList<Log>('audit', '/audit-logs', { page, pageSize: 20, action: action || undefined, entityType: entityType || undefined, from: from || undefined, to: to ? `${to}T23:59:59.999Z` : undefined });
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle="Append-only record of important actions" />
      <Card className="p-0">
        <div className="grid gap-2 p-3 md:grid-cols-4">
          <Input placeholder="Action (e.g. LOGIN_FAILED)" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
          <Input placeholder="Entity type" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} />
          <Input type="date" aria-label="From" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <Input type="date" aria-label="To" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
        {list.isLoading ? <Spinner /> : list.error ? <div className="p-3"><Alert>{errorMessage(list.error)}</Alert></div> : (
          <>
            <DataTable<Log>
              rows={list.data?.data ?? []}
              columns={[
                { header: 'When', cell: (l) => new Date(l.createdAt).toLocaleString() },
                { header: 'Actor', cell: (l) => l.actorName ?? '—' },
                { header: 'Action', cell: (l) => l.action },
                { header: 'Entity', cell: (l) => l.entityType ?? '—' },
                { header: 'Details', cell: (l) => <code className="block max-w-xs truncate text-xs" title={JSON.stringify(l.details ?? {})}>{l.details ? JSON.stringify(l.details) : ''}</code> },
              ]}
            />
            <Pagination page={page} pageSize={20} total={list.data?.meta.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
