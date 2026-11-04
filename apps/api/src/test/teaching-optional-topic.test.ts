import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, auth, resetTestDb, tokenFor } from './helpers';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = 86_400_000;
type Tok = { token: string; id: string };

describe('optional topic/subtopic teaching and progress', () => {
  let admin: Tok, coord: Tok, teacher: Tok, other: Tok;
  const ids = {} as { [K in 'session' | 'class' | 'section' | 'subject' | 'plain' | 'withTopics' | 'mixed' | 't1' | 'sub' | 'm1']: string };
  const post = (t: Tok, url: string, body: object) => request(app).post(`/api${url}`).set(auth(t.token)).send(body);
  const get = (t: Tok, url: string) => request(app).get(`/api${url}`).set(auth(t.token));
  let period = 0;
  const entry = (t: Tok, chapter: string, extra: Record<string, unknown> = {}) =>
    post(t, '/teaching-records', {
      date: iso(new Date(Date.now() - day)), section: ids.section, subject: ids.subject, chapter,
      periodNumber: ++period, teachingStatus: 'COMPLETED', ...extra,
    });
  const unit = async (chapter: string) => {
    const rows = (await get(admin, `/progress/chapters?section=${ids.section}`)).body.data as { chapter: string; teachingPercent: number }[];
    return rows.find((r) => r.chapter === chapter)!.teachingPercent;
  };

  beforeAll(async () => {
    await resetTestDb();
    admin = await tokenFor('SUPER_ADMIN', 'admin');
    coord = await tokenFor('ACADEMIC_COORDINATOR', 'coord');
    teacher = await tokenFor('TEACHER', 'teach1');
    other = await tokenFor('TEACHER', 'teach2');
    const now = Date.now();
    ids.session = (await post(admin, '/academic-sessions', { name: '2025-26', startDate: iso(new Date(now - 60 * day)), endDate: iso(new Date(now + 300 * day)) })).body.data._id;
    await post(admin, `/academic-sessions/${ids.session}/set-current`, {});
    ids.class = (await post(admin, '/classes', { name: 'Class 8' })).body.data._id;
    ids.section = (await post(admin, '/sections', { class: ids.class, name: 'A' })).body.data._id;
    ids.subject = (await post(admin, '/subjects', { name: 'Mathematics', code: 'MATH' })).body.data._id;
    await post(admin, '/teacher-assignments', { section: ids.section, subject: ids.subject, teacher: teacher.id });
    const chapter = async (title: string) => (await post(coord, '/chapters', { class: ids.class, subject: ids.subject, title, estimatedPeriods: 8 })).body.data._id as string;
    ids.plain = await chapter('No topics');
    ids.withTopics = await chapter('With topics');
    ids.mixed = await chapter('Mixed');
    ids.t1 = (await post(coord, '/topics', { chapter: ids.withTopics, title: 'T1', estimatedPeriods: 3 })).body.data._id;
    await post(coord, '/topics', { chapter: ids.withTopics, title: 'T2', estimatedPeriods: 1 });
    ids.sub = (await post(coord, '/subtopics', { topic: ids.t1, title: 'S1' })).body.data._id;
    ids.m1 = (await post(coord, '/topics', { chapter: ids.mixed, title: 'M1', estimatedPeriods: 1 })).body.data._id;
    await post(coord, '/topics', { chapter: ids.mixed, title: 'M2', estimatedPeriods: 1 });
  });

  it('chapter-only entry is accepted and drafts are excluded', async () => {
    const draft = await entry(teacher, ids.plain);
    expect(draft.status).toBe(201);
    expect(draft.body.data.topic).toBeUndefined();
    expect(await unit(ids.plain)).toBe(0);
  });

  it('submitted chapter-only entries drive progress: COMPLETED, PARTIAL, NOT_TAUGHT; multiple periods never double-count', async () => {
    expect((await entry(teacher, ids.plain, { teachingStatus: 'PARTIAL', submit: true })).status).toBe(201);
    expect(await unit(ids.plain)).toBe(50);
    expect((await entry(teacher, ids.plain, { teachingStatus: 'PARTIAL', submit: true })).status).toBe(201);
    expect(await unit(ids.plain)).toBe(50);
    expect((await entry(teacher, ids.plain, { teachingStatus: 'NOT_TAUGHT', submit: true })).status).toBe(201);
    expect(await unit(ids.plain)).toBe(50);
    expect((await entry(teacher, ids.plain, { submit: true })).status).toBe(201);
    expect(await unit(ids.plain)).toBe(100);
  });

  it('chapter + topic (no subtopic) and chapter + topic + subtopic keep estimatedPeriods weighting', async () => {
    expect((await entry(teacher, ids.withTopics, { topic: ids.t1, submit: true })).status).toBe(201);
    expect(await unit(ids.withTopics)).toBe(75); // 3 of 4 periods
    expect((await entry(teacher, ids.withTopics, { topic: ids.t1, subtopic: ids.sub, submit: true })).status).toBe(201);
    expect(await unit(ids.withTopics)).toBe(75);
  });

  it('a subtopic without a topic is rejected, but empty topic/subtopic is not', async () => {
    expect((await entry(teacher, ids.withTopics, { subtopic: ids.sub })).status).toBe(400);
    expect((await entry(teacher, ids.withTopics)).status).toBe(201);
  });

  it('mixed topic-level and chapter-level records use the higher value, never the sum', async () => {
    expect((await entry(teacher, ids.mixed, { topic: ids.m1, submit: true })).status).toBe(201);
    expect(await unit(ids.mixed)).toBe(50);
    expect((await entry(teacher, ids.mixed, { teachingStatus: 'PARTIAL', submit: true })).status).toBe(201);
    expect(await unit(ids.mixed)).toBe(50);
    expect((await entry(teacher, ids.mixed, { submit: true })).status).toBe(201);
    expect(await unit(ids.mixed)).toBe(100);
  });

  it('role authorization still applies to chapter-only entries', async () => {
    expect((await entry(other, ids.plain)).status).toBe(403);
    expect((await entry(admin, ids.plain, { teacher: teacher.id })).status).toBe(201);
    expect((await entry(coord, ids.plain, { teacher: teacher.id })).status).toBe(403);
  });
});
