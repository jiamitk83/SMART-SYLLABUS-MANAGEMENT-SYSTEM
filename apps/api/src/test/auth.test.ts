import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuditLogModel } from '../models/auth.models';
import { H, PASSWORD, app, login, makeUser, resetTestDb } from './helpers';

const cookieOf = (res: request.Response): string => {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const c = raw?.find((x) => x.startsWith('ssms_refresh='));
  if (!c) throw new Error('no refresh cookie');
  return c.split(';')[0]!;
};

describe('auth', () => {
  beforeAll(async () => {
    await resetTestDb();
    await makeUser('TEACHER', 'tina');
    await makeUser('TEACHER', 'gone', { isActive: false });
  });

  it('rejects bad credentials generically and inactive accounts', async () => {
    expect((await login('tina', 'WrongPass123')).status).toBe(401);
    expect((await login('nobody')).status).toBe(401);
    expect((await login('gone')).status).toBe(403);
  });

  it('logs in with username or email and sets an httpOnly refresh cookie', async () => {
    const res = await login('tina@school.test');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/HttpOnly/i);
  });

  it('protects endpoints without a token', async () => {
    expect((await request(app).get('/api/dashboard')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer junk')).status).toBe(401);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const first = await login('tina');
    const c1 = cookieOf(first);
    const second = await request(app).post('/api/auth/refresh').set(H).set('Cookie', c1);
    expect(second.status).toBe(200);
    const c2 = cookieOf(second);
    expect(c2).not.toBe(c1);

    const reuse = await request(app).post('/api/auth/refresh').set(H).set('Cookie', c1);
    expect(reuse.status).toBe(401);
    const afterReuse = await request(app).post('/api/auth/refresh').set(H).set('Cookie', c2);
    expect(afterReuse.status).toBe(401);
  });

  it('requires the CSRF header on refresh', async () => {
    const c = cookieOf(await login('tina'));
    expect((await request(app).post('/api/auth/refresh').set('Cookie', c)).status).toBe(403);
  });

  it('changes password, revokes old sessions, and enforces policy', async () => {
    const res = await login('tina');
    const token = res.body.accessToken as string;
    const h = { ...H, Authorization: `Bearer ${token}` };
    const weak = await request(app).post('/api/auth/change-password').set(h).send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(400);
    const ok = await request(app).post('/api/auth/change-password').set(h).send({ currentPassword: PASSWORD, newPassword: 'NewPassw0rd!x' });
    expect(ok.status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').set(H).set('Cookie', cookieOf(res))).status).toBe(401);
    expect((await login('tina', 'NewPassw0rd!x')).status).toBe(200);
  });

  it('supports forgot/reset password with single-use tokens', async () => {
    await makeUser('TEACHER', 'rita');
    const f = await request(app).post('/api/auth/forgot-password').send({ identifier: 'rita' });
    expect(f.status).toBe(200);
    const token = f.body.devToken as string;
    expect(token).toBeTruthy();
    const unknown = await request(app).post('/api/auth/forgot-password').send({ identifier: 'ghost' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.devToken).toBeUndefined();
    expect((await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'ResetPassw0rd!' })).status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'ResetPassw0rd!2' })).status).toBe(400);
    expect((await login('rita', 'ResetPassw0rd!')).status).toBe(200);
  });

  it('keeps audit logs immutable', async () => {
    const log = await AuditLogModel.findOne();
    expect(log).toBeTruthy();
    await expect(AuditLogModel.updateOne({ _id: log!._id }, { $set: { action: 'X' } })).rejects.toThrow();
    await expect(AuditLogModel.deleteOne({ _id: log!._id })).rejects.toThrow();
  });
});
