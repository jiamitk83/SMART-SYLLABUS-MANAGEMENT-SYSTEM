import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuditLogModel } from '../models/auth.models';
import { TeachingRecordModel } from '../models/planning.models';
import { app, auth, resetTestDb, tokenFor } from './helpers';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = 86_400_000;
type Tok = { token: string; id: string };

describe('daily teaching by role', () => {
  let admin: Tok, principal: Tok, coord: Tok, teacher: Tok, other: Tok;
  const ids: Record<string, string> = {};
  const post = (t: Tok, url: string, body: object) => request(app).post(`/api${url}`).set(auth(t.token)).send(body);
  let period = 0;
  const entry = (t: Tok, extra: Record<string, unknown> = {}) =>
    post(t, '/teaching-records', {
      date: iso(new Date(Date.now() - day)), section: ids.section, subject: ids.subject, chapter: ids.chapter,
      periodNumber: ++period, teachingStatus: 'COMPLETED', ...extra,
    });

  beforeAll(async () => {
    await resetTestDb();
    admin = await tokenFor('SUPER_ADMIN', 'admin');
    principal = await tokenFor('PRINCIPAL', 'princ');
    coord = await tokenFor('ACADEMIC_COORDINATOR', 'coord');
    teacher = await tokenFor('TEACHER', 'teach1');
    other = await tokenFor('TEACHER', 'teach2');
    const now = Date.now();
    ids.session = (await post(admin, '/academic-sessions', { name: '2025-26', startDate: iso(new Date(now - 60 * day)), endDate: iso(new Date(now + 300 * day)) })).body.data._id;
    await post(admin, `/academic-sessions/${ids.session}/set-current`, {});
    ids.class = (await post(admin, '/classes', { name: 'Class 8' })).body.data._id;
    ids.section = (await post(admin, '/sections', { class: ids.class, name: 'A' })).body.data._id;
    ids.subject = (await post(admin, '/subjects', { name: 'Mathematics', code: 'MATH' })).body.data._id;
    ids.subject2 = (await post(admin, '/subjects', { name: 'Science', code: 'SCI' })).body.data._id;
    await post(admin, '/teacher-assignments', { section: ids.section, subject: ids.subject, teacher: teacher.id });
    ids.chapter = (await post(coord, '/chapters', { class: ids.class, subject: ids.subject, title: 'Algebra', estimatedPeriods: 8 })).body.data._id;
    ids.chapter2 = (await post(coord, '/chapters', { class: ids.class, subject: ids.subject2, title: 'Cells', estimatedPeriods: 8 })).body.data._id;
  });

  it('SUPER_ADMIN records on behalf of the assigned teacher without impersonating', async () => {
    const res = await entry(admin, { teacher: teacher.id });
    expect(res.status).toBe(201);
    const rec = await TeachingRecordModel.findById(res.body.data._id).lean();
    expect(String(rec!.teacher)).toBe(teacher.id);
    expect(String(rec!.createdBy)).toBe(admin.id);
    expect(rec!.enteredOnBehalf).toBe(true);
    expect(String(rec!.history[0]!.by)).toBe(admin.id);
    const log = await AuditLogModel.findOne({ action: 'TEACHING_RECORD_CREATED', entityId: String(rec!._id) }).lean();
    expect(JSON.stringify(log!.details)).toContain(teacher.id);
  });

  it('SUPER_ADMIN without a teacher uses the single assigned teacher', async () => {
    const res = await entry(admin);
    expect(res.status).toBe(201);
    expect(String(res.body.data.teacher)).toBe(teacher.id);
    expect(String(res.body.data.createdBy)).toBe(admin.id);
  });

  it('SUPER_ADMIN can record for a section/subject with no assignment, as themselves', async () => {
    const res = await entry(admin, { subject: ids.subject2, chapter: ids.chapter2 });
    expect(res.status).toBe(201);
    expect(String(res.body.data.teacher)).toBe(admin.id);
    expect(res.body.data.enteredOnBehalf).toBe(false);
  });

  it('SUPER_ADMIN cannot name a teacher who is not assigned', async () => {
    expect((await entry(admin, { teacher: other.id })).status).toBe(403);
  });

  it('TEACHER stays restricted to assignments and cannot spoof another teacher', async () => {
    expect((await entry(other)).status).toBe(403);
    expect((await entry(teacher, { subject: ids.subject2, chapter: ids.chapter2 })).status).toBe(403);
    const res = await entry(teacher, { teacher: other.id });
    expect(res.status).toBe(201);
    expect(String(res.body.data.teacher)).toBe(teacher.id);
    expect(res.body.data.enteredOnBehalf).toBe(false);
  });

  it('PRINCIPAL and COORDINATOR follow configured permissions (no teaching:write by default)', async () => {
    expect((await entry(principal, { teacher: teacher.id })).status).toBe(403);
    expect((await entry(coord, { teacher: teacher.id })).status).toBe(403);
  });
});
