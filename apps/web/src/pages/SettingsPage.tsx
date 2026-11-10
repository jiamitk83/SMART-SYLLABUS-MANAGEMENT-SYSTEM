import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ACTIVITY_TYPES, DEFAULT_ACTIVITY_WEIGHTS } from '@ssms/shared';
import { Alert, Button, Card, Input, PageHeader, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { ACTIVITY_LABEL } from './ProgressPage';

export function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['weights'], queryFn: async () => (await api.get<{ data: Record<string, number> }>('/settings/activity-weights')).data.data });
  const [w, setW] = useState<Record<string, number>>({ ...DEFAULT_ACTIVITY_WEIGHTS });
  useEffect(() => { if (q.data) setW(q.data); }, [q.data]);
  const total = ACTIVITY_TYPES.reduce((s, t) => s + (Number(w[t]) || 0), 0);
  const save = useMutation({ mutationFn: () => api.put('/api/settings/activity-weights', w), onSuccess: () => qc.invalidateQueries() });
  if (q.isLoading) return <Spinner />;
  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="Settings" subtitle="Default activity weights used in chapter progress" />
      <Card className="space-y-3">
        {q.error && <Alert>{errorMessage(q.error)}</Alert>}
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        {save.isSuccess && <Alert tone="green">Weights saved. Progress is recalculated on the fly.</Alert>}
        {ACTIVITY_TYPES.map((t) => (
          <label key={t} className="grid grid-cols-[1fr_6rem] items-center gap-2 text-sm">
            <span>{ACTIVITY_LABEL[t]}</span>
            <Input type="number" min={0} max={100} value={w[t] ?? 0} onChange={(e) => setW((s) => ({ ...s, [t]: Number(e.target.value) }))} />
          </label>
        ))}
        <div className={`text-sm ${total === 100 ? 'text-green-700' : 'text-red-600'}`}>Total: {total} (must equal 100)</div>
        <div className="flex gap-2"><Button disabled={total !== 100 || save.isPending} onClick={() => save.mutate()}>Save</Button><Button variant="outline" onClick={() => setW({ ...DEFAULT_ACTIVITY_WEIGHTS })}>Reset to defaults</Button></div>
        <p className="text-xs text-slate-500">When an activity is marked not applicable for a chapter, the remaining weights are re-normalised to 100%.</p>
      </Card>
    </div>
  );
}
