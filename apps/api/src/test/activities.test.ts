import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '@ssms/shared';
import { AuditLogModel } from '../models/auth.models';
import { ActivityModel } from '../models/planning.models';
import { app, auth, resetTestDb, tokenFor } from './helpers';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = 86_400_000;

type Tok = { token: string; id: string };

describe('activity status corrections', () => {
  let admin: Tok, coord: Tok, principal: Tok, teacher: Tok, other: Tok;
  const ids: Record<string, string> = {};

  const post = (t: Tok, url: string, body: object) => request(app).post(`/api${url}`).set(auth(t.token)).send(body);
  const get = (t: Tok, url: string) => request(app).get(`/api${url}`).set(auth(t.token));
  const put = (t: Tok, url: string, body: object) => request(app).put(`/api${url}`).set(auth(t.token)).send(body);
  const correct = (t: Tok, activityType: string, status: string, extra: Record<string, unknown> = {}) =>
    put(t, '/activities', { section: ids.section, chapter: ids.chapter, activityType, status, reason: 'Corrected after review', ...extra });
  const unit = async () => (await get(admin, `/progress/chapters?section=${ids.section}`)).body.data[0] as { progress: number; teachingPercent: number };
  const history = async (type: string) =>
    ((await get(coord, `/activities/history?section=${ids.section}&chapter=${ids.chapter}`)).body.data as Array<Record<string, any>>).filter((h) => h.activityType === type);

  beforeAll(async () => {
    await resetTestDb();
    admin = await tokenFor('SUPER_ADMIN', 'admin');
    coord = await tokenFor('ACADEMIC_COORDINATOR', 'coord');
    principal = await tokenFor('PRINCIPAL', 'princ');
    teacher = await tokenFor('TEACHER', 'teach1');
    other = await tokenFor('TEACHER', 'teach2');

    const now = Date.now();
    ids.session = (await post(admin, '/academic-sessions', { name: '2025-26', startDate: iso(new Date(now - 60 * day)), endDate: iso(new Date(now + 300 * day)) })).body.data._id;
    await post(admin, `/academic-sessions/${ids.session}/set-current`, {});
    ids.class = (await post(admin, '/classes', { name: 'Class 8' })).body.data._id;
    ids.section = (await post(admin, '/sections', { class: ids.class, name: 'A' })).body.data._id;
    ids.subject = (await post(admin, '/subjects', { name: 'Mathematics', code: 'MATH' })).body.data._id;
    await post(admin, '/teacher-assignments', { section: ids.section, subject: ids.subject, teacher: teacher.id });
    ids.chapter = (await post(coord, '/chapters', { class: ids.class, subject: ids.subject, title: 'Algebra', estimatedPeriods: 8 })).body.data._id;
    ids.topic = (await post(coord, '/topics', { chapter: ids.chapter, title: 'Linear', estimatedPeriods: 4 })).body.data._id;
    await post(coord, '/topics', { chapter: ids.chapter, title: 'Quadratics', estimatedPeriods: 4 });
    // One of two equal topics completed -> teaching = 50%.
    const rec = await post(teacher, '/teaching-records', { date: iso(new Date(now - 2 * day)), section: ids.section, subject: ids.subject, chapter: ids.chapter, topic: ids.topic, periodNumber: 1, teachingStatus: 'COMPLETED', submit: true });
    expect(rec.status).toBe(201);
    ids.record = rec.body.data._id;
  });

  it('grants activities:manage by default to every role', () => {
    for (const r of ['SUPER_ADMIN', 'PRINCIPAL', 'ACADEMIC_COORDINATOR', 'TEACHER'] as const) expect(ROLE_PERMISSIONS[r]).toContain('activities:manage');
  });

  it('keeps the baseline calculation: teaching 50% weighted with pending activities', async () => {
    const u = await unit();
    expect(u.teachingPercent).toBe(50);
    expect(u.progress).toBe(20); // 40 * 50 / 100
  });

  it('allows admin, principal and coordinator across all classes, teachers only when assigned', async () => {
    expect((await correct(admin, 'NOTEBOOK_WORK', 'COMPLETED')).status).toBe(200);
    expect((await correct(principal, 'NOTEBOOK_WORK', 'PENDING')).status).toBe(200);
    expect((await correct(coord, 'NOTEBOOK_WORK', 'COMPLETED')).status).toBe(200);
    expect((await correct(teacher, 'NOTEBOOK_WORK', 'PENDING')).status).toBe(200);
    expect((await correct(other, 'NOTEBOOK_WORK', 'COMPLETED')).status).toBe(403);
    expect((await get(other, `/activities/history?section=${ids.section}&chapter=${ids.chapter}`)).status).toBe(403);
    expect((await get(teacher, `/activities/history?section=${ids.section}&chapter=${ids.chapter}`)).status).toBe(200);
  });

  it('is enforced by activities:manage, not teaching:write', async () => {
    const tp = ROLE_PERMISSIONS.TEACHER.filter((p) => p !== 'activities:manage');
    expect(tp).toContain('teaching:write');
    expect((await request(app).patch('/api/roles/TEACHER').set(auth(admin.token)).send({ permissions: tp })).status).toBe(200);
    expect((await correct(teacher, 'REVISION', 'COMPLETED')).status).toBe(403);
    expect((await request(app).patch('/api/roles/TEACHER').set(auth(admin.token)).send({ permissions: [...ROLE_PERMISSIONS.TEACHER] })).status).toBe(200);
    expect((await correct(teacher, 'REVISION', 'COMPLETED')).status).toBe(200);

    const pp = ROLE_PERMISSIONS.PRINCIPAL.filter((p) => p !== 'activities:manage');
    await request(app).patch('/api/roles/PRINCIPAL').set(auth(admin.token)).send({ permissions: [...pp, 'teaching:write'] });
    expect((await correct(principal, 'REVISION', 'PENDING')).status).toBe(403);
    await request(app).patch('/api/roles/PRINCIPAL').set(auth(admin.token)).send({ permissions: [...ROLE_PERMISSIONS.PRINCIPAL] });
    expect((await correct(principal, 'REVISION', 'PENDING')).status).toBe(200);
  });

  it('requires a valid status and reason, rejects no-op and derived TEACHING corrections', async () => {
    expect((await put(admin, '/activities', { section: ids.section, chapter: ids.chapter, activityType: 'TEST', status: 'COMPLETED' })).status).toBe(400);
    expect((await correct(admin, 'TEST', 'COMPLETED', { reason: '  ab ' })).status).toBe(400);
    expect((await correct(admin, 'TEST', 'PARTIAL')).status).toBe(400);
    expect((await put(admin, '/activities', { section: ids.section, chapter: ids.chapter, activityType: 'TEST', percent: 50, reason: 'Corrected after review' })).status).toBe(400);
    expect((await correct(admin, 'NOTEBOOK_WORK', 'COMPLETED')).status).toBe(200);
    expect((await correct(admin, 'NOTEBOOK_WORK', 'COMPLETED')).status).toBe(400);
    expect((await correct(admin, 'TEACHING', 'COMPLETED')).status).toBe(400);
  });

  it('stores previous and new status/value, context, user, time and reason for every correction', async () => {
    const nb = await history('NOTEBOOK_WORK');
    const chain = [...nb].reverse().map((h) => [h.previousStatus, h.status]);
    expect(chain).toEqual([['PENDING', 'COMPLETED'], ['COMPLETED', 'PENDING'], ['PENDING', 'COMPLETED'], ['COMPLETED', 'PENDING'], ['PENDING', 'COMPLETED']]);
    expect([...nb].reverse().map((h) => [h.previousPercent, h.percent])[0]).toEqual([0, 100]);
    expect(nb[0]).toMatchObject({ kind: 'CORRECTION', activityType: 'NOTEBOOK_WORK', class: ids.class, section: ids.section, subject: ids.subject, chapter: ids.chapter, reason: 'Corrected after review', previousApplicable: true, applicable: true });
    expect(nb[0]!.by.fullName).toBeTruthy();
    expect(new Date(nb[0]!.at).getTime()).toBeGreaterThan(0);

    const logs = await AuditLogModel.find({ action: 'ACTIVITY_CORRECTED' }).lean();
    expect(logs.length).toBeGreaterThanOrEqual(5);
    expect(logs.at(-1)!.details).toMatchObject({ activityType: 'NOTEBOOK_WORK', previous: { percent: 0, status: 'PENDING' }, next: { percent: 100, status: 'COMPLETED' }, reason: 'Corrected after review' });
  });

  it('calculates progress accurately for Completed, Pending and N/A', async () => {
    // teaching 50 (w40) + notebook work completed (w15); everything else pending -> 3500 / 100
    expect((await unit()).progress).toBe(35);
    expect((await correct(admin, 'TEST', 'NOT_APPLICABLE', { reason: 'No test for this chapter' })).status).toBe(200);
    expect((await correct(admin, 'REVISION', 'NOT_APPLICABLE', { reason: 'No revision planned' })).status).toBe(200);
    // applicable weights 40+15+15+10 = 80 -> 3500 / 80
    expect((await unit()).progress).toBeCloseTo(43.75, 2);
    const t = await ActivityModel.findOne({ section: ids.section, chapter: ids.chapter, activityType: 'TEST' }).lean();
    expect(t).toMatchObject({ applicable: false, percent: 0 });
    expect(t!.history.at(-1)).toMatchObject({ previousStatus: 'PENDING', status: 'NOT_APPLICABLE' });
  });

  it('never lets Worksheet/Test synchronization overwrite a correction or existing record', async () => {
    const assess = async (title: string) => {
      const a = await post(teacher, '/assessments', { type: 'WORKSHEET', title, section: ids.section, subject: ids.subject, chapters: [ids.chapter], date: iso(new Date()), maxMarks: 10, passMarks: 4 });
      expect(a.status).toBe(201);
      return put(teacher, `/assessments/${a.body.data._id}/results`, { results: [{ rollNo: '1', studentName: 'A', marksObtained: 9 }] });
    };
    expect((await assess('WS 1')).status).toBe(200);
    let ws = await ActivityModel.findOne({ section: ids.section, chapter: ids.chapter, activityType: 'WORKSHEET' }).lean();
    expect(ws).toMatchObject({ percent: 100, applicable: true, source: 'ASSESSMENT' });
    expect(ws!.history[0]).toMatchObject({ kind: 'ASSESSMENT_SYNC', percent: 100 });

    expect((await correct(coord, 'WORKSHEET', 'PENDING', { reason: 'Worksheet not actually completed' })).status).toBe(200);
    expect((await assess('WS 2')).status).toBe(200);
    ws = await ActivityModel.findOne({ section: ids.section, chapter: ids.chapter, activityType: 'WORKSHEET' }).lean();
    expect(ws).toMatchObject({ percent: 0, source: 'MANUAL' });
    expect(ws!.history).toHaveLength(2); // sync entry preserved + correction
    expect(ws!.history[1]).toMatchObject({ previousPercent: 100, previousStatus: 'COMPLETED', percent: 0, status: 'PENDING', reason: 'Worksheet not actually completed' });
  });

  it('keeps legacy partial percentages intact, counted as stored, and records them as previous values', async () => {
    const sec = await import('../models/academic.models').then((m) => m.SectionModel.findById(ids.section).lean());
    await ActivityModel.findOneAndUpdate(
      { section: ids.section, chapter: ids.chapter, activityType: 'NOTEBOOK_CORRECTION' },
      { $set: { academicSession: sec!.academicSession, class: sec!.class, subject: ids.subject, applicable: true, percent: 60 } },
      { upsert: true },
    );
    // weights 40+15+15+10 = 80 -> (2000 + 1500 + 900 + 0) / 80
    expect((await unit()).progress).toBe(55);
    // Unrelated corrections never touch it.
    expect((await correct(admin, 'WORKSHEET', 'COMPLETED')).status).toBe(200);
    expect((await ActivityModel.findOne({ section: ids.section, activityType: 'NOTEBOOK_CORRECTION' }).lean())!.percent).toBe(60);
    // Setting Pending is an explicit change recorded with the partial value as previous.
    expect((await correct(admin, 'NOTEBOOK_CORRECTION', 'PENDING', { reason: 'Partial work reset by coordinator' })).status).toBe(200);
    expect((await history('NOTEBOOK_CORRECTION'))[0]).toMatchObject({ previousPercent: 60, previousStatus: 'PARTIAL', percent: 0, status: 'PENDING' });
  });

  it('protects submitted teaching records from deletion and keeps them after corrections', async () => {
    expect((await request(app).delete(`/api/teaching-records/${ids.record}`).set(auth(teacher.token))).status).toBe(400);
    expect((await get(teacher, '/teaching-records')).body.data).toHaveLength(1);
    expect((await unit()).teachingPercent).toBe(50);
  });
});
