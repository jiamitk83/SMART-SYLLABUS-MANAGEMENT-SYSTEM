import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DataTable, ProgressBar } from '@/components/ui';
import { passwordSchema } from '@/lib/schemas';
import { LoginPage } from '@/pages/AuthPages';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

describe('passwordSchema', () => {
  it('rejects weak passwords', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('alllowercase123').success).toBe(false);
    expect(passwordSchema.safeParse('NoDigitsHereAtAll').success).toBe(false);
  });
  it('accepts strong passwords', () => {
    expect(passwordSchema.safeParse('GoodPassw0rd!').success).toBe(true);
  });
});

describe('ProgressBar', () => {
  it('clamps values to 0-100', () => {
    render(<ProgressBar value={150} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});

describe('DataTable', () => {
  it('renders rows and empty state', () => {
    const { rerender } = render(<DataTable<{ _id: string; n: string }> rows={[{ _id: '1', n: 'Alpha' }]} columns={[{ header: 'Name', cell: (r) => r.n }]} />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    rerender(<DataTable<{ _id: string; n: string }> rows={[]} columns={[{ header: 'Name', cell: (r) => r.n }]} />);
    expect(screen.getByText('No records found.')).toBeTruthy();
  });
});

describe('LoginPage', () => {
  it('shows validation errors on empty submit', async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><LoginPage /></MemoryRouter></QueryClientProvider>);
    screen.getByRole('button', { name: /sign in/i }).click();
    expect((await screen.findAllByText(/required/i)).length).toBeGreaterThan(0);
  });
});
