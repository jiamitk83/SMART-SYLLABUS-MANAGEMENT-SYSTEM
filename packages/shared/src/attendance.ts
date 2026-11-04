export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LEAVE'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const REGISTER_STATES = ['DRAFT', 'SUBMITTED', 'UPDATED', 'LOCKED'] as const;
export type RegisterState = (typeof REGISTER_STATES)[number];

export const STATUS_CODE: Record<AttendanceStatus, string> = { PRESENT: 'P', ABSENT: 'A', LEAVE: 'L' };
export const ATTENDANCE_REASON_MIN_LENGTH = 5;
export const DEFAULT_LOW_THRESHOLD = 75;

export interface AttendanceSettings {
  lowThreshold: number;
  /** 0 = Sunday ... 6 = Saturday. Treated like holidays (no attendance, not a working day). */
  weeklyOffDays: number[];
  /** When true, Leave days are removed from the percentage denominator (excused). Default false. */
  leaveExcluded: boolean;
  schoolName: string;
  logoDataUrl: string;
}

export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings = {
  lowThreshold: DEFAULT_LOW_THRESHOLD,
  weeklyOffDays: [0],
  leaveExcluded: false,
  schoolName: 'School',
  logoDataUrl: '',
};

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function daysInMonth(year: number, month1to12: number): number {
  if (month1to12 === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month1to12) ? 30 : 31;
}

export function isValidDateString(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** All YYYY-MM-DD strings of a YYYY-MM month (28-31 entries). */
export function monthDates(month: string): string[] {
  if (!MONTH_RE.test(month)) throw new Error('Invalid month');
  const [y, m] = month.split('-').map(Number) as [number, number];
  return Array.from({ length: daysInMonth(y, m) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** Day of week (0 = Sunday) of a YYYY-MM-DD date, timezone independent. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isNonWorkingDay(date: string, holidays: ReadonlySet<string>, weeklyOffDays: readonly number[]): boolean {
  return holidays.has(date) || weeklyOffDays.includes(weekdayOf(date));
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Inclusive list of YYYY-MM months between two dates. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ey, em] = to.split('-').map(Number) as [number, number];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export interface AttendanceSummary {
  present: number;
  absent: number;
  leave: number;
  /** Days with a recorded status (present + absent + leave). Unrecorded days are never counted. */
  recorded: number;
  /** Denominator used for the percentage. */
  denominator: number;
  /** null when there is nothing to divide by (never NaN / Infinity). */
  percentage: number | null;
}

/**
 * Attendance % = present / denominator * 100, where denominator = present + absent + leave
 * (or present + absent when leaveExcluded). Holidays and unrecorded days never enter the count.
 */
export function summarizeAttendance(statuses: readonly AttendanceStatus[], opts: { leaveExcluded?: boolean } = {}): AttendanceSummary {
  let present = 0;
  let absent = 0;
  let leave = 0;
  for (const s of statuses) {
    if (s === 'PRESENT') present += 1;
    else if (s === 'ABSENT') absent += 1;
    else if (s === 'LEAVE') leave += 1;
  }
  const recorded = present + absent + leave;
  const denominator = opts.leaveExcluded ? present + absent : recorded;
  const percentage = denominator > 0 ? Math.round((present / denominator) * 10000) / 100 : null;
  return { present, absent, leave, recorded, denominator, percentage };
}

export const isLowAttendance = (percentage: number | null, threshold = DEFAULT_LOW_THRESHOLD): boolean => percentage !== null && percentage < threshold;

export interface MonthlyStudentInput {
  id: string;
  rollNumber: string;
  admissionNumber: string;
  name: string;
}
export interface MonthlyRecordInput {
  student: string;
  date: string;
  status: AttendanceStatus;
}
export interface MonthlyRow extends MonthlyStudentInput {
  /** Index 0 = day 1. 'P' | 'A' | 'L' | 'H' (holiday / weekly off) | '' (not recorded). */
  cells: string[];
  summary: AttendanceSummary;
}
export interface MonthlyRegister {
  month: string;
  days: number;
  dates: string[];
  holidayDates: string[];
  /** Days in the month that are working days AND have attendance recorded for this section. */
  workingDays: number;
  rows: MonthlyRow[];
  totals: { present: number; absent: number; leave: number };
}

export function buildMonthlyRegister(input: {
  month: string;
  students: readonly MonthlyStudentInput[];
  records: readonly MonthlyRecordInput[];
  holidays: ReadonlySet<string>;
  weeklyOffDays: readonly number[];
  leaveExcluded?: boolean;
}): MonthlyRegister {
  const dates = monthDates(input.month);
  const byStudent = new Map<string, Map<string, AttendanceStatus>>();
  const recordedDates = new Set<string>();
  for (const r of input.records) {
    if (!dates.includes(r.date)) continue;
    const m = byStudent.get(r.student) ?? new Map<string, AttendanceStatus>();
    m.set(r.date, r.status);
    byStudent.set(r.student, m);
    recordedDates.add(r.date);
  }
  const off = new Set(dates.filter((d) => isNonWorkingDay(d, input.holidays, input.weeklyOffDays)));
  const rows: MonthlyRow[] = input.students.map((s) => {
    const m = byStudent.get(s.id);
    const statuses: AttendanceStatus[] = [];
    const cells = dates.map((d) => {
      const st = m?.get(d);
      if (st) {
        statuses.push(st);
        return STATUS_CODE[st];
      }
      return off.has(d) ? 'H' : '';
    });
    return { ...s, cells, summary: summarizeAttendance(statuses, { leaveExcluded: input.leaveExcluded }) };
  });
  const totals = rows.reduce((a, r) => ({ present: a.present + r.summary.present, absent: a.absent + r.summary.absent, leave: a.leave + r.summary.leave }), { present: 0, absent: 0, leave: 0 });
  return {
    month: input.month,
    days: dates.length,
    dates,
    holidayDates: [...off],
    workingDays: [...recordedDates].filter((d) => !off.has(d)).length,
    rows,
    totals,
  };
}
