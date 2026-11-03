import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, ROLES } from '@ssms/shared';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/error.middleware';
import { RoleModel, UserModel } from '../../models/auth.models';
import { asyncHandler, badRequest, notFound } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import { invalidatePermissionCache } from '../auth/permissions.service';
import { idParam, parsePage } from '../common/crud';
import { createTeacherBody, createUserBody, listUsersQuery, resetPasswordByAdminBody, updateRoleBody, updateUserBody } from './users.validation';
import { usersService } from './users.service';

export function usersRoutes(): Router {
  const r = Router();
  r.use(authenticate);

  r.get(
    '/users',
    authorize('users:manage'),
    validate({ query: listUsersQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as z.infer<typeof listUsersQuery>;
      const { page, pageSize } = parsePage(q);
      const { data, total } = await usersService.list({ q: q.q, role: q.role, isActive: q.isActive, page, pageSize });
      res.json({ data, meta: { page, pageSize, total } });
    }),
  );

  r.get(
    '/users/:id',
    authorize('users:manage'),
    asyncHandler(async (req, res) => {
      res.json({ data: await usersService.get(idParam.parse(req.params).id) });
    }),
  );

  r.post(
    '/users',
    authorize('users:manage'),
    validate({ body: createUserBody }),
    asyncHandler(async (req, res) => {
      const user = await usersService.create(req.user!, req.body as never, req.ip);
      res.status(201).json({ data: user });
    }),
  );

  r.patch(
    '/users/:id',
    authorize('users:manage'),
    validate({ body: updateUserBody }),
    asyncHandler(async (req, res) => {
      res.json({ data: await usersService.update(req.user!, idParam.parse(req.params).id, req.body as Record<string, unknown>, req.ip) });
    }),
  );

  r.patch(
    '/users/:id/active',
    authorize('users:manage'),
    validate({ body: z.object({ isActive: z.boolean() }) }),
    asyncHandler(async (req, res) => {
      const { isActive } = req.body as { isActive: boolean };
      res.json({ data: await usersService.setActive(req.user!, idParam.parse(req.params).id, isActive, req.ip) });
    }),
  );

  r.post(
    '/users/:id/reset-password',
    authorize('users:manage'),
    validate({ body: resetPasswordByAdminBody }),
    asyncHandler(async (req, res) => {
      await usersService.resetPassword(req.user!, idParam.parse(req.params).id, (req.body as { password: string }).password, req.ip);
      res.status(204).end();
    }),
  );

  // Teacher master: teachers are users with the TEACHER role.
  r.get(
    '/teachers',
    authorize('academic:read'),
    asyncHandler(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      const { page, pageSize } = parsePage(q);
      const { data, total } = await usersService.list({
        q: q.q,
        role: 'TEACHER',
        isActive: q.isActive === 'true' || q.isActive === 'false' ? q.isActive : undefined,
        page,
        pageSize,
      });
      res.json({ data, meta: { page, pageSize, total } });
    }),
  );

  r.post(
    '/teachers',
    authorize('academic:manage'),
    validate({ body: createTeacherBody }),
    asyncHandler(async (req, res) => {
      const user = await usersService.create(req.user!, { ...(req.body as Record<string, unknown>), role: 'TEACHER' } as never, req.ip);
      res.status(201).json({ data: user });
    }),
  );

  r.post(
    '/teachers/bulk',
    authorize('academic:manage'),
    validate({ body: z.object({ items: z.array(createTeacherBody).min(1).max(500) }) }),
    asyncHandler(async (req, res) => {
      const { items } = req.body as { items: Array<Record<string, unknown>> };
      const created: string[] = [];
      const skipped: Array<{ index: number; reason: string }> = [];
      for (const [index, item] of items.entries()) {
        try {
          const u = await usersService.create(req.user!, { ...item, role: 'TEACHER' } as never, req.ip);
          created.push(u.id);
        } catch (err) {
          skipped.push({ index, reason: err instanceof Error ? err.message : 'Failed' });
        }
      }
      res.status(201).json({ created: created.length, skipped });
    }),
  );

  r.patch(
    '/teachers/:id',
    authorize('academic:manage'),
    validate({ body: updateUserBody }),
    asyncHandler(async (req, res) => {
      const id = idParam.parse(req.params).id;
      const existing = await UserModel.findOne({ _id: id, role: 'TEACHER' }).lean();
      if (!existing) throw notFound('Teacher not found');
      const { role: _ignored, ...patch } = req.body as Record<string, unknown>;
      res.json({ data: await usersService.update(req.user!, id, patch, req.ip) });
    }),
  );

  r.patch(
    '/teachers/:id/active',
    authorize('academic:manage'),
    validate({ body: z.object({ isActive: z.boolean() }) }),
    asyncHandler(async (req, res) => {
      const id = idParam.parse(req.params).id;
      if (!(await UserModel.exists({ _id: id, role: 'TEACHER' }))) throw notFound('Teacher not found');
      res.json({ data: await usersService.setActive(req.user!, id, (req.body as { isActive: boolean }).isActive, req.ip) });
    }),
  );

  r.get(
    '/roles',
    authorize('roles:manage'),
    asyncHandler(async (_req, res) => {
      res.json({ data: await RoleModel.find().sort({ name: 1 }).lean(), allPermissions: PERMISSIONS });
    }),
  );

  r.patch(
    '/roles/:name',
    authorize('roles:manage'),
    validate({ body: updateRoleBody }),
    asyncHandler(async (req, res) => {
      const name = String(req.params.name);
      if (!(ROLES as readonly string[]).includes(name)) throw notFound('Role not found');
      if (name === 'SUPER_ADMIN') throw badRequest('Super Admin permissions cannot be changed');
      const { permissions } = req.body as { permissions: string[] };
      const invalid = permissions.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
      if (invalid.length) throw badRequest(`Unknown permissions: ${invalid.join(', ')}`);
      const role = await RoleModel.findOneAndUpdate({ name }, { $set: { permissions: [...new Set(permissions)] } }, { new: true, upsert: true }).lean();
      invalidatePermissionCache();
      await audit(req, { action: 'ROLE_PERMISSIONS_CHANGED', entityType: 'Role', entityId: name, details: { permissions } });
      res.json({ data: role });
    }),
  );

  return r;
}
