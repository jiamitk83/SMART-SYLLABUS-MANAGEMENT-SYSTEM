import { Router, type Request } from 'express';
import { z } from 'zod';
import { TEACHING_STATUSES } from '@ssms/shared';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/error.middleware';
import { AcademicSessionModel, SectionModel } from '../../models/academic.models';
import { TeachingRecordModel } from '../../models/planning.models';
import { UserModel } from '../../models/auth.models';
import { asyncHandler, badRequest, forbidden, notFound } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import { escapeRegex, idParam, objectId, parsePage } from '../common/crud';
import { assertHierarchy, assertTeacherAssigned } from '../common/integrity';
import { hasPermission } from '../auth/permissions.service';

const base = {
  date: z.coerce.date(),
  section: objectId,
  subject: objectId,
  chapter: objectId,
  topic: objectId.optional(),
  subtopic: objectId.optional(),
  periodNumber: z.number().int().min(1).max(20),
  description: z.string().trim().max(2000).default(''),
  teachingStatus: z.enum(TEACHING_STATUSES),
  remarks: z.string().trim().max(1000).default(''),
};

const createBody = z.object({ ...base, teacher: objectId.optional(), submit: z.boolean().default(false) }).refine((v) => !v.subtopic || v.topic, {
  message: 'A subtopic requires a topic',
  path: ['subtopic'],
});

const updateBody = z
  .object({
    date: base.date,
    periodNumber: base.periodNumber,
    topic: objectId.nullable(),
    subtopic: objectId.nullable(),
    chapter: objectId,
    description: base.description,
    teachingStatus: base.teachingStatus,
    remarks: base.remarks,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const listQuery = z.object({
  academicSession: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  class: objectId.optional(),
  section: objectId.optional(),
  subject: objectId.optional(),
  teacher: objectId.optional(),
  chapter: objectId.optional(),
  state: z.enum(['DRAFT', 'SUBMITTED']).optional(),
  q: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

async function assertDateInSession(date: Date, sessionId: string): Promise<void> {
  const s = await AcademicSessionModel.findById(sessionId).lean();
  if (!s) throw badRequest('Academic session not found');
  if (date < s.startDate || date > s.endDate) throw badRequest('Date is outside the academic session');
  if (date > endOfToday()) throw badRequest('Teaching cannot be recorded for a future date');
}

async function loadEditable(req: Request) {
  const rec = await TeachingRecordModel.findById(idParam.parse(req.params).id);
  if (!rec) throw notFound();
  const isOwner = String(rec.teacher) === req.user!.id;
  if (!isOwner && !(req.user!.role === 'SUPER_ADMIN')) throw forbidden('You can only modify your own teaching records');
  return rec;
}

export function teachingRoutes(): Router {
  const r = Router();
  r.use(authenticate);

  r.get(
    '/teaching-records',
    authorize('teaching:write', 'teaching:read:all'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as z.infer<typeof listQuery>;
      const filter: Record<string, unknown> = {};
      const canViewAll = await hasPermission(req.user!.role, 'teaching:read:all');
      if (!canViewAll || req.user!.role === 'TEACHER') filter.teacher = req.user!.id;
      else if (q.teacher) filter.teacher = q.teacher;
      for (const k of ['academicSession', 'class', 'section', 'subject', 'chapter', 'state'] as const) if (q[k]) filter[k] = q[k];
      if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
      if (q.q?.trim()) filter.description = new RegExp(escapeRegex(q.q.trim()), 'i');
      const { page, pageSize, skip } = parsePage(q);
      const [data, total] = await Promise.all([
        TeachingRecordModel.find(filter)
          .select('-history')
          .populate('class section subject', 'name')
          .populate('teacher', 'fullName')
          .populate('chapter topic subtopic', 'title')
          .sort({ date: -1, periodNumber: 1 })
          .skip(skip)
          .limit(pageSize)
          .lean(),
        TeachingRecordModel.countDocuments(filter),
      ]);
      res.json({ data, meta: { page, pageSize, total } });
    }),
  );

  r.get(
    '/teaching-records/:id',
    authorize('teaching:write', 'teaching:read:all'),
    asyncHandler(async (req, res) => {
      const rec = await TeachingRecordModel.findById(idParam.parse(req.params).id).populate('history.by', 'fullName').lean();
      if (!rec) throw notFound();
      const canViewAll = await hasPermission(req.user!.role, 'teaching:read:all');
      if ((!canViewAll || req.user!.role === 'TEACHER') && String(rec.teacher) !== req.user!.id) throw forbidden();
      res.json({ data: rec });
    }),
  );

  r.post(
    '/teaching-records',
    authorize('teaching:write'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof createBody>;
      const section = await SectionModel.findById(b.section).lean();
      if (!section) throw badRequest('Section not found');
      const academicSession = String(section.academicSession);
      await assertHierarchy({ academicSession, class: String(section.class), section: b.section, subject: b.subject, chapter: b.chapter, topic: b.topic, subtopic: b.subtopic });
      await assertDateInSession(b.date, academicSession);
      let teacher = req.user!.id;
      if (req.user!.role !== 'TEACHER' && b.teacher) {
        const t = await UserModel.findById(b.teacher).lean();
        if (!t || t.role !== 'TEACHER') throw badRequest('Teacher not found');
        teacher = b.teacher;
      }
      await assertTeacherAssigned(teacher, b.section, b.subject);
      const { submit, teacher: _t, ...fields } = b;
      const doc = await TeachingRecordModel.create({
        ...fields,
        academicSession,
        class: section.class,
        teacher,
        state: submit ? 'SUBMITTED' : 'DRAFT',
        submittedAt: submit ? new Date() : undefined,
        history: [{ by: req.user!.id, action: submit ? 'CREATED_AND_SUBMITTED' : 'CREATED_DRAFT' }],
      });
      await audit(req, { action: 'TEACHING_RECORD_CREATED', entityType: 'DailyTeachingRecord', entityId: String(doc._id), academicSession, details: { state: doc.state, chapter: b.chapter } });
      res.status(201).json({ data: doc.toObject() });
    }),
  );

  r.patch(
    '/teaching-records/:id',
    authorize('teaching:write'),
    validate({ body: updateBody }),
    asyncHandler(async (req, res) => {
      const rec = await loadEditable(req);
      const b = req.body as z.infer<typeof updateBody>;
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const academicSession = String(rec.academicSession);
      const chapter = b.chapter ?? String(rec.chapter);
      const topic = b.topic === null ? undefined : (b.topic ?? (rec.topic ? String(rec.topic) : undefined));
      const subtopic = b.subtopic === null ? undefined : (b.subtopic ?? (rec.subtopic ? String(rec.subtopic) : undefined));
      if (subtopic && !topic) throw badRequest('A subtopic requires a topic');
      await assertHierarchy({ academicSession, class: String(rec.class), subject: String(rec.subject), chapter, topic, subtopic });
      if (b.date) await assertDateInSession(b.date, academicSession);
      const record = rec as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(b)) {
        const prev = record[k];
        if (String(prev ?? '') !== String(v ?? '')) changes[k] = { from: prev ?? null, to: v };
        record[k] = v === null ? undefined : v;
      }
      if (!Object.keys(changes).length) return res.json({ data: rec.toObject() });
      rec.history.push({ by: req.user!.id as never, action: 'UPDATED', changes, at: new Date() });
      await rec.save();
      await audit(req, { action: 'TEACHING_RECORD_UPDATED', entityType: 'DailyTeachingRecord', entityId: String(rec._id), academicSession, details: changes });
      res.json({ data: rec.toObject() });
    }),
  );

  r.post(
    '/teaching-records/:id/submit',
    authorize('teaching:write'),
    asyncHandler(async (req, res) => {
      const rec = await loadEditable(req);
      if (rec.state === 'SUBMITTED') throw badRequest('Record is already submitted');
      rec.state = 'SUBMITTED';
      rec.submittedAt = new Date();
      rec.history.push({ by: req.user!.id as never, action: 'SUBMITTED', at: new Date() });
      await rec.save();
      await audit(req, { action: 'TEACHING_RECORD_SUBMITTED', entityType: 'DailyTeachingRecord', entityId: String(rec._id), academicSession: String(rec.academicSession) });
      res.json({ data: rec.toObject() });
    }),
  );

  r.delete(
    '/teaching-records/:id',
    authorize('teaching:write'),
    asyncHandler(async (req, res) => {
      const rec = await loadEditable(req);
      if (rec.state !== 'DRAFT') throw badRequest('Only draft records can be deleted');
      await rec.deleteOne();
      await audit(req, { action: 'TEACHING_RECORD_DRAFT_DELETED', entityType: 'DailyTeachingRecord', entityId: String(rec._id), academicSession: String(rec.academicSession) });
      res.status(204).end();
    }),
  );

  return r;
}
