import { Router } from 'express';
import { z } from 'zod';
import { isChapterDelayed, type Role } from '@ssms/shared';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/error.middleware';
import { ChapterModel } from '../../models/academic.models';
import { AuditLogModel } from '../../models/auth.models';
import { NotificationModel } from '../../models/planning.models';
import { asyncHandler, notFound } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import { idParam, objectId, parsePage } from '../common/crud';
import { currentSessionId } from '../common/integrity';
import { computeUnits } from '../progress/progress.service';
import { notifyUsers, usersWithRoles } from './notifications.service';

const announceBody = z.object({
  title: z.string().trim().min(2).max(200),
  message: z.string().trim().max(2000).default(''),
  roles: z.array(z.enum(['SUPER_ADMIN', 'PRINCIPAL', 'ACADEMIC_COORDINATOR', 'TEACHER'])).min(1),
});
const pageQuery = z.object({ page: z.string().optional(), pageSize: z.string().optional(), unread: z.enum(['true', 'false']).optional() });
const auditQuery = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  action: z.string().max(80).optional(),
  entityType: z.string().max(80).optional(),
  actor: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Creates deduplicated reminders for delayed chapters; safe to run repeatedly. */
export async function generateReminders(): Promise<number> {
  let session: string;
  try {
    session = await currentSessionId();
  } catch {
    return 0;
  }
  const now = new Date();
  const units = await computeUnits({ academicSession: session });
  const delayed = units.filter((u) => isChapterDelayed(u, now));
  if (!delayed.length) return 0;
  const supervisors = await usersWithRoles(['PRINCIPAL', 'ACADEMIC_COORDINATOR']);
  const titles = new Map((await ChapterModel.find({ _id: { $in: delayed.map((d) => d.chapter) } }).select('title').lean()).map((c) => [String(c._id), c.title]));
  const today = now.toISOString().slice(0, 10);
  let created = 0;
  for (const u of delayed) {
    const title = `Delayed chapter: ${titles.get(u.chapter) ?? u.chapterTitle}`;
    const base = { type: 'DELAYED_CHAPTER' as const, title, message: `Progress ${u.progress}% is behind the plan.`, link: '/reports' };
    created += await notifyUsers(u.teachers, { ...base, dedupeKey: `delay:${u.section}:${u.chapter}:${today}` });
    created += await notifyUsers(supervisors, { ...base, dedupeKey: `delay-sup:${u.section}:${u.chapter}:${today}` });
  }
  return created;
}

export function notificationRoutes(): Router {
  const r = Router();
  r.use(authenticate);

  r.get(
    '/notifications',
    validate({ query: pageQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as z.infer<typeof pageQuery>;
      const filter: Record<string, unknown> = { user: req.user!.id };
      if (q.unread === 'true') filter.readAt = null;
      const { page, pageSize, skip } = parsePage(q);
      const [data, total, unread] = await Promise.all([
        NotificationModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
        NotificationModel.countDocuments(filter),
        NotificationModel.countDocuments({ user: req.user!.id, readAt: null }),
      ]);
      res.json({ data, meta: { page, pageSize, total, unread } });
    }),
  );

  r.post(
    '/notifications/read-all',
    asyncHandler(async (req, res) => {
      await NotificationModel.updateMany({ user: req.user!.id, readAt: null }, { $set: { readAt: new Date() } });
      res.status(204).end();
    }),
  );

  r.post(
    '/notifications/:id/read',
    asyncHandler(async (req, res) => {
      const n = await NotificationModel.findOneAndUpdate({ _id: idParam.parse(req.params).id, user: req.user!.id }, { $set: { readAt: new Date() } }, { new: true }).lean();
      if (!n) throw notFound();
      res.json({ data: n });
    }),
  );

  r.post(
    '/notifications/announce',
    authorize('notifications:manage'),
    validate({ body: announceBody }),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof announceBody>;
      const ids = await usersWithRoles(b.roles as Role[]);
      const count = await notifyUsers(ids, { type: 'ANNOUNCEMENT', title: b.title, message: b.message });
      await audit(req, { action: 'ANNOUNCEMENT_SENT', entityType: 'Notification', details: { roles: b.roles, count } });
      res.status(201).json({ data: { delivered: count } });
    }),
  );

  r.post(
    '/notifications/generate',
    authorize('notifications:manage'),
    asyncHandler(async (_req, res) => {
      res.json({ data: { created: await generateReminders() } });
    }),
  );

  r.get(
    '/audit-logs',
    authorize('audit:read'),
    validate({ query: auditQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as z.infer<typeof auditQuery>;
      const filter: Record<string, unknown> = {};
      if (q.action) filter.action = q.action;
      if (q.entityType) filter.entityType = q.entityType;
      if (q.actor) filter.actor = q.actor;
      if (q.from || q.to) filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
      const { page, pageSize, skip } = parsePage(q);
      const [data, total] = await Promise.all([AuditLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(), AuditLogModel.countDocuments(filter)]);
      res.json({ data, meta: { page, pageSize, total } });
    }),
  );

  return r;
}
