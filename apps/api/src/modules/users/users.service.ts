import type { Role } from '@ssms/shared';
import { badRequest, conflict, notFound } from '../../utils/errors';
import { writeAudit } from '../audit/audit.service';
import { authService, hashPassword, toPublicUser } from '../auth/auth.service';
import { usersRepository as repo } from './users.repository';

type Actor = { id: string; fullName: string };

export const usersService = {
  async list(query: { q?: string; role?: Role; isActive?: 'true' | 'false'; page: number; pageSize: number }) {
    const { data, total } = await repo.list({
      q: query.q,
      role: query.role,
      isActive: query.isActive,
      skip: (query.page - 1) * query.pageSize,
      limit: query.pageSize,
    });
    return { data: data.map(toPublicUser), total };
  },

  async get(id: string) {
    const user = await repo.findById(id);
    if (!user) throw notFound('User not found');
    return toPublicUser(user);
  },

  async create(actor: Actor, input: Record<string, unknown> & { password: string }, ip?: string) {
    const { password, ...rest } = input;
    try {
      const user = await repo.create({ ...rest, passwordHash: await hashPassword(password) });
      await writeAudit({ id: actor.id, name: actor.fullName }, { action: 'USER_CREATED', entityType: 'User', entityId: String(user._id), details: { role: user.role, username: user.username } }, ip);
      return toPublicUser(user);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw conflict('Username, email or employee code already exists');
      throw err;
    }
  },

  async update(actor: Actor, id: string, patch: Record<string, unknown>, ip?: string) {
    const user = await repo.findById(id);
    if (!user) throw notFound('User not found');
    const before = { role: user.role };
    if (patch.role && patch.role !== user.role) {
      if (id === actor.id) throw badRequest('You cannot change your own role');
      if (user.role === 'SUPER_ADMIN' && user.isActive && (await repo.countActiveSuperAdmins()) <= 1) {
        throw badRequest('At least one active Super Admin is required');
      }
    }
    user.set(patch);
    try {
      await user.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw conflict('Email or employee code already exists');
      throw err;
    }
    if (patch.role && patch.role !== before.role) {
      await authService.revokeAllSessions(id, 'ROLE_CHANGED');
      await writeAudit({ id: actor.id, name: actor.fullName }, { action: 'ROLE_CHANGED', entityType: 'User', entityId: id, details: { from: before.role, to: patch.role } }, ip);
    } else {
      await writeAudit({ id: actor.id, name: actor.fullName }, { action: 'USER_UPDATED', entityType: 'User', entityId: id, details: patch }, ip);
    }
    return toPublicUser(user);
  },

  async setActive(actor: Actor, id: string, isActive: boolean, ip?: string) {
    const user = await repo.findById(id);
    if (!user) throw notFound('User not found');
    if (!isActive) {
      if (id === actor.id) throw badRequest('You cannot deactivate your own account');
      if (user.role === 'SUPER_ADMIN' && user.isActive && (await repo.countActiveSuperAdmins()) <= 1) {
        throw badRequest('At least one active Super Admin is required');
      }
    }
    user.isActive = isActive;
    await user.save();
    if (!isActive) await authService.revokeAllSessions(id, 'USER_DEACTIVATED');
    await writeAudit({ id: actor.id, name: actor.fullName }, { action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', entityType: 'User', entityId: id }, ip);
    return toPublicUser(user);
  },

  async resetPassword(actor: Actor, id: string, password: string, ip?: string) {
    const user = await repo.findById(id);
    if (!user) throw notFound('User not found');
    user.passwordHash = await hashPassword(password);
    user.passwordChangedAt = new Date();
    await user.save();
    await authService.revokeAllSessions(id, 'ADMIN_PASSWORD_RESET');
    await writeAudit({ id: actor.id, name: actor.fullName }, { action: 'PASSWORD_RESET_BY_ADMIN', entityType: 'User', entityId: id }, ip);
  },
};
