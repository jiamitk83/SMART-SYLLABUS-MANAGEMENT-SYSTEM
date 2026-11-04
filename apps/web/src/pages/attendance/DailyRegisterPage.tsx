import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Empty, Field, Input, PageHeader, Spinner } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { StateBadge, STATUS_LABEL, todayStr, useScopeSelection } from './common';
import { useSheet } from './MarkAttendancePage';

export function DailyRegisterPage() {
  const [params] = useSearchParams();
  const sel = useScopeSelection(params.get('section') ?? '');
  const { can } = useAuth();
  const [date, setDate] = useState(params.get('date') ?? todayStr());
  const [q, setQ] = useState('');
  const sheetQ = useSheet(sel.sectionId, date, 'daily');
  const sheet = sheetQ.data;
  const rows = (sheet?.students ?? []).filter((s) => !q.trim() || `${s.name} ${s.rollNumber} ${s.admissionNumber}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Daily Attendance Register"
        subtitle="Complete student list with the status for one date"
        actions={sheet && (
          <div className="no-print flex gap-2">
            {can('attendance:mark') && <Link to={`/attendance/mark?section=${sel.sectionId}&date=${date}`}><Button variant="outline">Edit</Button></Link>}
            <Button onClick={() => window.print()}>Print</Button>
          </div>
        )}
      />
      {sel.bar(<Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>)}
      {!sel.sectionId ? <Card><Empty>Select a class and section.</Empty></Card> : sheetQ.isLoading ? <Spinner /> : sheetQ.error ? <Alert>{errorMessage(sheetQ.error)}</Alert> : sheet && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Class {sheet.section.className}-{sheet.section.name} · {sheet.date}</h2>
            <StateBadge state={sheet.state} />
            {sheet.holiday && <Badge tone="amber">Holiday</Badge>}
          </div>
          <Input className="no-print mb-3 max-w-xs" placeholder="Search students" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students" />
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-slate-500"><th className="p-2">Roll</th><th className="p-2">Adm. No.</th><th className="p-2">Student</th><th className="p-2">Status</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b">
                  <td className="p-2">{s.rollNumber}</td><td className="p-2">{s.admissionNumber}</td><td className="p-2">{s.name}</td>
                  <td className="p-2">{s.status ? STATUS_LABEL[s.status] : <span className="text-slate-400">Unmarked</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm">Total {sheet.summary.total} · Present {sheet.summary.present} · Absent {sheet.summary.absent} · Leave {sheet.summary.leave} · Unmarked {sheet.summary.unmarked}</p>
          <div className="mt-10 hidden justify-between text-sm print:flex"><span>Class Teacher: ____________</span><span>Principal: ____________</span></div>
        </Card>
      )}
    </div>
  );
}
