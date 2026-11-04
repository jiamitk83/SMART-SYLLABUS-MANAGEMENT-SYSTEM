import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MonthlyRegister } from '@ssms/shared';
import { Alert, Button, Card, Empty, Field, Input, PageHeader, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { downloadReport, pctText, todayStr, useScopeSelection } from './common';

type Monthly = MonthlyRegister & { sessionName: string; section: { className: string; name: string }; threshold: number; states: Record<string, string> };

const CELL: Record<string, string> = { P: 'text-green-700', A: 'bg-red-50 font-semibold text-red-700', L: 'text-amber-700', H: 'bg-slate-200 text-slate-500' };

export function MonthlyRegisterPage() {
  const sel = useScopeSelection();
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [err, setErr] = useState('');
  const q = useQuery({
    queryKey: ['att-monthly', sel.sectionId, month],
    queryFn: async () => (await api.get<{ data: Monthly }>('/attendance/monthly', { params: { section: sel.sectionId, month } })).data.data,
    enabled: !!sel.sectionId && /^\d{4}-\d{2}$/.test(month),
  });
  const m = q.data;
  const dl = (f: 'pdf' | 'xlsx' | 'csv') => {
    setErr('');
    downloadReport(f === 'pdf' ? 'register' : 'monthly', f, { section: sel.sectionId, month, academicSession: sel.sessionId }, `attendance-${month}`).catch((e) => setErr(errorMessage(e)));
  };

  return (
    <div>
      <PageHeader
        title="Monthly Attendance Register"
        subtitle="P = Present, A = Absent, L = Leave, H = Holiday / weekly off, blank = not recorded"
        actions={m && (
          <div className="no-print flex gap-2">
            <Button variant="outline" onClick={() => dl('pdf')}>PDF</Button>
            <Button variant="outline" onClick={() => dl('xlsx')}>Excel</Button>
            <Button variant="outline" onClick={() => dl('csv')}>CSV</Button>
            <Button onClick={() => window.print()}>Print</Button>
          </div>
        )}
      />
      {sel.bar(<Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>)}
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      {!sel.sectionId ? <Card><Empty>Select a class and section.</Empty></Card> : q.isLoading ? <Spinner /> : q.error ? <Alert>{errorMessage(q.error)}</Alert> : m && (
        <Card className="p-4">
          <h2 className="mb-1 text-lg font-semibold">Class {m.section.className}-{m.section.name} · {m.month} · {m.sessionName}</h2>
          <p className="mb-3 text-sm text-slate-500">{m.days} days · {m.workingDays} working days recorded</p>
          {!m.rows.length ? <Empty>No students.</Empty> : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border p-1">Roll</th><th className="border p-1">Adm.</th><th className="sticky left-0 border bg-slate-100 p-1 text-left">Student</th>
                    {m.dates.map((d, i) => <th key={d} className="min-w-[1.6rem] border p-1">{i + 1}</th>)}
                    <th className="border p-1">P</th><th className="border p-1">A</th><th className="border p-1">L</th><th className="border p-1">WD</th><th className="border p-1">%</th>
                  </tr>
                </thead>
                <tbody>
                  {m.rows.map((r) => {
                    const low = r.summary.percentage !== null && r.summary.percentage < m.threshold;
                    return (
                      <tr key={r.id}>
                        <td className="border p-1">{r.rollNumber}</td><td className="border p-1">{r.admissionNumber}</td>
                        <td className="sticky left-0 whitespace-nowrap border bg-white p-1">{r.name}</td>
                        {r.cells.map((c, i) => <td key={i} className={`border p-1 text-center ${CELL[c] ?? ''}`}>{c}</td>)}
                        <td className="border p-1 text-center">{r.summary.present}</td><td className="border p-1 text-center">{r.summary.absent}</td><td className="border p-1 text-center">{r.summary.leave}</td>
                        <td className="border p-1 text-center">{r.summary.recorded}</td>
                        <td className={`border p-1 text-center font-semibold ${low ? 'text-red-700' : ''}`}>{pctText(r.summary.percentage)}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-50 font-semibold">
                    <td className="border p-1" colSpan={3}>Total</td><td className="border p-1" colSpan={m.days} />
                    <td className="border p-1 text-center">{m.totals.present}</td><td className="border p-1 text-center">{m.totals.absent}</td><td className="border p-1 text-center">{m.totals.leave}</td><td className="border p-1" colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">Percentage = Present ÷ (Present + Absent + Leave) of recorded working days. Holidays and unrecorded days are excluded. Red = below {m.threshold}%.</p>
        </Card>
      )}
    </div>
  );
}
