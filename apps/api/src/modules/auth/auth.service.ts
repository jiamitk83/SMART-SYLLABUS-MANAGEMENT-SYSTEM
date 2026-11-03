import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import type { Role } from '@ssms/shared';
import { env } from '../../config/env';
import type { UserDoc } from '../../models/auth.models';
import { randomToken, sha256 } from '../../utils/crypto';
import { AppError, badRequest, unauthorized } from '../../utils/errors';
import { writeAudit } from '../audit/audit.service';
import { authRepository as repo } from './auth.repository';
import { getPermissions } from './permissions.service';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: Date;
  permissions?: string[];
}

export function toPublicUser(u: UserDoc): PublicUser {
  return {
    id: String(u._id),
    username: u.username,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt ?? undefined,
  };
}

// Used to keep response time constant when the account does not exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, env.BCRYPT_ROUNDS);

function signAccess(user: UserDoc): string {
  return jwt.sign({ sub: String(user._id), role: user.role }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
  });
}

async function issueSession(user: UserDoc, meta: RequestMeta, familyId: string = randomUUID()) {
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await repo.createSession({
    user: user._id,
    familyId,
    tokenHash: sha256(refreshToken),
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 250),
    ip: meta.ip,
  });
  return { accessToken: signAccess(user), refreshToken, refreshExpiresAt: expiresAt };
}

async function withPermissions(user: UserDoc): Promise<PublicUser> {
  return { ...toPublicUser(user), permissions: await getPermissions(user.role) };
}

export const authService = {
  async login(identifier: string, password: string, meta: RequestMeta) {
    const user = await repo.findUserByIdentifier(identifier);
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      await writeAudit(undefined, { action: 'LOGIN_FAILED', entityType: 'User', details: { identifier: identifier.slice(0, 100) } }, meta.ip);
      throw unauthorized('Invalid credentials');
    }
    if (!user.isActive) {
      await writeAudit({ id: String(user._id), name: user.fullName }, { action: 'LOGIN_BLOCKED_INACTIVE', entityType: 'User', entityId: String(user._id) }, meta.ip);
      throw new AppError(403, 'This account is inactive', 'ACCOUNT_INACTIVE');
    }
    user.lastLoginAt = new Date();
    await user.save();
    const tokens = await issueSession(user, meta);
    await writeAudit({ id: String(user._id), name: user.fullName }, { action: 'LOGIN_SUCCESS', entityType: 'User', entityId: String(user._id) }, meta.ip);
    return { user: await withPermissions(user), ...tokens };
  },

  async refresh(token: string | undefined, meta: RequestMeta) {
    if (!token) throw unauthorized('No refresh token');
    const hash = sha256(token);
    const session = await repo.findSessionByHash(hash);
    if (!session) throw unauthorized('Invalid refresh token');
    if (session.revokedAt) {
      await repo.revokeFamily(session.familyId, 'REUSE_DETECTED');
      await writeAudit({ id: String(session.user) }, { action: 'REFRESH_TOKEN_REUSE', entityType: 'User', entityId: String(session.user) }, meta.ip);
      throw unauthorized('Session revoked');
    }
    if (session.expiresAt.getTime() <= Date.now()) throw unauthorized('Session expired');
    const user = await repo.findUserById(session.user);
    if (!user || !user.isActive) {
      await repo.revokeFamily(session.familyId, 'USER_INACTIVE');
      throw unauthorized('Account is inactive');
    }
    const next = await issueSession(user, meta, session.familyId);
    await repo.revokeSession(hash, 'ROTATED', sha256(next.refreshToken));
    return { user: await withPermissions(user), ...next };
  },

  async logout(token: string | undefined, actor?: { id: string; name: string }, ip?: string) {
    if (!token) return;
    const session = await repo.findSessionByHash(sha256(token));
    if (!session) return;
    await repo.revokeFamily(session.familyId, 'LOGOUT');
    await writeAudit(actor ?? { id: String(session.user) }, { action: 'LOGOUT', entityType: 'User', entityId: String(session.user) }, ip);
  },

  async me(userId: string) {
    const user = await repo.findUserById(userId);
    if (!user) throw unauthorized();
    return withPermissions(user);
  },

  async changePassword(userId: string, current: string, next: string, meta: RequestMeta) {
    const user = await repo.findUserWithHash(userId);
    if (!user || !(await bcrypt.compare(current, user.passwordHash))) throw badRequest('Current password is incorrect');
    if (await bcrypt.compare(next, user.passwordHash)) throw badRequest('New password must differ from the current password');
    user.passwordHash = await hashPassword(next);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    await user.save();
    await repo.revokeAllForUser(user._id, 'PASSWORD_CHANGED');
    await writeAudit({ id: String(user._id), name: user.fullName }, { action: 'PASSWORD_CHANGED', entityType: 'User', entityId: String(user._id) }, meta.ip);
    return issueSession(user, meta);
  },

  /** Returns the raw reset token only so tests and the dev log can use it; callers must never send it to HTTP clients in production. */
  async forgotPassword(identifier: string, meta: RequestMeta): Promise<string | null> {
    const user = await repo.findUserByIdentifier(identifier);
    if (!user || !user.isActive) return null;
    const token = randomToken(32);
    await repo.createResetToken({
      user: user._id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + env.RESET_TOKEN_TTL_MIN * 60_000),
    });
    await writeAudit({ id: String(user._id), name: user.fullName }, { action: 'PASSWORD_RESET_REQUESTED', entityType: 'User', entityId: String(user._id) }, meta.ip);
    return token;
  },

  async resetPassword(token: string, newPassword: string, meta: RequestMeta) {
    const record = await repo.findResetToken(sha256(token));
    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) throw badRequest('Reset link is invalid or expired');
    const user = await repo.findUserWithHash(record.user);
    if (!user || !user.isActive) throw badRequest('Reset link is invalid or expired');
    user.passwordHash = await hashPassword(newPassword);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    await user.save();
    record.usedAt = new Date();
    await record.save();
    await repo.revokeAllForUser(user._id, 'PASSWORD_RESET');
    await writeAudit({ id: String(user._id), name: user.fullName }, { action: 'PASSWORD_RESET_COMPLETED', entityType: 'User', entityId: String(user._id) }, meta.ip);
  },

  revokeAllSessions: (userId: string, reason: string) => repo.revokeAllForUser(userId, reason),
  listSessions: (userId: string) => repo.listActiveSessions(userId),
};
