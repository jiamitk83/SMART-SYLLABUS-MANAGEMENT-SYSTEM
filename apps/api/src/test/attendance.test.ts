import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, auth, resetTestDb, tokenFor } from './helpers';

type Tok = { token: string; id: string };
const day = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** n-th most recent non-Sunday date strictly before today (local calendar is fine: the API compares to its own today). */
const workday = (n: number): string => {
  let d = new Date(Date.now() - day);
  let found = 0;
  for (;;) {
    if (d.getDay() !== 0) {
      found += 1;
      if (found === n) return iso(new Date(d.getTime() - d.getTimezoneOffset() * 60_000));
    }
    d = new Date(d.getTime() - day);
  }
};

describe('attendance module', () => {
  let admin: Tok, principal: Tok, coord: Tok, teacher: Tok, other: Tok;
  const ids = {} as { [K in 'session' | 'class' | 'sectionA' | 'sectionB' | 'subject']: string };
  let studentIds: string[] = [];
  const post = (t: Tok, url: string, body: object = {}) => request(app).post(`/api${url}`).set(auth(t.token)).send(body);
  const put = (t: Tok, url: string, body: object) => request(app).put(`/api${url}`).set(auth(t.token)).send(body);
  const patch = (t: Tok, url: string, body: object) => request(app).patch(`/api${url}`).set(auth(t.token)).send(body);
  const del = (t: Tok, url: string) => request(app).delete(`/api${url}`).set(auth(t.token));
  const get = (t: Tok, url: string) => request(app).get(`/api${url}`).set(auth(t.token));
  const mark = (t: Tok, date: string, statuses: Array<'PRESENT' | 'ABSENT' | 'LEAVE'>, extra: object = {}, section = ids.sectionA) =>
    put(t, '/attendance/mark', { section, date, entries: statuses.map((status, i) => ({ student: studentIds[i], status })), ...extra });

  beforeAll(async () => {
    await resetTestDb();
    admin = await tokenFor('SUPER_ADMIN', 'admin');
    principal = await tokenFor('PRINCIPAL', 'principal');
    coord = await tokenFor('ACADEMIC_COORDINATOR', 'coord');
    teacher = await tokenFor('TEACHER', 'teach1');
    other = await tokenFor('TEACHER', 'teach2');
    const now = Date.now();
    ids.session = (await post(admin, '/academic-sessions', { name: '2025-26', startDate: iso(new Date(now - 120 * day)), endDate: iso(new Date(now + 200 * day)) })).body.data._id;
    await post(admin, `/academic-sessions/${ids.session}/set-current`);
    ids.class = (await post(admin, '/classes', { name: 'Class 8' })).body.data._id;
    ids.sectionA = (await post(admin, '/sections', { class: ids.class, name: 'A' })).body.data._id;
    ids.sectionB = (await post(admin, '/sections', { class: ids.class, name: 'B' })).body.data._id;
    ids.subject = (await post(admin, '/subjects', { name: 'Maths', code: 'MATH' })).body.data._id;
    await post(admin, '/teacher-assignments', { section: ids.sectionA, subject: ids.subject, teacher: teacher.id });
  });

  it('student master CRUD, duplicate admission number and roll number are rejected', async () => {
    const mk = (n: number, section = ids.sectionA) => ({ section, rollNumber: String(n), admissionNumber: `ADM${section === ids.sectionA ? '' : 'B'}${n}`, name: `Student ${n}` });
    for (let i = 1; i <= 4; i++) expect((await post(admin, '/attendance/students', mk(i))).status).toBe(201);
    expect((await post(admin, '/attendance/students', mk(1))).status).toBe(409);
    expect((await post(admin, '/attendance/students', { ...mk(9), admissionNumber: 'ADM1' })).status).toBe(409);
    const bulk = await post(admin, '/attendance/students/bulk', { section: ids.sectionB, students: [mk(1, ids.sectionB), mk(2, ids.sectionB), mk(2, ids.sectionB)] });
    expect(bulk.body.data).toMatchObject({ created: 2 });
    expect(bulk.body.data.skipped).toHaveLength(1);
    const list = await get(admin, `/attendance/students?section=${ids.sectionA}`);
    studentIds = (list.body.data as Array<{ _id: string }>).map((s) => s._id);
    expect(studentIds).toHaveLength(4);
    expect((await patch(admin, `/attendance/students/${studentIds[3]}`, { name: 'Renamed' })).body.data.name).toBe('Renamed');
  });

  it('RBAC: only managers create students; coordinators are read-only; teachers cannot manage', async () => {
    const body = { section: ids.sectionA, rollNumber: '77', admissionNumber: 'X77', name: 'X' };
    expect((await post(teacher, '/attendance/students', body)).status).toBe(403);
    expect((await post(coord, '/attendance/students', body)).status).toBe(403);
    expect((await post(principal, '/attendance/students', body)).status).toBe(201);
    studentIds = ((await get(admin, `/attendance/students?section=${ids.sectionA}`)).body.data as Array<{ _id: string }>).map((s) => s._id);
    expect((await get(coord, `/attendance/sheet?section=${ids.sectionA}&date=${workday(1)}`)).status).toBe(200);
    expect((await mark(coord, workday(1), ['PRESENT'])).status).toBe(403);
    expect((await put(teacher, '/attendance/settings', {})).status).toBe(403);
  });

  it('teachers only see and mark assigned sections', async () => {
    const scope = await get(teacher, '/attendance/scope');
    expect(scope.body.data.sections.map((s: { id: string }) => s.id)).toEqual([ids.sectionA]);
    expect((await get(other, `/attendance/sheet?section=${ids.sectionA}&date=${workday(1)}`)).status).toBe(403);
    expect((await get(teacher, `/attendance/sheet?section=${ids.sectionB}&date=${workday(1)}`)).status).toBe(403);
    expect((await get(admin, '/attendance/scope')).body.data.sections).toHaveLength(2);
  });

  it('marks as draft, supports bulk marking, rejects duplicates, bad dates and unmarked submit', async () => {
    const d = workday(3);
    const first = await mark(teacher, d, ['PRESENT', 'ABSENT']);
    expect(first.status).toBe(200);
    expect(first.body.data.state).toBe('DRAFT');
    expect(first.body.data.summary).toMatchObject({ present: 1, absent: 1, unmarked: 3 });
    expect((await mark(teacher, d, ['PRESENT', 'ABSENT'], { submit: true })).status).toBe(400);
    const dup = await mark(teacher, d, ['PRESENT', 'ABSENT']);
    expect(dup.body.data).toMatchObject({ added: 0, changed: 0 });
    expect(await (await import('../models/attendance.models')).AttendanceRecordModel.countDocuments({ date: d, section: ids.sectionA })).toBe(2);
    expect((await mark(teacher, iso(new Date(Date.now() + 3 * day)), ['PRESENT'])).status).toBe(400);
    expect((await mark(teacher, iso(new Date(Date.now() - 900 * day)), ['PRESENT'])).status).toBe(400);
    expect((await mark(teacher, '2025-02-30', ['PRESENT'])).status).toBe(400);
    const wrongSection = await mark(admin, d, ['PRESENT'], {}, ids.sectionB);
    expect(wrongSection.status).toBe(400);
    const draftEdit = await mark(teacher, d, ['LEAVE']);
    expect(draftEdit.body.data).toMatchObject({ changed: 1 });
  });

  it('submit, then corrections need a reason, set UPDATED and keep full history', async () => {
    const d = workday(3);
    const submit = await mark(teacher, d, ['LEAVE', 'ABSENT', 'PRESENT', 'PRESENT', 'PRESENT'], { submit: true });
    expect(submit.status).toBe(200);
    expect(submit.body.data.state).toBe('SUBMITTED');
    const noReason = await mark(principal, d, ['PRESENT']);
    expect(noReason.status).toBe(400);
    const corrected = await mark(principal, d, ['PRESENT'], { reason: 'Parent confirmed presence' });
    expect(corrected.body.data.state).toBe('UPDATED');
    const history = (await get(admin, `/attendance/history?section=${ids.sectionA}&action=CORRECT`)).body.data as Array<Record<string, string>>;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ previousStatus: 'LEAVE', newStatus: 'PRESENT', reason: 'Parent confirmed presence', by: principal.id });
    expect(history[0]!.at).toBeTruthy();
    expect((await get(coord, `/attendance/history?section=${ids.sectionA}`)).status).toBe(200);
    expect((await get(other, `/attendance/history?section=${ids.sectionA}`)).status).toBe(403);
  });

  it('teachers cannot correct a submitted register on a past date', async () => {
    const res = await mark(teacher, workday(3), ['ABSENT'], { reason: 'Changed my mind' });
    expect(res.status).toBe(403);
  });

  it('lock blocks edits; unlock needs permission and a reason and is audited', async () => {
    const d = workday(3);
    expect((await post(teacher, '/attendance/registers/lock', { section: ids.sectionA, date: d })).status).toBe(403);
    expect((await post(principal, '/attendance/registers/lock', { section: ids.sectionA, date: d })).body.data.locked).toBe(1);
    expect((await mark(admin, d, ['ABSENT'], { reason: 'Trying while locked' })).status).toBe(409);
    expect((await post(principal, '/attendance/registers/unlock', { section: ids.sectionA, date: d })).status).toBe(400);
    expect((await post(coord, '/attendance/registers/unlock', { section: ids.sectionA, date: d, reason: 'Needs reopening' })).status).toBe(403);
    expect((await post(principal, '/attendance/registers/unlock', { section: ids.sectionA, date: d, reason: 'Needs reopening' })).body.data.unlocked).toBe(1);
    const actions = ((await get(admin, `/attendance/history?section=${ids.sectionA}&from=${d}&to=${d}`)).body.data as Array<{ action: string; reason?: string }>).map((h) => h.action);
    expect(actions).toEqual(expect.arrayContaining(['LOCK', 'UNLOCK', 'SUBMIT', 'CORRECT']));
    expect((await mark(admin, d, ['PRESENT'], { reason: 'After reopening ok' })).status).toBe(200);
  });

  it('holidays: create, duplicate, calendar effect, block marking, protect recorded dates, edit and delete', async () => {
    const hDate = workday(6);
    expect((await post(teacher, '/attendance/holidays', { date: hDate, name: 'X' })).status).toBe(403);
    const created = await post(principal, '/attendance/holidays', { date: hDate, name: 'Founders Day' });
    expect(created.status).toBe(201);
    expect((await post(principal, '/attendance/holidays', { date: hDate, name: 'Dup' })).status).toBe(409);
    expect((await post(principal, '/attendance/holidays', { date: workday(3), name: 'Recorded' })).status).toBe(409);
    expect((await mark(teacher, hDate, ['PRESENT'])).status).toBe(400);
    expect((await patch(principal, `/attendance/holidays/${created.body.data._id}`, { name: 'Founders Day 2' })).body.data.name).toBe('Founders Day 2');
    const monthly = (await get(admin, `/attendance/monthly?section=${ids.sectionA}&month=${hDate.slice(0, 7)}`)).body.data;
    expect(monthly.holidayDates).toContain(hDate);
    expect(monthly.rows[0].cells[Number(hDate.slice(8)) - 1]).toBe('H');
    expect((await get(coord, '/attendance/holidays')).body.data).toHaveLength(1);
    expect((await del(principal, `/attendance/holidays/${created.body.data._id}`)).status).toBe(200);
  });

  it('monthly register: statuses, totals, working days, percentage, unrecorded blank', async () => {
    const d = workday(3);
    const m = (await get(admin, `/attendance/monthly?section=${ids.sectionA}&month=${d.slice(0, 7)}`)).body.data;
    const idx = Number(d.slice(8)) - 1;
    expect(m.days).toBe(m.dates.length);
    expect(m.rows).toHaveLength(5);
    const cells = m.rows.map((r: { cells: string[] }) => r.cells[idx]);
    expect(cells.filter((c: string) => c === 'P').length).toBe(4);
    expect(m.workingDays).toBeGreaterThanOrEqual(1);
    const row = m.rows.find((r: { cells: string[] }) => r.cells[idx] === 'P');
    expect(row.summary.percentage).toBe(100);
    const blank = m.rows[0].cells.filter((c: string) => c === '').length;
    expect(blank).toBeGreaterThan(0);
  });

  it('student, class and dashboard views are consistent with the daily records', async () => {
    const student = (await get(admin, `/attendance/student/${studentIds[1]}`)).body.data;
    expect(student.summary).toMatchObject({ absent: 1, recorded: 1, percentage: 0 });
    expect(student.lowAttendance).toBe(true);
    const cls = (await get(admin, `/attendance/class?class=${ids.class}`)).body.data;
    const a = cls.rows.find((x: { label: string }) => x.label.endsWith('-A'));
    expect(a).toMatchObject({ present: 4, absent: 1, leave: 0 });
    expect(a.lowAttendanceStudents).toBe(1);
    expect((await get(other, `/attendance/student/${studentIds[1]}`)).status).toBe(403);
    const dash = (await get(teacher, `/attendance/dashboard?date=${workday(3)}`)).body.data;
    expect(dash.sections).toHaveLength(1);
    expect(dash.totals).toMatchObject({ present: 4, absent: 1 });
  });

  it('settings: leave exclusion changes the denominator; teachers cannot change settings; logo validated', async () => {
    const cur = (await get(admin, '/attendance/settings')).body.data;
    expect(cur.lowThreshold).toBe(75);
    expect((await put(admin, '/attendance/settings', { ...cur, logoDataUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await put(admin, '/attendance/settings', { ...cur, lowThreshold: 60, leaveExcluded: true })).status).toBe(200);
    expect((await get(teacher, '/attendance/settings')).body.data.leaveExcluded).toBe(true);
    await put(admin, '/attendance/settings', { ...cur });
  });

  it('students keep history after transfer and deactivation', async () => {
    const d = workday(2);
    await mark(admin, d, ['PRESENT', 'PRESENT', 'PRESENT', 'PRESENT']);
    expect((await patch(admin, `/attendance/students/${studentIds[0]}`, { section: ids.sectionB, rollNumber: '50' })).status).toBe(200);
    const sheetA = (await get(admin, `/attendance/sheet?section=${ids.sectionA}&date=${d}`)).body.data;
    expect(sheetA.students.map((s: { id: string }) => s.id)).toContain(studentIds[0]);
    const old = (await get(admin, `/attendance/student/${studentIds[0]}`)).body.data;
    expect(old.records.some((r: { date: string }) => r.date === d)).toBe(true);
    expect((await patch(admin, `/attendance/students/${studentIds[1]}`, { isActive: false })).status).toBe(200);
    const sheet2 = (await get(admin, `/attendance/sheet?section=${ids.sectionA}&date=${workday(1)}`)).body.data;
    expect(sheet2.students.map((s: { id: string }) => s.id)).not.toContain(studentIds[1]);
  });

  it('unauthenticated requests are rejected', async () => {
    expect((await request(app).get('/api/attendance/dashboard')).status).toBe(401);
  });
});
