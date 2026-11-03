import { Router, type Request } from 'express';
import { z } from 'zod';
import { isChapterDelayed } from '@ssms/shared';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/error.middleware';
import { AcademicSessionModel, ClassModel, SectionModel, SubjectModel, TeacherAssignmentModel, TopicModel } from '../../models/academic.models';
import { UserModel } from '../../models/auth.models';
import { CompletionModel, NotificationModel, TeachingRecordModel } from '../../models/planning.models';
import { asyncHandler, badRequest } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import { objectId } from '../common/crud';
import { resolveSessionId } from '../common/integrity';
import { computeUnits, groupSummary, summarizeUnits, type ProgressUnit } from '../progress/progress.service';
import { sendReport, type ReportTable } from './report.format';

type Names = { class: Map<string, string>; section: Map<string, string>; subject: Map<string, string>; user: Map<string, string> };

async function loadNames(): Promise<Names> {
  const [classes, sections, subjects, users] = await Promise.all([
    ClassModel.find().select('name').lean(),
    SectionModel.find().select('name').lean(),
    SubjectModel.find().select('name').lean(),
    UserModel.find().select('fullName').lean(),
  ]);
  const m = (rows: Array<{ _id: unknown; name?: string; fullName?: string }>) => new Map(rows.map((r) => [String(r._id), r.name ?? r.fullName ?? '']));
  return { class: m(classes), section: m(sections), subject: m(subjects), user: m(users) };
}

const dashQuery = z.object({ academicSession: objectId.optional() });

async function scopedUnits(req: Request, academicSession?: string, extra: Partial<{ class: string; section: string; subject: string; teacher: string }> = {}): Promise<{ units: ProgressUnit[]; session: string }> {
  const session = await resolveSessionId(academicSession);
  const teacher = req.user!.role === 'TEACHER' ? req.user!.id : extra.teacher;
  return { session, units: await computeUnits({ academicSession: session, class: extra.class, section: extra.section, subject: extra.subject, teacher }) };
}

export function dashboardRoutes(): Router {
  const r = Router();
  r.use(authenticate);

  r.get(
    '/dashboard',
    authorize('dashboard:read'),
    validate({ query: dashQuery }),
    asyncHandler(async (req, res) => {
      const { academicSession } = req.query as z.infer<typeof dashQuery>;
      const now = new Date();
      const role = req.user!.role;
      const { units, session } = await scopedUnits(req, academicSession);
      const names = await loadNames();
      const overall = summarizeUnits(units, now);
      const bySubject = groupSummary(units, (u) => u.subject, now).map((g) => ({ ...g, name: names.subject.get(g.key) ?? g.key }));
      const byClass = groupSummary(units, (u) => u.class, now).map((g) => ({ ...g, name: names.class.get(g.key) ?? g.key }));
      const delayed = units
        .filter((u) => isChapterDelayed(u, now))
        .slice(0, 20)
        .map((u) => ({ chapter: u.chapterTitle, class: names.class.get(u.class), section: names.section.get(u.section), subject: names.subject.get(u.subject), progress: u.progress, plannedEnd: u.plannedEnd }));

      const today = new Date(now.toISOString().slice(0, 10));
      const recordScope = role === 'TEACHER' ? { teacher: req.user!.id } : {};
      const [pendingApprovals, todayRecords, draftRecords, unread, recent] = await Promise.all([
        role === 'TEACHER'
          ? CompletionModel.countDocuments({ academicSession: session, requestedBy: req.user!.id, status: 'PENDING_APPROVAL' })
          : CompletionModel.countDocuments({ academicSession: session, status: 'PENDING_APPROVAL' }),
        TeachingRecordModel.countDocuments({ academicSession: session, date: today, ...recordScope }),
        role === 'TEACHER' ? TeachingRecordModel.countDocuments({ academicSession: session, teacher: req.user!.id, state: 'DRAFT' }) : Promise.resolve(0),
        NotificationModel.countDocuments({ user: req.user!.id, readAt: null }),
        TeachingRecordModel.find({ academicSession: session, ...recordScope })
          .sort({ date: -1, createdAt: -1 })
          .limit(8)
          .populate('class section subject chapter', 'name title')
          .lean(),
      ]);

      const data: Record<string, unknown> = { role, session, overall, bySubject, byClass, delayed, pendingApprovals, todayRecords, draftRecords, unreadNotifications: unread, recentTeaching: recent };
      if (role === 'TEACHER') {
        data.myAssignments = await TeacherAssignmentModel.countDocuments({ academicSession: session, teacher: req.user!.id, isActive: true });
      } else {
        const [teachers, classes, subjects] = await Promise.all([
          UserModel.countDocuments({ role: 'TEACHER', isActive: true }),
          ClassModel.countDocuments({ academicSession: session, isActive: true }),
          SubjectModel.countDocuments({ isActive: true }),
        ]);
        data.counts = { teachers, classes, subjects };
        if (role === 'SUPER_ADMIN') data.counts = { ...(data.counts as object), users: await UserModel.countDocuments({ isActive: true }) };
        const byTeacher = new Map<string, ProgressUnit[]>();
        for (const u of units) for (const t of u.teachers) byTeacher.set(t, [...(byTeacher.get(t) ?? []), u]);
        data.teacherPerformance = [...byTeacher.entries()]
          .map(([t, list]) => ({ teacher: names.user.get(t) ?? t, ...summarizeUnits(list, now) }))
          .sort((a, b) => a.actual - b.actual)
          .slice(0, 10);
      }
      res.json({ data });
    }),
  );
  return r;
}

const REPORTS = ['daily-teaching', 'teacher-wise', 'class-wise', 'subject-wise', 'chapter-completion', 'monthly', 'annual', 'pending', 'delayed'] as const;
type ReportKind = (typeof REPORTS)[number];

const reportQuery = z.object({
  academicSession: objectId.optional(),
  class: objectId.optional(),
  section: objectId.optional(),
  subject: objectId.optional(),
  teacher: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
});

const pct = (n: number) => Math.round(n * 10) / 10;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');

async function build(kind: ReportKind, req: Request, q: z.infer<typeof reportQuery>): Promise<ReportTable> {
  const names = await loadNames();
  const now = new Date();
  const session = await resolveSessionId(q.academicSession);
  const sessionDoc = await AcademicSessionModel.findById(session).select('name').lean();
  const sub = `Academic session ${sessionDoc?.name ?? ''}`;
  const teacher = req.user!.role === 'TEACHER' ? req.user!.id : q.teacher;
  const unitsFor = () => computeUnits({ academicSession: session, class: q.class, section: q.section, subject: q.subject, teacher });

  const unitRow = (u: ProgressUnit) => [
    names.class.get(u.class) ?? '',
    names.section.get(u.section) ?? '',
    names.subject.get(u.subject) ?? '',
    u.chapterTitle,
    u.teachers.map((t) => names.user.get(t) ?? '').join(', '),
    pct(u.progress),
    u.completionStatus ?? 'NOT_REQUESTED',
    day(u.plannedEnd),
  ];
  const unitCols = ['Class', 'Section', 'Subject', 'Chapter', 'Teacher', 'Progress %', 'Completion', 'Planned end'];

  switch (kind) {
    case 'daily-teaching': {
      const from = q.from ?? new Date(now.getTime() - 30 * 86_400_000);
      const to = q.to ?? now;
      const filter: Record<string, unknown> = { academicSession: session, date: { $gte: from, $lte: to } };
      if (q.class) filter.class = q.class;
      if (q.section) filter.section = q.section;
      if (q.subject) filter.subject = q.subject;
      if (teacher) filter.teacher = teacher;
      const rows = await TeachingRecordModel.find(filter).sort({ date: 1, periodNumber: 1 }).limit(5000).lean();
      const topics = new Map((await TopicModel.find({ _id: { $in: rows.map((x) => x.topic).filter(Boolean) } }).select('title').lean()).map((t) => [String(t._id), t.title]));
      return {
        title: 'Daily Teaching Report',
        subtitle: `${sub} · ${day(from)} to ${day(to)}`,
        columns: ['Date', 'Class', 'Section', 'Subject', 'Teacher', 'Period', 'Topic', 'Status', 'State', 'Remarks'],
        rows: rows.map((x) => [day(x.date), names.class.get(String(x.class)) ?? '', names.section.get(String(x.section)) ?? '', names.subject.get(String(x.subject)) ?? '', names.user.get(String(x.teacher)) ?? '', x.periodNumber, x.topic ? (topics.get(String(x.topic)) ?? '') : '', x.teachingStatus, x.state, x.remarks]),
      };
    }
    case 'teacher-wise': {
      const units = await unitsFor();
      const by = new Map<string, ProgressUnit[]>();
      for (const u of units) for (const t of u.teachers) if (!teacher || t === teacher) by.set(t, [...(by.get(t) ?? []), u]);
      return {
        title: 'Teacher-wise Progress Report',
        subtitle: sub,
        columns: ['Teacher', 'Chapters', 'Completed', 'Delayed', 'Planned %', 'Actual %'],
        rows: [...by.entries()].map(([t, l]) => {
          const s = summarizeUnits(l, now);
          return [names.user.get(t) ?? t, s.chapters, s.completedChapters,           s.delayedChapters, pct(s.planned), pct(s.actual)];
        }),
      };
    }
    case 'class-wise':
    case 'subject-wise': {
      const units = await unitsFor();
      const byClass = kind === 'class-wise';
      const map = byClass ? names.class : names.subject;
      return {
        title: byClass ? 'Class-wise Progress Report' : 'Subject-wise Progress Report',
        subtitle: sub,
        columns: [byClass ? 'Class' : 'Subject', 'Chapters', 'Completed', 'Delayed', 'Planned %', 'Actual %'],
        rows: groupSummary(units, (u) => (byClass ? u.class : u.subject), now).map((g) => [map.get(g.key) ?? g.key, g.chapters, g.completedChapters, g.delayedChapters, pct(g.planned), pct(g.actual)]),
      };
    }
    case 'chapter-completion':
      return { title: 'Chapter Completion Report', subtitle: sub, columns: unitCols, rows: (await unitsFor()).map(unitRow) };
    case 'pending':
      return { title: 'Pending Chapters Report', subtitle: sub, columns: unitCols, rows: (await unitsFor()).filter((u) => !u.isCompleted).map(unitRow) };
    case 'delayed':
      return { title: 'Delayed Chapters Report', subtitle: sub, columns: unitCols, rows: (await unitsFor()).filter((u) => isChapterDelayed(u, now)).map(unitRow) };
    case 'monthly': {
      if (!q.month) throw badRequest('month (YYYY-MM) is required for the monthly report');
      const start = new Date(`${q.month}-01T00:00:00.000Z`);
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      const filter: Record<string, unknown> = { academicSession: session, date: { $gte: start, $lte: end }, state: 'SUBMITTED' };
      if (q.class) filter.class = q.class;
      if (q.section) filter.section = q.section;
      if (q.subject) filter.subject = q.subject;
      if (teacher) filter.teacher = teacher;
      const rows = await TeachingRecordModel.find(filter).select('class section subject teachingStatus').lean();
      const agg = new Map<string, { class: string; section: string; subject: string; completed: number; partial: number; notTaught: number }>();
      for (const x of rows) {
        const k = `${x.section}|${x.subject}`;
        const e = agg.get(k) ?? { class: String(x.class), section: String(x.section), subject: String(x.subject), completed: 0, partial: 0, notTaught: 0 };
        if (x.teachingStatus === 'COMPLETED') e.completed += 1;
        else if (x.teachingStatus === 'PARTIAL') e.partial += 1;
        else e.notTaught += 1;
        agg.set(k, e);
      }
      return {
        title: 'Monthly Syllabus Report',
        subtitle: `${sub} · ${q.month}`,
        columns: ['Class', 'Section', 'Subject', 'Periods', 'Completed', 'Partial', 'Not taught'],
        rows: [...agg.values()].map((e) => [names.class.get(e.class) ?? '', names.section.get(e.section) ?? '', names.subject.get(e.subject) ?? '', e.completed + e.partial + e.notTaught, e.completed, e.partial, e.notTaught]),
      };
    }
    case 'annual': {
      const units = await unitsFor();
      const by = new Map<string, ProgressUnit[]>();
      for (const u of units) by.set(`${u.section}|${u.subject}`, [...(by.get(`${u.section}|${u.subject}`) ?? []), u]);
      return {
        title: 'Annual Syllabus Report',
        subtitle: sub,
        columns: ['Class', 'Section', 'Subject', 'Chapters', 'Completed', 'Delayed', 'Planned %', 'Actual %'],
        rows: [...by.values()].map((l) => {
          const f = l[0]!;
          const s = summarizeUnits(l, now);
          return [names.class.get(f.class) ?? '', names.section.get(f.section) ?? '', names.subject.get(f.subject) ?? '', s.chapters, s.completedChapters,           s.delayedChapters, pct(s.planned), pct(s.actual)];
        }),
      };
    }
  }
}

export function reportRoutes(): Router {
  const r = Router();
  r.use(authenticate);
  r.get(
    '/reports/:kind',
    authorize('reports:read'),
    validate({ query: reportQuery }),
    asyncHandler(async (req, res) => {
      const kind = z.enum(REPORTS).safeParse(req.params.kind);
      if (!kind.success) throw badRequest(`Unknown report. Available: ${REPORTS.join(', ')}`);
      const q = req.query as unknown as z.infer<typeof reportQuery>;
      const table = await build(kind.data, req, q);
      if (q.format !== 'json') await audit(req, { action: 'REPORT_EXPORTED', entityType: 'Report', details: { kind: kind.data, format: q.format } });
      await sendReport(res, table, q.format, kind.data);
    }),
  );
  return r;
}
