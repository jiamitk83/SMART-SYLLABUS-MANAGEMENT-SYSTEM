import { Router, type Request } from 'express';
import type { Model } from 'mongoose';
import { z } from 'zod';
import { CHAPTER_IMPORTANCE } from '@ssms/shared';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/error.middleware';
import {
  ChapterModel,
  ClassModel,
  SubjectModel,
  SubtopicModel,
  SyllabusVersionModel,
  TeacherAssignmentModel,
  TopicModel,
} from '../../models/academic.models';
import { asyncHandler, badRequest, forbidden, notFound } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import { createCrudRouter, objectId, type Doc } from '../common/crud';
import { resolveSessionId } from '../common/integrity';
import { buildTree, copySyllabus, importTree, recordVersion } from './syllabus.service';

type M = Model<Record<string, unknown>>;
const asModel = (m: unknown): M => m as M;

const importance = z.enum(CHAPTER_IMPORTANCE);
const chapterCreate = z.object({
  academicSession: objectId.optional(),
  class: objectId,
  subject: objectId,
  title: z.string().trim().min(1).max(200),
  order: z.number().int().min(1).optional(),
  estimatedPeriods: z.number().min(0).max(500).optional(),
  importance: importance.optional(),
  weight: z.number().min(0).max(1000).optional(),
});
const chapterUpdate = z
  .object({
    title: z.string().trim().min(1).max(200),
    order: z.number().int().min(1),
    estimatedPeriods: z.number().min(0).max(500),
    importance,
    weight: z.number().min(0).max(1000),
  })
  .partial();
const topicCreate = z.object({
  chapter: objectId,
  title: z.string().trim().min(1).max(200),
  order: z.number().int().min(1).optional(),
  estimatedPeriods: z.number().min(0).max(100).optional(),
});
const topicUpdate = z.object({ title: z.string().trim().min(1).max(200), order: z.number().int().min(1), estimatedPeriods: z.number().min(0).max(100) }).partial();
const subtopicCreate = z.object({ topic: objectId, title: z.string().trim().min(1).max(200), order: z.number().int().min(1).optional() });
const subtopicUpdate = z.object({ title: z.string().trim().min(1).max(200), order: z.number().int().min(1) }).partial();

const importBody = z.object({
  academicSession: objectId.optional(),
  class: objectId,
  subject: objectId,
  chapters: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        order: z.number().int().min(1).optional(),
        estimatedPeriods: z.number().min(0).optional(),
        importance: importance.optional(),
        weight: z.number().min(0).optional(),
        topics: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(200),
              estimatedPeriods: z.number().min(0).optional(),
              subtopics: z.array(z.object({ title: z.string().trim().min(1).max(200) })).optional(),
            }),
          )
          .optional(),
      }),
    )
    .min(1)
    .max(300),
});

const treeQuery = z.object({ academicSession: objectId.optional(), class: objectId, subject: objectId });

async function teacherPairs(req: Request): Promise<Array<{ class: unknown; subject: unknown }> | null> {
  if (req.user?.role !== 'TEACHER') return null;
  const rows = await TeacherAssignmentModel.find({ teacher: req.user.id, isActive: true }).select('class subject').lean();
  return rows.map((a) => ({ class: a.class, subject: a.subject }));
}

async function assertSyllabusReadable(req: Request, cls: string, subject: string): Promise<void> {
  const pairs = await teacherPairs(req);
  if (pairs && !pairs.some((p) => String(p.class) === cls && String(p.subject) === subject)) {
    throw forbidden('You are not assigned to this class and subject');
  }
}

async function nextOrder(model: M, filter: Record<string, unknown>): Promise<number> {
  const last = (await model.findOne(filter).sort({ order: -1 }).select('order').lean()) as { order?: number } | null;
  return (last?.order ?? 0) + 1;
}

async function versionForChapter(req: Request, chapterId: unknown, reason: string): Promise<void> {
  const ch = await ChapterModel.findById(String(chapterId)).lean();
  if (ch) await recordVersion(String(ch.academicSession), String(ch.class), String(ch.subject), req.user?.id, reason);
}

export function syllabusRoutes(): Router {
  const r = Router();

  r.get(
    '/syllabus/tree',
    authenticate,
    authorize('syllabus:read'),
    validate({ query: treeQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as z.infer<typeof treeQuery>;
      await assertSyllabusReadable(req, q.class, q.subject);
      const session = await resolveSessionId(q.academicSession);
      res.json({ data: await buildTree(session, q.class, q.subject) });
    }),
  );

  r.get(
    '/syllabus/export',
    authenticate,
    authorize('syllabus:read'),
    validate({ query: treeQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as z.infer<typeof treeQuery>;
      await assertSyllabusReadable(req, q.class, q.subject);
      const session = await resolveSessionId(q.academicSession);
      const tree = await buildTree(session, q.class, q.subject);
      res.setHeader('Content-Disposition', 'attachment; filename="syllabus.json"');
      res.json({
        chapters: tree.map((c) => ({
          title: c.title,
          order: c.order,
          estimatedPeriods: c.estimatedPeriods,
          importance: c.importance,
          weight: c.weight,
          topics: c.topics.map((t) => ({ title: t.title, estimatedPeriods: t.estimatedPeriods, subtopics: t.subtopics.map((s) => ({ title: s.title })) })),
        })),
      });
    }),
  );

  r.post(
    '/syllabus/import',
    authenticate,
    authorize('syllabus:manage'),
    validate({ body: importBody }),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof importBody>;
      const session = await resolveSessionId(b.academicSession);
      const [cls, subj] = await Promise.all([ClassModel.findById(b.class).lean(), SubjectModel.findById(b.subject).lean()]);
      if (!cls || String(cls.academicSession) !== session) throw badRequest('Class does not belong to the academic session');
      if (!subj) throw badRequest('Subject not found');
      const report = await importTree(session, b.class, b.subject, b.chapters);
      if (report.chaptersCreated || report.topicsCreated || report.subtopicsCreated) {
        await recordVersion(session, b.class, b.subject, req.user?.id, 'Syllabus import');
      }
      await audit(req, { action: 'SYLLABUS_IMPORTED', entityType: 'Syllabus', academicSession: session, details: report });
      res.status(201).json(report);
    }),
  );

  r.post(
    '/syllabus/copy',
    authenticate,
    authorize('syllabus:manage'),
    validate({ body: z.object({ fromSession: objectId, toSession: objectId, class: objectId.optional(), subject: objectId.optional() }) }),
    asyncHandler(async (req, res) => {
      const b = req.body as { fromSession: string; toSession: string; class?: string; subject?: string };
      const report = await copySyllabus(b.fromSession, b.toSession, { classId: b.class, subjectId: b.subject }, req.user?.id);
      await audit(req, { action: 'SYLLABUS_COPIED', entityType: 'Syllabus', academicSession: b.toSession, details: { ...b, ...report } });
      res.status(201).json(report);
    }),
  );

  r.get(
    '/syllabus/versions',
    authenticate,
    authorize('syllabus:read'),
    validate({ query: treeQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as z.infer<typeof treeQuery>;
      await assertSyllabusReadable(req, q.class, q.subject);
      const session = await resolveSessionId(q.academicSession);
      const data = await SyllabusVersionModel.find({ academicSession: session, class: q.class, subject: q.subject })
        .sort({ version: -1 })
        .limit(50)
        .populate('changedBy', 'fullName')
        .lean();
      res.json({ data });
    }),
  );

  r.post(
    '/chapters/reorder',
    authenticate,
    authorize('syllabus:manage'),
    validate({ body: z.object({ ids: z.array(objectId).min(1).max(500) }) }),
    asyncHandler(async (req, res) => {
      const { ids } = req.body as { ids: string[] };
      const chapters = await ChapterModel.find({ _id: { $in: ids } }).lean();
      if (chapters.length !== ids.length) throw notFound('Some chapters were not found');
      const first = chapters[0]!;
      if (chapters.some((c) => String(c.class) !== String(first.class) || String(c.subject) !== String(first.subject) || String(c.academicSession) !== String(first.academicSession))) {
        throw badRequest('All chapters must belong to the same class, subject and session');
      }
      await ChapterModel.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: i + 1 } } } })));
      await recordVersion(String(first.academicSession), String(first.class), String(first.subject), req.user?.id, 'Chapters reordered');
      await audit(req, { action: 'CHAPTERS_REORDERED', entityType: 'Chapter', academicSession: String(first.academicSession), details: { ids } });
      res.status(204).end();
    }),
  );

  r.post(
    '/topics/reorder',
    authenticate,
    authorize('syllabus:manage'),
    validate({ body: z.object({ ids: z.array(objectId).min(1).max(500) }) }),
    asyncHandler(async (req, res) => {
      const { ids } = req.body as { ids: string[] };
      const topics = await TopicModel.find({ _id: { $in: ids } }).lean();
      if (topics.length !== ids.length) throw notFound('Some topics were not found');
      if (new Set(topics.map((t) => String(t.chapter))).size !== 1) throw badRequest('All topics must belong to the same chapter');
      await TopicModel.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: i + 1 } } } })));
      await versionForChapter(req, topics[0]!.chapter, 'Topics reordered');
      res.status(204).end();
    }),
  );

  const scopeByAssignment = async (req: Request): Promise<Record<string, unknown>> => {
    const pairs = await teacherPairs(req);
    if (!pairs) return {};
    if (!pairs.length) return { _id: null };
    return { $or: pairs.map((p) => ({ class: p.class, subject: p.subject })) };
  };

  const scopeChildren = async (req: Request): Promise<Record<string, unknown>> => {
    const pairs = await teacherPairs(req);
    if (!pairs) return {};
    const chapters = pairs.length
      ? await ChapterModel.find({ $or: pairs.map((p) => ({ class: p.class, subject: p.subject })) }).select('_id').lean()
      : [];
    return { chapter: { $in: chapters.map((c) => c._id) } };
  };

  r.use(
    '/chapters',
    createCrudRouter({
      entity: 'Chapter',
      model: asModel(ChapterModel),
      read: 'syllabus:read',
      write: 'syllabus:manage',
      createSchema: chapterCreate,
      updateSchema: chapterUpdate,
      searchFields: ['title'],
      filterFields: ['academicSession', 'class', 'subject', 'isActive'],
      populate: [{ path: 'subject', select: 'name code' }],
      sort: { order: 1 },
      hooks: {
        scope: scopeByAssignment,
        async beforeCreate(data) {
          const session = await resolveSessionId(data.academicSession);
          const cls = await ClassModel.findById(String(data.class)).lean();
          if (!cls || String(cls.academicSession) !== session) throw badRequest('Class does not belong to the academic session');
          if (!(await SubjectModel.exists({ _id: String(data.subject) }))) throw badRequest('Subject not found');
          const order = (data.order as number | undefined) ?? (await nextOrder(asModel(ChapterModel), { academicSession: session, class: data.class, subject: data.subject }));
          return { ...data, academicSession: session, order };
        },
        async afterChange(doc: Doc, req, kind) {
          await recordVersion(String(doc.academicSession), String(doc.class), String(doc.subject), req.user?.id, `Chapter ${kind}`);
        },
      },
    }),
  );

  r.use(
    '/topics',
    createCrudRouter({
      entity: 'Topic',
      model: asModel(TopicModel),
      read: 'syllabus:read',
      write: 'syllabus:manage',
      createSchema: topicCreate,
      updateSchema: topicUpdate,
      searchFields: ['title'],
      filterFields: ['chapter', 'academicSession', 'isActive'],
      sort: { order: 1 },
      hooks: {
        scope: scopeChildren,
        async beforeCreate(data) {
          const chapter = await ChapterModel.findById(String(data.chapter)).lean();
          if (!chapter) throw badRequest('Chapter not found');
          const order = (data.order as number | undefined) ?? (await nextOrder(asModel(TopicModel), { chapter: data.chapter }));
          return { ...data, academicSession: chapter.academicSession, order };
        },
        async afterChange(doc, req, kind) {
          await versionForChapter(req, doc.chapter, `Topic ${kind}`);
        },
      },
    }),
  );

  r.use(
    '/subtopics',
    createCrudRouter({
      entity: 'Subtopic',
      model: asModel(SubtopicModel),
      read: 'syllabus:read',
      write: 'syllabus:manage',
      createSchema: subtopicCreate,
      updateSchema: subtopicUpdate,
      searchFields: ['title'],
      filterFields: ['topic', 'chapter', 'academicSession', 'isActive'],
      sort: { order: 1 },
      hooks: {
        scope: scopeChildren,
        async beforeCreate(data) {
          const topic = await TopicModel.findById(String(data.topic)).lean();
          if (!topic) throw badRequest('Topic not found');
          const order = (data.order as number | undefined) ?? (await nextOrder(asModel(SubtopicModel), { topic: data.topic }));
          return { ...data, academicSession: topic.academicSession, chapter: topic.chapter, order };
        },
        async afterChange(doc, req, kind) {
          await versionForChapter(req, doc.chapter, `Subtopic ${kind}`);
        },
      },
    }),
  );

  return r;
}
