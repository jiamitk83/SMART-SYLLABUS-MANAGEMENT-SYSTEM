import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Role } from '@ssms/shared';
import { createApp } from '../app';
import { connectDb, dbName } from '../db/connect';
import { UserModel } from '../models/auth.models';
import { ensureRoles, invalidatePermissionCache } from '../modules/auth/permissions.service';

export const PASSWORD = 'Passw0rdTest!';
export const app = createApp();
export const H = { 'X-Requested-With': 'ssms' };

/** Wipes the dedicated test database. Refuses to run against anything not named ssms_test*. */
export async function resetTestDb(): Promise<void> {
  await connectDb();
  if (!/^ssms_test/.test(dbName())) throw new Error(`Refusing to wipe non-test database "${dbName()}"`);
  await mongoose.connection.dropDatabase();
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).syncIndexes()));
  invalidatePermissionCache();
  await ensureRoles();
}

export async function makeUser(role: Role, username: string, extra: Record<string, unknown> = {}) {
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  return UserModel.create({ username, email: `${username}@school.test`, fullName: `${username} Name`, role, passwordHash, isActive: true, ...extra });
}

export async function login(username: string, password = PASSWORD) {
  const res = await request(app).post('/api/auth/login').set(H).send({ identifier: username, password });
  return res;
}

export async function tokenFor(role: Role, username: string): Promise<{ token: string; id: string }> {
  const u = await makeUser(role, username);
  const res = await login(username);
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken as string, id: String(u._id) };
}

export const auth = (token: string) => ({ ...H, Authorization: `Bearer ${token}` });
