import { describe, expect, it } from 'vitest';
import {
  buildMonthlyRegister,
  daysInMonth,
  isLeapYear,
  isLowAttendance,
  isValidDateString,
  monthDates,
  monthsBetween,
  summarizeAttendance,
  weekdayOf,
} from './attendance';

describe('calendar helpers', () => {
  it('handles 28, 29, 30 and 31 day months and leap years', () => {
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2025, 4)).toBe(30);
    expect(daysInMonth(2025, 12)).toBe(31);
    expect(isLeapYear(2024)).toBe(true);
    expect(monthDates('2024-02')).toHaveLength(29);
    expect(monthDates('2025-02')).toHaveLength(28);
  });
  it('validates dates', () => {
    expect(isValidDateString('2024-02-29')).toBe(true);
    expect(isValidDateString('2025-02-29')).toBe(false);
    expect(isValidDateString('2025-13-01')).toBe(false);
    expect(isValidDateString('2025-1-1')).toBe(false);
    expect(weekdayOf('2025-06-01')).toBe(0);
  });
  it('lists months between dates', () => {
    expect(monthsBetween('2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('summarizeAttendance', () => {
  it('counts P/A/L separately and never divides by zero', () => {
    expect(summarizeAttendance([])).toEqual({ present: 0, absent: 0, leave: 0, recorded: 0, denominator: 0, percentage: null });
    const s = summarizeAttendance(['PRESENT', 'PRESENT', 'ABSENT', 'LEAVE']);
    expect(s).toMatchObject({ present: 2, absent: 1, leave: 1, recorded: 4, denominator: 4, percentage: 50 });
  });
  it('can exclude leave from the denominator', () => {
    const s = summarizeAttendance(['PRESENT', 'ABSENT', 'LEAVE', 'LEAVE'], { leaveExcluded: true });
    expect(s).toMatchObject({ denominator: 2, percentage: 50, leave: 2, recorded: 4 });
    expect(summarizeAttendance(['LEAVE'], { leaveExcluded: true }).percentage).toBeNull();
  });
  it('flags low attendance only when a percentage exists', () => {
    expect(isLowAttendance(74.99)).toBe(true);
    expect(isLowAttendance(75)).toBe(false);
    expect(isLowAttendance(null)).toBe(false);
    expect(isLowAttendance(80, 85)).toBe(true);
  });
});

describe('buildMonthlyRegister', () => {
  const students = [
    { id: 's1', rollNumber: '1', admissionNumber: 'A1', name: 'One' },
    { id: 's2', rollNumber: '2', admissionNumber: 'A2', name: 'Two' },
  ];
  it('marks holidays H, leaves unrecorded days blank and computes working days', () => {
    const reg = buildMonthlyRegister({
      month: '2024-02',
      students,
      holidays: new Set(['2024-02-14']),
      weeklyOffDays: [0],
      records: [
        { student: 's1', date: '2024-02-01', status: 'PRESENT' },
        { student: 's1', date: '2024-02-02', status: 'ABSENT' },
        { student: 's1', date: '2024-02-29', status: 'LEAVE' },
        { student: 's2', date: '2024-02-01', status: 'PRESENT' },
        { student: 's2', date: '2024-02-02', status: 'PRESENT' },
      ],
    });
    expect(reg.days).toBe(29);
    expect(reg.rows[0]!.cells).toHaveLength(29);
    expect(reg.rows[0]!.cells[0]).toBe('P');
    expect(reg.rows[0]!.cells[1]).toBe('A');
    expect(reg.rows[0]!.cells[2]).toBe(''); // unrecorded, Saturday 3rd is a working day
    expect(reg.rows[0]!.cells[3]).toBe('H'); // Sunday 4th
    expect(reg.rows[0]!.cells[13]).toBe('H'); // declared holiday
    expect(reg.rows[0]!.cells[28]).toBe('L');
    expect(reg.workingDays).toBe(3); // 1st, 2nd and 29th recorded
    expect(reg.rows[0]!.summary).toMatchObject({ present: 1, absent: 1, leave: 1, percentage: 33.33 });
    expect(reg.rows[1]!.summary.percentage).toBe(100);
    expect(reg.totals).toEqual({ present: 3, absent: 1, leave: 1 });
  });
  it('does not count attendance recorded on a holiday as a working day', () => {
    const reg = buildMonthlyRegister({ month: '2025-02', students, holidays: new Set(['2025-02-03']), weeklyOffDays: [], records: [{ student: 's1', date: '2025-02-03', status: 'PRESENT' }] });
    expect(reg.workingDays).toBe(0);
    expect(reg.rows[0]!.summary.present).toBe(1);
    expect(reg.days).toBe(28);
  });
  it('monthly sums equal the cumulative summary', () => {
    const recs = [
      { student: 's1', date: '2025-01-10', status: 'PRESENT' as const },
      { student: 's1', date: '2025-02-10', status: 'ABSENT' as const },
      { student: 's1', date: '2025-02-11', status: 'PRESENT' as const },
    ];
    const months = ['2025-01', '2025-02'].map((month) => buildMonthlyRegister({ month, students, records: recs, holidays: new Set(), weeklyOffDays: [] }).rows[0]!.summary);
    const cumulative = summarizeAttendance(recs.map((r) => r.status));
    expect(months.reduce((a, s) => a + s.present, 0)).toBe(cumulative.present);
    expect(months.reduce((a, s) => a + s.absent, 0)).toBe(cumulative.absent);
  });
});
