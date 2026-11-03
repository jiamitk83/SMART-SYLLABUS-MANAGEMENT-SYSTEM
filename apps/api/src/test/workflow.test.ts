import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, auth, resetTestDb, tokenFor } from './helpers';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = 86_400_000;

describe('syllabus workflow and authorization', () => {
  let admin: { token: string; id: string };
  let coord: { token: string; id: string };
  let principal: { token: string; id: string };
  let teacher: { token: string; id: string };
  let other: { token: string; id: string };
  let ids: Record<string, string> = {};

  const post = (token: string, url: string, body: object) => request(app).post(`/api${url}`).set(auth(token)).send(body);
  const get = (token: string, url: string) => request(app).get(`/api${url}`).set(auth(token));

  beforeAll(async () => {
    await resetTestDb();
    admin = await tokenFor('SUPER_ADMIN', 'admin');
    coord = await tokenFor('ACADEMIC_COORDINATOR', 'coord');
    principal = await tokenFor('PRINCIPAL', 'princ');
    teacher = await tokenFor('TEACHER', 'teach1');
    other = await tokenFor('TEACHER', 'teach2');
  });

  it('sets up the academic structure', async () => {
    const now = Date.now();
    const s = await post(admin.token, '/academic-sessions', { name: '2025-26', startDate: iso(new Date(now - 60 * day)), endDate: iso(new Date(now + 300 * day)) });
    expect(s.status).toBe(201);
    ids.session = s.body.data._id;
    expect((await post(admin.token, `/academic-sessions/${ids.session}/set-current`, {})).status).toBe(200);

    const c = await post(admin.token, '/classes', { name: 'Class 8' });
    expect(c.status).toBe(201);
    ids.class = c.body.data._id;
    ids.section = (await post(admin.token, '/sections', { class: ids.class, name: 'A' })).body.data._id;
    ids.subject = (await post(admin.token, '/subjects', { name: 'Mathematics', code: 'MATH' })).body.data._id;
    expect((await post(admin.token, '/subjects', { name: 'Mathematics 2', code: 'MATH' })).status).toBe(409);

    const a = await post(admin.token, '/teacher-assignments', { section: ids.section, subject: ids.subject, teacher: teacher.id });
    expect(a.status).toBe(201);
  });

  it('enforces role permissions', async () => {
    expect((await post(teacher.token, '/classes', { name: 'X' })).status).toBe(403);
    expect((await get(teacher.token, '/users')).status).toBe(403);
    expect((await get(coord.token, '/audit-logs')).status).toBe(403);
    expect((await get(principal.token, '/audit-logs')).status).toBe(200);
    expect((await post(principal.token, '/classes', { name: 'X' })).status).toBe(403);
    expect((await get(admin.token, '/users')).status).toBe(200);
  });

  it('validates input', async () => {
    expect((await post(admin.token, '/classes', {})).status).toBe(400);
    expect((await post(admin.token, '/sections', { class: 'not-an-id', name: 'B' })).status).toBe(400);
  });

  it('builds the syllabus and plans it', async () => {
    const ch = await post(coord.token, '/chapters', { class: ids.class, subject: ids.subject, title: 'Algebra', estimatedPeriods: 10 });
    expect(ch.status).toBe(201);
    ids.chapter = ch.body.data._id;
    ids.topic = (await post(coord.token, '/topics', { chapter: ids.chapter, title: 'Linear equations', estimatedPeriods: 4 })).body.data._id;
    ids.topic2 = (await post(coord.token, '/topics', { chapter: ids.chapter, title: 'Quadratics', estimatedPeriods: 4 })).body.data._id;
    expect((await post(teacher.token, '/chapters', { class: ids.class, subject: ids.subject, title: 'Nope' })).status).toBe(403);

    const now = Date.now();
    const plan = await post(coord.token, '/plans', { chapter: ids.chapter, level: 'ANNUAL', startDate: iso(new Date(now - 30 * day)), endDate: iso(new Date(now - 1 * day)) });
    expect(plan.status).toBe(201);
    ids.plan = plan.body.data._id;
    expect((await post(coord.token, '/plans', { chapter: ids.chapter, level: 'ANNUAL', startDate: iso(new Date(now - 10 * day)), endDate: iso(new Date(now + 5 * day)) })).status).toBe(409);
    expect((await post(coord.token, '/plans', { chapter: ids.chapter, level: 'WEEKLY', startDate: iso(new Date(now + 5 * day)), endDate: iso(new Date(now + 1 * day)) })).status).toBe(400);
    expect((await post(coord.token, `/plans/${ids.plan}/reschedule`, { startDate: iso(new Date(now - 30 * day)), endDate: iso(new Date(now + 2 * day)), reason: 'Holiday' })).status).toBe(200);
    expect((await post(coord.token, `/plans/${ids.plan}/reschedule`, { startDate: iso(new Date(now - 30 * day)), endDate: iso(new Date(now - 1 * day)) })).status).toBe(400);
  });

  it('records daily teaching only for assigned teachers', async () => {
    const body = { date: iso(new Date(Date.now() - 2 * day)), section: ids.section, subject: ids.subject, chapter: ids.chapter, topic: ids.topic, periodNumber: 1, teachingStatus: 'COMPLETED', submit: true };
    expect((await post(other.token, '/teaching-records', body)).status).toBe(403);
    const ok = await post(teacher.token, '/teaching-records', body);
    expect(ok.status).toBe(201);
    expect((await post(teacher.token, '/teaching-records', body)).status).toBe(409);
    const future = await post(teacher.token, '/teaching-records', { ...body, date: iso(new Date(Date.now() + 5 * day)), periodNumber: 2 });
    expect(future.status).toBe(400);
    expect((await get(other.token, '/teaching-records')).body.data).toHaveLength(0);
    expect((await get(teacher.token, '/teaching-records')).body.data).toHaveLength(1);
  });

  it('computes progress and supports the completion approval flow', async () => {
    let sum = await get(teacher.token, '/progress/summary');
    expect(sum.status).toBe(200);
    const before = sum.body.overall.actual as number;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(100);

    expect((await post(teacher.token, '/chapter-completions', { section: ids.section, chapter: ids.chapter })).status).toBe(201);
    const list = await get(coord.token, '/chapter-completions');
    const rec = list.body.data[0];
    expect(rec.status).toBe('PENDING_APPROVAL');
    expect((await post(teacher.token, `/chapter-completions/${rec._id}/approve`, {})).status).toBe(403);
    expect((await post(coord.token, `/chapter-completions/${rec._id}/approve`, {})).status).toBe(200);
    sum = await get(coord.token, '/progress/summary');
    expect(sum.body.overall.completedChapters).toBe(1);
    expect((await post(coord.token, `/chapter-completions/${rec._id}/reopen`, {})).status).toBe(200);
    sum = await get(coord.token, '/progress/summary');
    expect(sum.body.overall.completedChapters).toBe(0);
  });

  it('updates weights only when they total 100', async () => {
    const put = (body: object) => request(app).put('/api/settings/activity-weights').set(auth(admin.token)).send(body);
    expect((await put({ TEACHING: 50 })).status).toBe(400);
    expect((await get(teacher.token, '/settings/activity-weights')).status).toBe(200);
  });

  it('records a conducted worksheet as 100% worksheet activity', async () => {
    const a = await post(teacher.token, '/assessments', {
      type: 'WORKSHEET', title: 'WS 1', section: ids.section, subject: ids.subject, chapters: [ids.chapter], date: iso(new Date()), maxMarks: 20, passMarks: 8,
    });
    expect(a.status).toBe(201);
    const res = await request(app).put(`/api/assessments/${a.body.data._id}/results`).set(auth(teacher.token)).send({
      results: [{ rollNo: '1', studentName: 'A', marksObtained: 18 }, { rollNo: '2', studentName: 'B', marksObtained: 5 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.summary.passPercent).toBe(50);
    const acts = await get(teacher.token, `/activities?section=${ids.section}&chapter=${ids.chapter}`);
    expect(acts.body.data.some((x: { activityType: string; percent: number }) => x.activityType === 'WORKSHEET' && x.percent === 100)).toBe(true);
  });

  it('serves dashboards, notifications and reports', async () => {
    for (const t of [admin, principal, coord, teacher]) expect((await get(t.token, '/dashboard')).status).toBe(200);
    expect((await post(admin.token, '/notifications/generate', {})).status).toBe(200);
    const n = await get(coord.token, '/notifications');
    expect(n.status).toBe(200);
    for (const k of ['daily-teaching', 'teacher-wise', 'class-wise', 'subject-wise', 'chapter-completion', 'pending', 'delayed', 'annual']) {
      expect((await get(coord.token, `/reports/${k}`)).status, k).toBe(200);
    }
    expect((await get(coord.token, '/reports/monthly')).status).toBe(400);
    expect((await get(coord.token, '/reports/monthly?month=2025-01')).status).toBe(200);
    const pdf = await get(coord.token, '/reports/class-wise?format=pdf').buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const xlsx = await get(coord.token, '/reports/class-wise?format=xlsx').buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect((await get(coord.token, '/reports/bogus')).status).toBe(400);
  });

  it('prevents removing the last super admin and self-deactivation', async () => {
    const r = await request(app).patch(`/api/users/${admin.id}/active`).set(auth(admin.token)).send({ isActive: false });
    expect([400, 403, 409]).toContain(r.status);
  });
});
