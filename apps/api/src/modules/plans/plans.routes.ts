import { Router, type Request } from 'express';
import { z } from 'zod';
import { aggregatePlannedProgress, aggregateProgress } from '@ssms/shared';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/error.middleware';
import { AcademicSessionModel, ChapterModel, SectionModel, TeacherAssignmentModel, TopicModel } from '../../models/academic.models';
import { PLAN_LEVELS, SyllabusPlanModel } from '../../models/planning.models';
import { asyncHandler, badRequest, conflict, notFound } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import { idParam, objectId, parsePage } from '../common/crud';
import { computeUnits } from '../progress/progress.service';

const level = z.enum(PLAN_LEVELS);
const planBody = z.object({
  chapter: objectId,
  section: objectId.optional(),
  level,
  topics: z.array(objectId).max(200).default([]),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  estimatedPeriods: z.number().min(0).max(500).optional(),
  target: z.string().trim().max(500).default(''),
});
const rescheduleBody = z.object({ startDate: z.coerce.date(), endDate: z.coerce.date(), reason: z.string().trim().min(3).max(500) });
const updateBody = z.object({ topics: z.array(objectId).max(200), estimatedPeriods: z.number().min(0).max(500), target: z.string().trim().max(500) }).partial();
const listQuery = z.object({
  academicSession: objectId.optional(),
  class: objectId.optional(),
  section: objectId.optional(),
  subject: objectId.optional(),
  chapter: objectId.optional(),
  level: level.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  withProgress: z.enum(['true', 'false']).optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

const DAY = 86_400_000;

function checkDates(l: z.infer<typeof level>, start: Date, end: Date): void {
  if (end < start) throw badRequest('End date must be on or after start date');
  if (l === 'MONTHLY' && (start.getUTCMonth() !== end.getUTCMonth() || start.getUTCFullYear() !== end.getUTCFullYear())) {
    throw badRequest('A monthly plan must start and end within the same month');
  }
  if (l === 'WEEKLY' && end.getTime() - start.getTime() > 6 * DAY) throw badRequest('A weekly plan cannot exceed 7 days');
}

async function assertWithinSession(sessionId: string, start: Date, end: Date): Promise<void> {
  const s = await AcademicSessionModel.findById(sessionId).lean();
  if (!s) throw badRequest('Academic session not found');
  if (start < s.startDate || end > s.endDate) throw badRequest('Plan dates must fall within the academic session');
}

async function assertNoConflict(p: { chapter: string; level: string; section?: string; start: Date; end: Date; excludeId?: string }): Promise<void> {
  const clash = await SyllabusPlanModel.findOne({
    chapter: p.chapter,
    level: p.level,
    isActive: true,
    ...(p.section ? { $or: [{ section: p.section }, { section: { $exists: false } }] } : {}),
    startDate: { $lte: p.end },
    endDate: { $gte: p.start },
    ...(p.excludeId ? { _id: { $ne: p.excludeId } } : {}),
  }).lean();
  if (clash) throw conflict('Another ' + p.level.toLowerCase() + ' plan for this chapter overlaps these dates');
}

async function teacherScope(req: Request): Promise<Record<string, unknown>> {
  if (req.user!.role !== 'TEACHER') return {};
  const rows = await TeacherAssignmentModel.find({ teacher: req.user!.id, isActive: true }).select('class subject').lean();
  return rows.length ? { $or: rows.map((a) => ({ class: a.class, subject: a.subject })) } : { _id: null };
}

export function plansRoutes(): Router {
  const r = Router();
  r.use(authenticate);

  r.get(
    '/plans',
    authorize('plans:read'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as z.infer<typeof listQuery>;
      const user: Record<string, unknown> = {};
      for (const k of ['academicSession', 'class', 'section', 'subject', 'chapter', 'level'] as const) if (q[k]) user[k] = q[k];
      if (q.from) user.endDate = { $gte: q.from };
      if (q.to) user.startDate = { $lte: q.to };
      const filter = { $and: [await teacherScope(req), user, { isActive: true }] };
      const { page, pageSize, skip } = parsePage(q);
      const [plans, total] = await Promise.all([
        SyllabusPlanModel.find(filter)
          .populate('chapter', 'title order weight estimatedPeriods')
          .populate('class section subject', 'name')
          .populate('topics', 'title')
          .sort({ startDate: 1 })
          .skip(skip)
          .limit(pageSize)
          .lean(),
        SyllabusPlanModel.countDocuments(filter),
      ]);
      let data: unknown[] = plans;
      if (q.withProgress === 'true' && plans.length) {
        const session = String(plans[0]!.academicSession);
        const units = await computeUnits({ academicSession: session, class: q.class, section: q.section, subject: q.subject });
        const now = new Date();
        data = plans.map((p) => {
          const chapterId = String((p.chapter as unknown as { _id: unknown })._id);
          const relevant = units.filter((u) => u.chapter === chapterId && (!p.section || u.section === String((p.section as unknown as { _id: unknown })._id)));
          const actual = aggregateProgress(relevant.map((u) => ({ progress: u.progress, weight: u.weight, estimatedPeriods: u.estimatedPeriods })));
          const planned = aggregatePlannedProgress([{ weight: 1, plannedStart: p.startDate, plannedEnd: p.endDate }], now);
          const completed = relevant.length > 0 && relevant.every((u) => u.isCompleted);
          return { ...p, plannedProgress: planned, actualProgress: actual, isCompleted: completed, isDelayed: !completed && p.endDate < now };
        });
      }
      res.json({ data, meta: { page, pageSize, total } });
    }),
  );

  r.post(
    '/plans',
    authorize('plans:manage'),
    validate({ body: planBody }),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof planBody>;
      const chapter = await ChapterModel.findById(b.chapter).lean();
      if (!chapter) throw badRequest('Chapter not found');
      const session = String(chapter.academicSession);
      checkDates(b.level, b.startDate, b.endDate);
      await assertWithinSession(session, b.startDate, b.endDate);
      if (b.section) {
        const section = await SectionModel.findById(b.section).lean();
        if (!section || String(section.class) !== String(chapter.class)) throw badRequest('Section does not belong to the chapter class');
      }
      if (b.topics.length) {
        const count = await TopicModel.countDocuments({ _id: { $in: b.topics }, chapter: b.chapter });
        if (count !== new Set(b.topics).size) throw badRequest('Some topics do not belong to the chapter');
      }
      await assertNoConflict({ chapter: b.chapter, level: b.level, section: b.section, start: b.startDate, end: b.endDate });
      const plan = await SyllabusPlanModel.create({
        ...b,
        academicSession: chapter.academicSession,
        class: chapter.class,
        subject: chapter.subject,
        month: b.level === 'MONTHLY' ? b.startDate.getUTCMonth() + 1 : undefined,
        estimatedPeriods: b.estimatedPeriods ?? chapter.estimatedPeriods,
        createdBy: req.user!.id,
      });
      await audit(req, { action: 'PLAN_CREATED', entityType: 'SyllabusPlan', entityId: String(plan._id), academicSession: session, details: { chapter: chapter.title, level: b.level } });
      res.status(201).json({ data: plan.toObject() });
    }),
  );

  r.patch(
    '/plans/:id',
    authorize('plans:manage'),
    validate({ body: updateBody }),
    asyncHandler(async (req, res) => {
      const id = idParam.parse(req.params).id;
      const plan = await SyllabusPlanModel.findById(id);
      if (!plan) throw notFound();
      const b = req.body as z.infer<typeof updateBody>;
      if (b.topics?.length) {
        const count = await TopicModel.countDocuments({ _id: { $in: b.topics }, chapter: plan.chapter });
        if (count !== new Set(b.topics).size) throw badRequest('Some topics do not belong to the chapter');
      }
      plan.set(b);
      await plan.save();
      await audit(req, { action: 'PLAN_UPDATED', entityType: 'SyllabusPlan', entityId: id, academicSession: String(plan.academicSession), details: b });
      res.json({ data: plan.toObject() });
    }),
  );

  r.post(
    '/plans/:id/reschedule',
    authorize('plans:manage'),
    validate({ body: rescheduleBody }),
    asyncHandler(async (req, res) => {
      const id = idParam.parse(req.params).id;
      const plan = await SyllabusPlanModel.findById(id);
      if (!plan) throw notFound();
      const b = req.body as z.infer<typeof rescheduleBody>;
      checkDates(plan.level, b.startDate, b.endDate);
      await assertWithinSession(String(plan.academicSession), b.startDate, b.endDate);
      await assertNoConflict({ chapter: String(plan.chapter), level: plan.level, section: plan.section ? String(plan.section) : undefined, start: b.startDate, end: b.endDate, excludeId: id });
      plan.reschedules.push({ fromStart: plan.startDate, fromEnd: plan.endDate, toStart: b.startDate, toEnd: b.endDate, reason: b.reason, by: req.user!.id as never, at: new Date() });
      plan.startDate = b.startDate;
      plan.endDate = b.endDate;
      if (plan.level === 'MONTHLY') plan.month = b.startDate.getUTCMonth() + 1;
      await plan.save();
      await audit(req, { action: 'PLAN_RESCHEDULED', entityType: 'SyllabusPlan', entityId: id, academicSession: String(plan.academicSession), details: { to: b } });
      res.json({ data: plan.toObject() });
    }),
  );

  r.delete(
    '/plans/:id',
    authorize('plans:manage'),
    asyncHandler(async (req, res) => {
      const id = idParam.parse(req.params).id;
      const plan = await SyllabusPlanModel.findByIdAndUpdate(id, { $set: { isActive: false } });
      if (!plan) throw notFound();
      await audit(req, { action: 'PLAN_CANCELLED', entityType: 'SyllabusPlan', entityId: id, academicSession: String(plan.academicSession) });
      res.status(204).end();
    }),
  );

  return r;
}
