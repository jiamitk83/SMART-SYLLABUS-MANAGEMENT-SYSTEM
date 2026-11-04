import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/store/auth';

const state = { sheetState: 'DRAFT' };
const students = [
  { id: 's1', rollNumber: '1', admissionNumber: 'A1', name: 'Asha', status: null },
  { id: 's2', rollNumber: '2', admissionNumber: 'A2', name: 'Bala', status: null },
];
const put = vi.fn().mockResolvedValue({ data: {} });

vi.mock('@/lib/api', () => ({
  errorMessage: (e: unknown) => String(e),
  api: {
    put: (...a: unknown[]) => put(...a),
    get: vi.fn(async (url: string) => {
      if (url === '/academic-sessions') return { data: { data: [{ _id: 'ses', name: '2025-26', isCurrent: true, isActive: true, startDate: '2025-04-01', endDate: '2026-03-31' }], total: 1, page: 1, pageSize: 200 } };
      if (url === '/attendance/scope') return { data: { data: { academicSession: 'ses', schoolWide: true, classes: [{ id: 'c1', name: '5' }], sections: [{ id: 'sec1', name: 'A', classId: 'c1' }], capabilities: { mark: true, correct: false } } } };
      if (url === '/attendance/sheet') {
        return { data: { data: { section: { id: 'sec1', name: 'A', className: '5' }, date: '2026-01-05', state: state.sheetState, nonWorking: false, holiday: false, inSession: true, students, summary: { present: 0, absent: 0, leave: 0, unmarked: 2, total: 2 } } } };
      }
      return { data: { data: [] } };
    }),
  },
}));

import { MarkAttendancePage } from '@/pages/attendance/MarkAttendancePage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/attendance/mark?section=sec1&date=2026-01-05']}><MarkAttendancePage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MarkAttendancePage', () => {
  beforeEach(() => {
    put.mockClear();
    useAuth.setState({ user: null, accessToken: null, ready: true });
  });

  it('marks all present and submits a draft without a reason', async () => {
    state.sheetState = 'DRAFT';
    renderPage();
    await screen.findByText('Asha');
    await userEvent.click(screen.getByRole('button', { name: 'Mark all Present' }));
    await waitFor(() => expect(screen.getByText(/Present/, { selector: 'div.bg-green-100' }).textContent).toContain('2'));
    await userEvent.click(screen.getByRole('button', { name: 'Submit register' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0]![1] as { submit: boolean; reason?: string; entries: unknown[] };
    expect(body.submit).toBe(true);
    expect(body.reason).toBeUndefined();
    expect(body.entries).toHaveLength(2);
  });

  it('disables Submit while students are unmarked', async () => {
    state.sheetState = 'DRAFT';
    renderPage();
    await screen.findByText('Asha');
    expect((screen.getByRole('button', { name: 'Submit register' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires a reason to overwrite a submitted register', async () => {
    state.sheetState = 'SUBMITTED';
    renderPage();
    await screen.findByText('Asha');
    await userEvent.click(screen.getByRole('button', { name: 'Mark all Absent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm overwrite' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Correction reason'), 'Wrong child marked');
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(confirm);
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect((put.mock.calls[0]![1] as { reason: string }).reason).toBe('Wrong child marked');
  });

  it('is read-only for a locked register', async () => {
    state.sheetState = 'LOCKED';
    renderPage();
    await screen.findByText('Asha');
    expect(screen.queryByRole('button', { name: 'Mark all Present' })).toBeNull();
    expect((screen.getAllByRole('button', { name: 'Present' })[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
