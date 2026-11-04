import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, auth, resetTestDb, tokenFor } from './helpers';

type Tok = { token: string; id: string };
const day = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const localIso = (d: Date) => iso(new Date(d.getTime() - d.getTimezoneOffset() * 60_000));
const workday = (n: number): string => {
  let d = new Date(Date.now() - day);
  let found = 0;
  for (;;) {
    if (d.getDay() !== 0) {
      found += 1;
      if (found === n) return localIso(d);
    }
    d = new Date(d.getTime() - day);
  }
};
const binary = (res: request.Response) => res.body as Buffer;
const pdfPages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

describe('attendance reports and exports', () => {
  let admin: Tok, coord: Tok, teacher: Tok, other: Tok;
  const ids = {} as { [K in 'session' | 'class' | 'sec' | 'big' | 'small' | 'subject']: string };
  let students: string[] = [];
  const post = (t: Tok, url: string, body: object = {}) => request(app).post(`/api${url}`).set(auth(t.token)).send(body);
  const put = (t: Tok, url: string, body: object) => request(app).put(`/api${url}`).set(auth(t.token)).send(body);
  const get = (t: Tok, url: string) => request(app).get(`/api${url}`).set(auth(t.token));
  const download = (t: Tok, url: string) =>
    request(app).get(`/api${url}`).set(auth(t.token)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  const roster = (n: number, section: string, prefix: string, offset = 0) => Array.from({ length: n }, (_, i) => ({ rollNumber: String(i + 1 + offset), admissionNumber: `${prefix}${i + 1}`, name: i === 0 && prefix === 'S' ? '=HYPERLINK("x")' : `${prefix} Student ${i + 1}` })).map((s) => ({ ...s, section }));

  beforeAll(async () => {
    await resetTestDb();
    admin = await tokenFor('SUPER_ADMIN', 'admin');
    coord = await tokenFor('ACADEMIC_COORDINATOR', 'coord');
    teacher = await tokenFor('TEACHER', 'teach1');
    other = await tokenFor('TEACHER', 'teach2');
    const now = Date.now();
    ids.session = (await post(admin, '/academic-sessions', { name: '2025-26', startDate: iso(new Date(now - 90 * day)), endDate: iso(new Date(now + 250 * day)) })).body.data._id;
    await post(admin, `/academic-sessions/${ids.session}/set-current`);
    ids.class = (await post(admin, '/classes', { name: 'Class 6' })).body.data._id;
    ids.small = (await post(admin, '/sections', { class: ids.class, name: 'A' })).body.data._id;
    ids.big = (await post(admin, '/sections', { class: ids.class, name: 'B' })).body.data._id;
    ids.subject = (await post(admin, '/subjects', { name: 'Maths', code: 'MATH' })).body.data._id;
    await post(admin, '/teacher-assignments', { section: ids.small, subject: ids.subject, teacher: teacher.id });
    await post(admin, '/attendance/students/bulk', { section: ids.small, students: roster(5, ids.small, 'S').map(({ section: _s, ...r }) => r) });
    for (const chunk of [0, 1]) await post(admin, '/attendance/students/bulk', { section: ids.big, students: roster(24, ids.big, `B${chunk}-`, chunk * 24).map(({ section: _s, ...r }) => r) });
    students = ((await get(admin, `/attendance/students?section=${ids.small}`)).body.data as Array<{ _id: string }>).map((s) => s._id);
    const mark = (d: string, statuses: string[]) => put(teacher, '/attendance/mark', { section: ids.small, date: d, entries: statuses.map((status, i) => ({ student: students[i], status })), submit: true });
    expect((await mark(workday(4), ['PRESENT', 'PRESENT', 'ABSENT', 'LEAVE', 'PRESENT'])).status).toBe(200);
    expect((await mark(workday(3), ['PRESENT', 'ABSENT', 'ABSENT', 'PRESENT', 'PRESENT'])).status).toBe(200);
    expect((await mark(workday(2), ['PRESENT', 'PRESENT', 'ABSENT', 'LEAVE', 'PRESENT'])).status).toBe(200);
  });

  it('monthly report JSON has correct per-student counts and percentages', async () => {
    const d = workday(3);
    const res = await get(teacher, `/attendance/reports/monthly?section=${ids.small}&month=${d.slice(0, 7)}`);
    expect(res.status).toBe(200);
    const row = (res.body.data.rows as Array<Array<string | number>>).find((r) => r[1] === '1' || r[0] === '1')!;
    const inMonth = [workday(4), workday(3), workday(2)].filter((x) => x.startsWith(d.slice(0, 7))).length;
    expect(row.slice(3, 8)).toEqual([inMonth, 0, 0, inMonth, '100%']);
  });

  it('percentage denominator includes Leave by default; student 4 has 1 present of 3 recorded', async () => {
    const res = await get(admin, `/attendance/reports/cumulative?section=${ids.small}`);
    const rows = res.body.data.rows as Array<Array<string | number>>;
    const s4 = rows.find((r) => r[2] === 'S4')!;
    expect(s4.slice(4, 9)).toEqual([1, 0, 2, 3, '33.33%']);
    const s3 = rows.find((r) => r[2] === 'S3')!;
    expect(s3.slice(4, 9)).toEqual([0, 3, 0, 3, '0%']);
  });

  it('low-attendance, class, annual and student reports', async () => {
    const low = await get(admin, `/attendance/reports/low?section=${ids.small}`);
    const names = (low.body.data.rows as string[][]).map((r) => r[2]);
    expect(names).toEqual(expect.arrayContaining(['S3', 'S4']));
    expect(names).not.toContain('S1');
    const cls = await get(coord, `/attendance/reports/class?class=${ids.class}`);
    expect(cls.status).toBe(200);
    expect(cls.body.data.rows).toHaveLength(2);
    const annual = await get(admin, `/attendance/reports/annual?section=${ids.small}`);
    expect(annual.body.data.columns.at(-1)).toBe('Annual %');
    const st = await get(admin, `/attendance/reports/student?student=${students[0]}`);
    expect(st.body.data.rows.at(-1)).toEqual(['Total', 3, 0, 0, 3, '100%']);
  });

  it('exports xlsx, csv (with formula guard) and generic pdf', async () => {
    const d = workday(3).slice(0, 7);
    const xlsx = await download(admin, `/attendance/reports/monthly?section=${ids.small}&month=${d}&format=xlsx`);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(binary(xlsx).subarray(0, 2).toString()).toBe('PK');
    const csv = await download(admin, `/attendance/reports/monthly?section=${ids.small}&month=${d}&format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    const text = binary(csv).toString('utf8');
    expect(text).toContain('"Admission No"');
    expect(text).toContain(`"'=HYPERLINK`);
    const pdf = await download(admin, `/attendance/reports/cumulative?section=${ids.small}&format=pdf`);
    expect(binary(pdf).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('register PDF is landscape, paginated and complete for 5, 22 and 48 students', async () => {
    const d = workday(3).slice(0, 7);
    const small = binary(await download(admin, `/attendance/reports/register?section=${ids.small}&month=${d}&format=pdf`));
    expect(small.subarray(0, 4).toString()).toBe('%PDF');
    expect(small.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89\d* 595\.28\d*\]/);
    expect(pdfPages(small)).toBe(1);
    const big = binary(await download(admin, `/attendance/reports/register?section=${ids.big}&month=${d}&format=pdf`));
    expect(pdfPages(big)).toBe(3);
    const registerJson = await get(admin, `/attendance/reports/register?section=${ids.small}&month=${d}`);
    expect(registerJson.body.data.columns.filter((c: string) => /^\d+$/.test(c)).length).toBeGreaterThanOrEqual(28);
  });

  it('leap-year February has 29 columns and non-leap 28', async () => {
    const leap = await get(admin, `/attendance/reports/register?section=${ids.small}&month=2024-02`);
    expect(leap.body.data.columns.filter((c: string) => /^\d+$/.test(c))).toHaveLength(29);
    const plain = await get(admin, `/attendance/reports/register?section=${ids.small}&month=2025-02`);
    expect(plain.body.data.columns.filter((c: string) => /^\d+$/.test(c))).toHaveLength(28);
  });

  it('reports enforce RBAC and validation', async () => {
    expect((await get(other, `/attendance/reports/monthly?section=${ids.small}&month=${workday(3).slice(0, 7)}`)).status).toBe(403);
    expect((await get(teacher, `/attendance/reports/monthly?section=${ids.big}&month=${workday(3).slice(0, 7)}`)).status).toBe(403);
    expect((await get(admin, `/attendance/reports/monthly?section=${ids.small}`)).status).toBe(400);
    expect((await get(admin, '/attendance/reports/bogus')).status).toBeGreaterThanOrEqual(400);
    expect((await request(app).get('/api/attendance/reports/class')).status).toBe(401);
  });
});
