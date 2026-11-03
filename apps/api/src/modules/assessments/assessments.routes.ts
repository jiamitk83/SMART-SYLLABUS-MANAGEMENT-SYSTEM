import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/error.middleware';
import { ChapterModel, SectionModel, TeacherAssignmentModel } from '../../models/academic.models';
import { ActivityModel, AssessmentModel } from '../../models/planning.models';
import { asyncHandler, badRequest, notFound } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import { idParam, objectId, parsePage } from '../common/crud';
import { assertTeacherAssigned } from '../common/integrity';

const result = z.object({
  rollNo: z.string().trim().min(1).max(30),
  studentName: z.string().trim().min(1).max(120),
  marksObtained: z.number().min(0).optional(),
  outcome: z.string().trim().max(200).optional(),
});

const createBody = z.object({
  type: z.enum(['WORKSHEET', 'TEST']),
  title: z.string().trim().min(2).max(200),
  section: objectId,
  subject: objectId,
  chapters: z.array(objectId).min(1).max(30),
  date: z.coerce.date(),
  maxMarks: z.number().min(0).max(1000).default(0),
  passMarks: z.number().min(0).max(1000).default(0),
  status: z.enum(['PLANNED', 'CONDUCTED']).default('PLANNED'),
});
const updateBody = z
  .object({
    title: createBody.shape.title,
    date: createBody.shape.date,
    maxMarks: createBody.shape.maxMarks,
    passMarks: createBody.shape.passMarks,
    status: createBody.shape.status,
    chapters: createBody.shape.chapters,
  })
  .partial();
const resultsBody = z.object({ results: z.array(result).min(1).max(300) });
const listQuery = z.object({
  academicSession: objectId.optional(),
  class: objectId.optional(),
  section: objectId.optional(),
  subject: objectId.optional(),
  chapter: objectId.optional(),
  type: z.enum(['WORKSHEET', 'TEST']).optional(),
  status: z.enum(['PLANNED', 'CONDUCTED']).optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

function summarize(a: { maxMarks: number; passMarks: number; results: Array<{ marksObtained?: number | null }> }) {
  const marks = a.results.map((x) => x.marksObtained).filter((m): m is number => typeof m === 'number');
  if (!marks.length) return { students: a.results.length, graded: 0, average: 0, highest: 0, lowest: 0, passPercent: 0 };
  const sum = marks.reduce((s, m) => s + m, 0);
  const passed = marks.filter((m) => m >= a.passMarks).length;
  return {
    students: a.results.length,
    graded: marks.length,
    average: Math.round((sum / marks.length) * 100) / 100,
    highest: Math.max(...marks),
    lowest: Math.min(...marks),
    passPercent: Math.round((passed / marks.length) * 10000) / 100,
  };
}

/** A conducted worksheet/test marks the matching activity 100% for every mapped chapter. */
async function syncActivities(
  a: { _id: unknown; type: 'WORKSHEET' | 'TEST'; academicSession: unknown; class: unknown; section: unknown; subject: unknown; chapters: unknown[] },
  userId: string,
): Promise<void> {
  for (const chapter of a.chapters) {
    await ActivityModel.updateOne(
      { section: a.section, chapter, activityType: a.type },
      {
        $set: { academicSession: a.academicSession, class: a.class, subject: a.subject, applicable: true, percent: 100, notes: 'Recorded via assessment', updatedBy: userId },
        $push: { history: { by: userId, applicable: true, percent: 100 } },
      },
      { upsert: true },
    );
  }
}

async function scope(req: Request): Promise<Record<string, unknown>> {
  if (req.user!.role !== 'TEACHER') return {};
  const rows = await TeacherAssignmentModel.find({ teacher: req.user!.id, isActive: true }).select('section subject').lean();
  return rows.length ? { $or: rows.map((a) => ({ section: a.section, subject: a.subject })) } : { _id: null };
}

export function assessmentRoutes(): Router {
  const r = Router();
  r.use(authenticate);

  r.get(
    '/assessments',
    authorize('assessments:read'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as z.infer<typeof listQuery>;
      const user: Record<string, unknown> = {};
      for (const k of ['academicSession', 'class', 'section', 'subject', 'type', 'status'] as const) if (q[k]) user[k] = q[k];
      if (q.chapter) user.chapters = q.chapter;
      const filter = { $and: [await scope(req), user] };
      const { page, pageSize, skip } = parsePage(q);
      const [rows, total] = await Promise.all([
        AssessmentModel.find(filter).populate('class section subject', 'name').populate('chapters', 'title').sort({ date: -1 }).skip(skip).limit(pageSize).lean(),
        AssessmentModel.countDocuments(filter),
      ]);
      res.json({ data: rows.map((a) => ({ ...a, summary: summarize(a) })), meta: { page, pageSize, total } });
    }),
  );

  r.get(
    '/assessments/:id',
    authorize('assessments:read'),
    asyncHandler(async (req, res) => {
      const a = await AssessmentModel.findOne({ $and: [await scope(req), { _id: idParam.parse(req.params).id }] })
        .populate('class section subject', 'name')
        .populate('chapters', 'title')
        .lean();
      if (!a) throw notFound();
      res.json({ data: { ...a, summary: summarize(a) } });
    }),
  );

  r.post(
    '/assessments',
    authorize('assessments:manage'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof createBody>;
      const section = await SectionModel.findById(b.section).lean();
      if (!section) throw badRequest('Section not found');
      const chapters = await ChapterModel.find({ _id: { $in: b.chapters } }).lean();
      if (chapters.length !== new Set(b.chapters).size) throw badRequest('Some chapters were not found');
      if (chapters.some((c) => String(c.subject) !== b.subject || String(c.class) !== String(section.class))) {
        throw badRequest('Chapters must belong to the section class and the subject');
      }
      if (req.user!.role === 'TEACHER') await assertTeacherAssigned(req.user!.id, b.section, b.subject);
      const doc = await AssessmentModel.create({ ...b, academicSession: section.academicSession, class: section.class, createdBy: req.user!.id });
      if (doc.status === 'CONDUCTED') await syncActivities(doc.toObject(), req.user!.id);
      await audit(req, { action: 'ASSESSMENT_CREATED', entityType: 'Assessment', entityId: String(doc._id), academicSession: String(section.academicSession), details: { type: b.type, title: b.title } });
      res.status(201).json({ data: doc.toObject() });
    }),
  );

  const loadOwned = async (req: Request) => {
    const a = await AssessmentModel.findById(idParam.parse(req.params).id);
    if (!a) throw notFound();
    if (req.user!.role === 'TEACHER') await assertTeacherAssigned(req.user!.id, String(a.section), String(a.subject));
    return a;
  };

  r.patch(
    '/assessments/:id',
    authorize('assessments:manage'),
    validate({ body: updateBody }),
    asyncHandler(async (req, res) => {
      const a = await loadOwned(req);
      const b = req.body as z.infer<typeof updateBody>;
      if (b.chapters) {
        const chapters = await ChapterModel.find({ _id: { $in: b.chapters } }).lean();
        if (chapters.length !== new Set(b.chapters).size || chapters.some((c) => String(c.subject) !== String(a.subject) || String(c.class) !== String(a.class))) {
          throw badRequest('Chapters must belong to the assessment class and subject');
        }
      }
      a.set(b);
      await a.save();
      if (a.status === 'CONDUCTED') await syncActivities(a.toObject(), req.user!.id);
      await audit(req, { action: 'ASSESSMENT_UPDATED', entityType: 'Assessment', entityId: String(a._id), academicSession: String(a.academicSession), details: b });
      res.json({ data: a.toObject() });
    }),
  );

  r.put(
    '/assessments/:id/results',
    authorize('assessments:manage'),
    validate({ body: resultsBody }),
    asyncHandler(async (req, res) => {
      const a = await loadOwned(req);
      const { results } = req.body as z.infer<typeof resultsBody>;
      if (a.maxMarks > 0 && results.some((x) => (x.marksObtained ?? 0) > a.maxMarks)) throw badRequest('Marks cannot exceed the maximum marks');
      if (new Set(results.map((x) => x.rollNo)).size !== results.length) throw badRequest('Duplicate roll numbers');
      a.results.splice(0, a.results.length, ...results);
      a.status = 'CONDUCTED';
      await a.save();
      await syncActivities(a.toObject(), req.user!.id);
      await audit(req, { action: 'ASSESSMENT_RESULTS_RECORDED', entityType: 'Assessment', entityId: String(a._id), academicSession: String(a.academicSession), details: { count: results.length } });
      res.json({ data: { ...a.toObject(), summary: summarize(a.toObject()) } });
    }),
  );

  return r;
}
