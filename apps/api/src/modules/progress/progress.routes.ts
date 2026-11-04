import { Router, type Request } from 'express';
import { z } from 'zod';
import { ACTIVITY_STATUSES, ACTIVITY_TYPES, CORRECTION_REASON_MIN_LENGTH, DEFAULT_ACTIVITY_WEIGHTS, ProgressError, activityStatusOf, statusToInput, validateWeights } from '@ssms/shared';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/error.middleware';
import { ChapterModel, SectionModel, TeacherAssignmentModel, TopicModel } from '../../models/academic.models';
import { ActivityModel, CompletionModel, SettingModel, TeachingRecordModel } from '../../models/planning.models';
import { asyncHandler, badRequest, conflict, notFound } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import { hasPermission } from '../auth/permissions.service';
import { idParam, objectId, parsePage } from '../common/crud';
import { assertHierarchy, assertTeacherAssigned, resolveSessionId } from '../common/integrity';
import { notifyUsers, usersWithRoles } from '../notifications/notifications.service';
import { WEIGHTS_KEY, computeUnits, getActivityWeights, groupSummary, summarizeUnits, type UnitFilter } from './progress.service';

const progressQuery = z.object({
  academicSession: objectId.optional(),
  class: objectId.optional(),
  section: objectId.optional(),
  subject: objectId.optional(),
  teacher: objectId.optional(),
  chapter: objectId.optional(),
  asOf: z.coerce.date().optional(),
});

export async function unitFilterFromRequest(req: Request): Promise<{ filter: UnitFilter; asOf: Date }> {
  const q = req.query as z.infer<typeof progressQuery>;
  const filter: UnitFilter = { academicSession: await resolveSessionId(q.academicSession) };
  if (q.class) filter.class = q.class;
  if (q.section) filter.section = q.section;
  if (q.subject) filter.subject = q.subject;
  if (q.chapter) filter.chapter = q.chapter;
  filter.teacher = req.user?.role === 'TEACHER' ? req.user.id : q.teacher;
  return { filter, asOf: q.asOf ?? new Date() };
}

async function authorizeWrite(req: Request, section: string, subject: string): Promise<void> {
  if (req.user!.role === 'TEACHER') await assertTeacherAssigned(req.user!.id, section, subject);
}

const activityBody = z.object({
  section: objectId,
  chapter: objectId,
  activityType: z.enum(ACTIVITY_TYPES),
  status: z.enum(ACTIVITY_STATUSES),
  notes: z.string().max(1000).optional(),
  reason: z.string().trim().min(CORRECTION_REASON_MIN_LENGTH, `A correction reason of at least ${CORRECTION_REASON_MIN_LENGTH} characters is required`).max(500),
});

const completionBody = z.object({ section: objectId, chapter: objectId, remarks: z.string().max(1000).optional(), direct: z.boolean().optional() });
const reviewBody = z.object({ remarks: z.string().max(1000).optional() });

export function progressRoutes(): Router {
  const r = Router();
  r.use(authenticate);

  r.get(
    '/progress/chapters',
    authorize('dashboard:read'),
    validate({ query: progressQuery }),
    asyncHandler(async (req, res) => {
      const { filter, asOf } = await unitFilterFromRequest(req);
      const units = await computeUnits(filter);
      res.json({ data: units, summary: summarizeUnits(units, asOf), asOf });
    }),
  );

  r.get(
    '/progress/summary',
    authorize('dashboard:read'),
    validate({ query: progressQuery }),
    asyncHandler(async (req, res) => {
      const { filter, asOf } = await unitFilterFromRequest(req);
      const units = await computeUnits(filter);
      res.json({
        overall: summarizeUnits(units, asOf),
        byClass: groupSummary(units, (u) => u.class, asOf),
        bySubject: groupSummary(units, (u) => u.subject, asOf),
        bySection: groupSummary(units, (u) => u.section, asOf),
        asOf,
      });
    }),
  );

  r.get(
    '/settings/activity-weights',
    authorize('dashboard:read'),
    asyncHandler(async (_req, res) => {
      res.json({ data: await getActivityWeights(), defaults: DEFAULT_ACTIVITY_WEIGHTS });
    }),
  );

  r.put(
    '/settings/activity-weights',
    authorize('settings:manage'),
    validate({ body: z.record(z.enum(ACTIVITY_TYPES), z.number()) }),
    asyncHandler(async (req, res) => {
      const weights = req.body as Record<string, number>;
      const full = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t, weights[t] ?? NaN])) as Record<(typeof ACTIVITY_TYPES)[number], number>;
      try {
        validateWeights(full);
      } catch (err) {
        throw badRequest(err instanceof ProgressError ? err.message : 'Invalid weights');
      }
      const before = await getActivityWeights();
      await SettingModel.updateOne({ key: WEIGHTS_KEY }, { $set: { value: full, updatedBy: req.user!.id } }, { upsert: true });
      await audit(req, { action: 'ACTIVITY_WEIGHTS_CHANGED', entityType: 'SystemSetting', entityId: WEIGHTS_KEY, details: { before, after: full } });
      res.json({ data: full });
    }),
  );

  r.put(
    '/activities',
    authorize('activities:manage'),
    validate({ body: activityBody }),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof activityBody>;
      const section = await SectionModel.findById(b.section).lean();
      const chapter = await ChapterModel.findById(b.chapter).lean();
      if (!section || !chapter) throw notFound('Section or chapter not found');
      await assertHierarchy({ academicSession: String(section.academicSession), class: String(section.class), section: b.section, subject: String(chapter.subject), chapter: b.chapter });
      await authorizeWrite(req, b.section, String(chapter.subject));
      if (b.activityType === 'TEACHING' && (await TopicModel.exists({ chapter: b.chapter, isActive: true }))) {
        throw badRequest('Teaching progress is calculated from submitted daily teaching records for this chapter and cannot be corrected here');
      }
      const { applicable, percent } = statusToInput(b.status);
      const filter = { section: b.section, chapter: b.chapter, activityType: b.activityType };
      const existing = await ActivityModel.findOne(filter).select('applicable percent').lean();
      const previous = { applicable: existing ? existing.applicable : true, percent: existing ? existing.percent : 0 };
      const previousStatus = activityStatusOf(previous);
      if (previous.applicable === applicable && previous.percent === percent) throw badRequest('The new status is identical to the current status; nothing to correct');
      const entry = {
        at: new Date(),
        by: req.user!.id,
        kind: 'CORRECTION',
        activityType: b.activityType,
        class: section.class,
        section: section._id,
        subject: chapter.subject,
        chapter: chapter._id,
        previousApplicable: previous.applicable,
        previousPercent: previous.percent,
        previousStatus,
        applicable,
        percent,
        status: b.status,
        reason: b.reason,
      };
      const doc = await ActivityModel.findOneAndUpdate(
        filter,
        {
          $set: { academicSession: section.academicSession, class: section.class, subject: chapter.subject, applicable, percent, notes: b.notes ?? '', updatedBy: req.user!.id, source: 'MANUAL' },
          $push: { history: entry },
        },
        { upsert: true, new: true, runValidators: true },
      ).lean();
      await audit(req, {
        action: 'ACTIVITY_CORRECTED',
        entityType: 'ActivityRecord',
        entityId: String(doc._id),
        academicSession: String(section.academicSession),
        details: {
          activityType: b.activityType,
          class: String(section.class),
          section: b.section,
          subject: String(chapter.subject),
          chapter: b.chapter,
          chapterTitle: chapter.title,
          previous: { ...previous, status: previousStatus },
          next: { applicable, percent, status: b.status },
          reason: b.reason,
        },
      });
      res.json({ data: doc });
    }),
  );

  // Append-only correction history for one section's chapter (teachers: assigned classes only).
  r.get(
    '/activities/history',
    authorize('dashboard:read'),
    validate({ query: z.object({ section: objectId, chapter: objectId }) }),
    asyncHandler(async (req, res) => {
      const q = req.query as { section: string; chapter: string };
      const chapter = await ChapterModel.findById(q.chapter).select('subject').lean();
      if (!chapter) throw notFound('Chapter not found');
      await authorizeWrite(req, q.section, String(chapter.subject));
      const docs = await ActivityModel.find({ section: q.section, chapter: q.chapter }).populate('history.by', 'fullName').lean();
      const data = docs
        .flatMap((d) => d.history.map((h) => ({ ...h, activityType: h.activityType ?? d.activityType })))
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      res.json({ data });
    }),
  );

  r.get(
    '/activities',
    authorize('dashboard:read'),
    asyncHandler(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      const filter: Record<string, unknown> = {};
      for (const k of ['academicSession', 'class', 'section', 'subject', 'chapter', 'activityType']) if (q[k]) filter[k] = q[k];
      if (req.user!.role === 'TEACHER') {
        const rows = await TeacherAssignmentModel.find({ teacher: req.user!.id, isActive: true }).select('section subject').lean();
        filter.$or = rows.length ? rows.map((a) => ({ section: a.section, subject: a.subject })) : [{ _id: null }];
      }
      res.json({ data: await ActivityModel.find(filter).limit(2000).lean() });
    }),
  );

  // ---- Chapter completion (strictly separate from daily topic entries) ----
  r.get(
    '/chapter-completions',
    authorize('dashboard:read'),
    asyncHandler(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      const filter: Record<string, unknown> = {};
      for (const k of ['academicSession', 'class', 'section', 'subject', 'chapter', 'status']) if (q[k]) filter[k] = q[k];
      if (req.user!.role === 'TEACHER') {
        const rows = await TeacherAssignmentModel.find({ teacher: req.user!.id, isActive: true }).select('section subject').lean();
        filter.$or = rows.length ? rows.map((a) => ({ section: a.section, subject: a.subject })) : [{ _id: null }];
      }
      const { page, pageSize, skip } = parsePage(q);
      const [data, total] = await Promise.all([
        CompletionModel.find(filter)
          .populate('chapter', 'title order')
          .populate('section', 'name')
          .populate('class', 'name')
          .populate('subject', 'name')
          .populate('requestedBy reviewedBy', 'fullName')
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(pageSize)
          .lean(),
        CompletionModel.countDocuments(filter),
      ]);
      res.json({ data, meta: { page, pageSize, total } });
    }),
  );

  r.post(
    '/chapter-completions',
    authorize('completion:record', 'completion:approve'),
    validate({ body: completionBody }),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof completionBody>;
      const section = await SectionModel.findById(b.section).lean();
      const chapter = await ChapterModel.findById(b.chapter).lean();
      if (!section || !chapter) throw notFound('Section or chapter not found');
      await assertHierarchy({ academicSession: String(section.academicSession), class: String(section.class), section: b.section, subject: String(chapter.subject), chapter: b.chapter });
      if (!(await TeacherAssignmentModel.exists({ section: b.section, subject: chapter.subject, isActive: true }))) {
        throw badRequest('No teacher is assigned to this section and subject');
      }
      if (req.user!.role === 'TEACHER') await assertTeacherAssigned(req.user!.id, b.section, String(chapter.subject));
      const hasWork =
        (await TeachingRecordModel.exists({ section: b.section, chapter: b.chapter, state: 'SUBMITTED' })) ||
        (await ActivityModel.exists({ section: b.section, chapter: b.chapter }));
      if (!hasWork) throw badRequest('Record teaching or activity work for this chapter before requesting completion');

      const direct = Boolean(b.direct) && req.user!.role !== 'TEACHER' && (await hasPermission(req.user!.role, 'completion:approve'));
      const existing = await CompletionModel.findOne({ section: b.section, chapter: b.chapter });
      if (existing && (existing.status === 'APPROVED' || existing.status === 'PENDING_APPROVAL')) {
        throw conflict(`Chapter completion is already ${existing.status === 'APPROVED' ? 'approved' : 'pending approval'}`);
      }
      const toStatus = direct ? 'APPROVED' : 'PENDING_APPROVAL';
      const entry = { by: req.user!.id, fromStatus: existing?.status ?? 'NONE', toStatus, remarks: b.remarks ?? '' };
      const doc = existing
        ? await CompletionModel.findByIdAndUpdate(existing._id, { $set: { status: toStatus, requestedBy: req.user!.id, remarks: b.remarks ?? '', ...(direct ? { reviewedBy: req.user!.id, completedAt: new Date() } : {}) }, $push: { history: entry } }, { new: true }).lean()
        : (await CompletionModel.create({ academicSession: section.academicSession, class: section.class, section: b.section, subject: chapter.subject, chapter: b.chapter, status: toStatus, requestedBy: req.user!.id, remarks: b.remarks ?? '', ...(direct ? { reviewedBy: req.user!.id, completedAt: new Date() } : {}), history: [entry] })).toObject();
      if (!doc) throw notFound();
      await audit(req, { action: direct ? 'CHAPTER_COMPLETION_APPROVED' : 'CHAPTER_COMPLETION_REQUESTED', entityType: 'ChapterCompletionRecord', entityId: String(doc._id), academicSession: String(section.academicSession), details: { chapter: chapter.title, section: b.section } });
      if (!direct) {
        await notifyUsers(await usersWithRoles(['ACADEMIC_COORDINATOR', 'PRINCIPAL', 'SUPER_ADMIN']), {
          type: 'REVIEW_REQUEST',
          title: `Chapter completion review: ${chapter.title}`,
          message: `${req.user!.fullName} requested completion approval.`,
          link: '/completions',
          dedupeKey: `completion:${String(doc._id)}:${doc.history.length}`,
        });
      }
      res.status(201).json({ data: doc });
    }),
  );

  const review = (toStatus: 'APPROVED' | 'REJECTED' | 'REOPENED', fromStatuses: string[], action: string) =>
    asyncHandler(async (req, res) => {
      const id = idParam.parse(req.params).id;
      const { remarks } = req.body as { remarks?: string };
      const rec = await CompletionModel.findById(id);
      if (!rec) throw notFound();
      if (!fromStatuses.includes(rec.status)) throw badRequest(`Cannot move from ${rec.status} to ${toStatus}`);
      rec.history.push({ by: req.user!.id as never, fromStatus: rec.status, toStatus, remarks: remarks ?? '', at: new Date() });
      rec.status = toStatus;
      rec.reviewedBy = req.user!.id as never;
      rec.remarks = remarks ?? rec.remarks;
      rec.completedAt = toStatus === 'APPROVED' ? new Date() : undefined;
      await rec.save();
      await audit(req, { action, entityType: 'ChapterCompletionRecord', entityId: id, academicSession: String(rec.academicSession), details: { remarks } });
      if (rec.requestedBy) {
        const chapter = await ChapterModel.findById(rec.chapter).select('title').lean();
        await notifyUsers([String(rec.requestedBy)], {
          type: 'REVIEW_REQUEST',
          title: `Chapter completion ${toStatus.toLowerCase()}: ${chapter?.title ?? ''}`,
          message: remarks ?? '',
          link: '/completions',
          dedupeKey: `completion-review:${id}:${rec.history.length}`,
        });
      }
      res.json({ data: rec.toObject() });
    });

  const gate = authorize('completion:approve');
  const rv = validate({ body: reviewBody });
  r.post('/chapter-completions/:id/approve', gate, rv, review('APPROVED', ['PENDING_APPROVAL'], 'CHAPTER_COMPLETION_APPROVED'));
  r.post('/chapter-completions/:id/reject', gate, rv, review('REJECTED', ['PENDING_APPROVAL'], 'CHAPTER_COMPLETION_REJECTED'));
  r.post('/chapter-completions/:id/reopen', gate, rv, review('REOPENED', ['APPROVED'], 'CHAPTER_COMPLETION_REOPENED'));

  return r;
}
