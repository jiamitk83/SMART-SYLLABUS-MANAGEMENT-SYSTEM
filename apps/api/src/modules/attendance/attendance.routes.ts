import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  ATTENDANCE_REASON_MIN_LENGTH,
  ATTENDANCE_STATUSES,
  buildMonthlyRegister,
  isLowAttendance,
  isNonWorkingDay,
  monthDates,
  monthsBetween,
  summarizeAttendance,
  type AttendanceStatus,
  type RegisterState,
} from '@ssms/shared';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/error.middleware';
import { AcademicSessionModel, ClassModel, SectionModel } from '../../models/academic.models';
import {
  AttendanceHistoryModel,
  AttendanceRecordModel,
  AttendanceRegisterModel,
  HolidayModel,
  StudentModel,
} from '../../models/attendance.models';
import { SettingModel } from '../../models/planning.models';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import { hasPermission } from '../auth/permissions.service';
import { escapeRegex, idParam, objectId, parsePage } from '../common/crud';
import { resolveSessionId } from '../common/integrity';
import {
  SETTINGS_KEY,
  allowedSectionIds,
  assertSectionAccess,
  countsByStudent,
  dateString,
  getAttendanceSettings,
  holidaySet,
  monthString,
  rosterFor,
  sectionIdsForQuery,
  sessionRange,
  summaryFromCounts,
  todayString,
  type SectionCtx,
} from './attendance.service';

const isDup = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;

const studentFields = {
  rollNumber: z.string().trim().min(1).max(20),
  admissionNumber: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  guardianName: z.string().trim().max(120).optional(),
  guardianPhone: z.string().trim().max(20).optional(),
};
const studentCreate = z.object({ section: objectId, ...studentFields });
const studentPatch = z.object({
  section: objectId.optional(),
  rollNumber: studentFields.rollNumber.optional(),
  name: studentFields.name.optional(),
  gender: studentFields.gender,
  guardianName: studentFields.guardianName,
  guardianPhone: studentFields.guardianPhone,
  isActive: z.boolean().optional(),
});
const studentBulk = z.object({ section: objectId, students: z.array(z.object(studentFields)).min(1).max(200) });

const markBody = z.object({
  section: objectId,
  date: dateString,
  entries: z.array(z.object({ student: objectId, status: z.enum(ATTENDANCE_STATUSES) })).min(1).max(500),
  reason: z.string().trim().max(500).optional(),
  submit: z.boolean().optional(),
});

const holidayBody = z.object({
  academicSession: objectId.optional(),
  date: dateString,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

const settingsBody = z.object({
  lowThreshold: z.number().min(1).max(100),
  weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(6),
  leaveExcluded: z.boolean(),
  schoolName: z.string().trim().min(1).max(150),
  logoDataUrl: z
    .string()
    .max(400_000)
    .refine((v) => v === '' || /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v), 'Logo must be a PNG or JPEG image'),
});

const sectionDate = z.object({ section: objectId, date: dateString });
const sectionMonth = z.object({ section: objectId, month: monthString });
const lockBody = z.object({ section: objectId, date: dateString.optional(), month: monthString.optional(), reason: z.string().trim().max(500).optional() });

const CAP_PERMS = ['attendance:mark', 'attendance:correct', 'attendance:lock', 'attendance:manage'] as const;

async function actorHas(req: Request, perm: Parameters<typeof hasPermission>[1]): Promise<boolean> {
  return hasPermission(req.user!.role, perm);
}

async function statusMap(sectionId: string, date: string): Promise<Map<string, AttendanceStatus>> {
  const rows = await AttendanceRecordModel.find({ section: sectionId, date }).select('student status').lean();
  return new Map(rows.map((r) => [String(r.student), r.status as AttendanceStatus]));
}

async function buildSheet(ctx: SectionCtx, date: string) {
  const [roster, statuses, register, settings, holidays, range] = await Promise.all([
    rosterFor(ctx.id, date, date),
    statusMap(ctx.id, date),
    AttendanceRegisterModel.findOne({ section: ctx.id, date }).lean(),
    getAttendanceSettings(),
    holidaySet(ctx.academicSession, date, date),
    sessionRange(ctx.academicSession),
  ]);
  const students = roster.map((s) => ({ ...s, status: statuses.get(s.id) ?? null }));
  const summary = { present: 0, absent: 0, leave: 0, unmarked: 0, total: students.length };
  for (const s of students) {
    if (s.status === 'PRESENT') summary.present += 1;
    else if (s.status === 'ABSENT') summary.absent += 1;
    else if (s.status === 'LEAVE') summary.leave += 1;
    else summary.unmarked += 1;
  }
  const holiday = holidays.has(date);
  const nonWorking = isNonWorkingDay(date, holidays, settings.weeklyOffDays);
  return {
    section: { id: ctx.id, name: ctx.name, classId: ctx.classId, className: ctx.className },
    date,
    state: (register?.state ?? 'NOT_STARTED') as RegisterState | 'NOT_STARTED',
    nonWorking,
    holiday,
    inSession: date >= range.from && date <= range.to,
    students,
    summary,
  };
}

export function attendanceRoutes(): Router {
  const r = Router();
  r.use(authenticate);
  const read = authorize('attendance:read');

  // ---------- Scope ----------
  r.get(
    '/attendance/scope',
    read,
    validate({ query: z.object({ academicSession: objectId.optional() }) }),
    asyncHandler(async (req, res) => {
      const academicSession = await resolveSessionId((req.query as { academicSession?: string }).academicSession);
      const allowed = await allowedSectionIds(req, academicSession);
      const sections = await SectionModel.find({ academicSession, isActive: true, ...(allowed === 'ALL' ? {} : { _id: { $in: [...allowed] } }) }).lean();
      const classes = await ClassModel.find({ _id: { $in: [...new Set(sections.map((s) => String(s.class)))] } }).lean();
      const caps: Record<string, boolean> = {};
      for (const p of CAP_PERMS) caps[p.split(':')[1]!] = await actorHas(req, p);
      res.json({
        data: {
          academicSession,
          schoolWide: allowed === 'ALL',
          classes: classes.map((c) => ({ id: String(c._id), name: c.name })),
          sections: sections.map((s) => ({ id: String(s._id), name: s.name, classId: String(s.class) })),
          capabilities: caps,
        },
      });
    }),
  );

  // ---------- Students ----------
  r.get(
    '/attendance/students',
    read,
    validate({
      query: z.object({
        academicSession: objectId.optional(),
        class: objectId.optional(),
        section: objectId.optional(),
        q: z.string().trim().max(100).optional(),
        active: z.enum(['true', 'false', 'all']).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const q = req.query as { academicSession?: string; class?: string; section?: string; q?: string; active?: string };
      const ids = await sectionIdsForQuery(req, q);
      const filter: Record<string, unknown> = { section: { $in: ids } };
      if (q.active !== 'all') filter.isActive = q.active !== 'false';
      if (q.q) {
        const rx = new RegExp(escapeRegex(q.q), 'i');
        filter.$or = [{ name: rx }, { admissionNumber: rx }, { rollNumber: rx }];
      }
      const page = parsePage(req.query as Record<string, unknown>);
      const [items, total] = await Promise.all([
        StudentModel.find(filter).sort({ section: 1, rollNumber: 1 }).collation({ locale: 'en', numericOrdering: true }).skip(page.skip).limit(page.pageSize).lean(),
        StudentModel.countDocuments(filter),
      ]);
      res.json({ data: items, total, page: page.page, pageSize: page.pageSize });
    }),
  );

  const createStudent = async (req: Request, input: z.infer<typeof studentCreate>) => {
    const ctx = await loadSectionStrict(input.section);
    if (await StudentModel.exists({ section: input.section, isActive: true, rollNumber: input.rollNumber }))
      throw conflict(`Roll number ${input.rollNumber} is already used in this section`);
    try {
      return await StudentModel.create({ ...input, academicSession: ctx.academicSession, class: ctx.classId });
    } catch (e) {
      if (isDup(e)) throw conflict(`Admission number ${input.admissionNumber} already exists`);
      throw e;
    }
  };

  r.post(
    '/attendance/students',
    authorize('attendance:manage'),
    validate({ body: studentCreate }),
    asyncHandler(async (req, res) => {
      const doc = await createStudent(req, req.body);
      await audit(req, { action: 'STUDENT_CREATED', entityType: 'Student', entityId: String(doc._id), academicSession: String(doc.academicSession) });
      res.status(201).json({ data: doc });
    }),
  );

  r.post(
    '/attendance/students/bulk',
    authorize('attendance:manage'),
    validate({ body: studentBulk }),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof studentBulk>;
      const created: string[] = [];
      const skipped: Array<{ admissionNumber: string; reason: string }> = [];
      for (const s of body.students) {
        try {
          const doc = await createStudent(req, { section: body.section, ...s });
          created.push(String(doc._id));
        } catch (e) {
          skipped.push({ admissionNumber: s.admissionNumber, reason: e instanceof Error ? e.message : 'Failed' });
        }
      }
      await audit(req, { action: 'STUDENTS_BULK_CREATED', entityType: 'Student', details: { created: created.length, skipped: skipped.length } });
      res.status(201).json({ data: { created: created.length, skipped } });
    }),
  );

  r.patch(
    '/attendance/students/:id',
    authorize('attendance:manage'),
    validate({ body: studentPatch }),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof studentPatch>;
      const doc = await StudentModel.findById(idParam.parse(req.params).id);
      if (!doc) throw notFound('Student not found');
      const { section, ...rest } = body;
      if (section && String(doc.section) !== section) {
        const ctx = await loadSectionStrict(section);
        doc.sectionHistory.push({ section: doc.section, rollNumber: doc.rollNumber, from: new Date(), by: req.user!.id } as never);
        doc.section = ctx.id as never;
        doc.class = ctx.classId as never;
        doc.academicSession = ctx.academicSession as never;
      }
      const targetRoll = rest.rollNumber ?? doc.rollNumber;
      const targetActive = rest.isActive ?? doc.isActive;
      if (targetActive && (await StudentModel.exists({ _id: { $ne: doc._id }, section: doc.section, isActive: true, rollNumber: targetRoll })))
        throw conflict(`Roll number ${targetRoll} is already used in this section`);
      Object.assign(doc, rest);
      await doc.save();
      await audit(req, { action: 'STUDENT_UPDATED', entityType: 'Student', entityId: String(doc._id), details: { fields: Object.keys(body) } });
      res.json({ data: doc });
    }),
  );

  // ---------- Sheet / Daily ----------
  const sheet = asyncHandler(async (req, res) => {
    const { section, date } = req.query as { section: string; date: string };
    const ctx = await assertSectionAccess(req, section);
    res.json({ data: await buildSheet(ctx, date) });
  });
  r.get('/attendance/sheet', read, validate({ query: sectionDate }), sheet);
  r.get('/attendance/daily', read, validate({ query: sectionDate }), sheet);

  // ---------- Mark ----------
  r.put(
    '/attendance/mark',
    authorize('attendance:mark', 'attendance:correct'),
    validate({ body: markBody }),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof markBody>;
      const ctx = await assertSectionAccess(req, body.section);
      const settings = await getAttendanceSettings();
      const range = await sessionRange(ctx.academicSession);
      const holidays = await holidaySet(ctx.academicSession, body.date, body.date);
      if (body.date > todayString()) throw badRequest('Attendance cannot be marked for a future date');
      if (body.date < range.from || body.date > range.to) throw badRequest('Date is outside the academic session');
      if (isNonWorkingDay(body.date, holidays, settings.weeklyOffDays)) throw badRequest('Date is a holiday or weekly off day');

      const ids = body.entries.map((e) => e.student);
      if (new Set(ids).size !== ids.length) throw badRequest('Duplicate students in request');
      const students = await StudentModel.find({ _id: { $in: ids } }).lean();
      const byId = new Map(students.map((s) => [String(s._id), s]));
      for (const id of ids) {
        const s = byId.get(id);
        if (!s) throw badRequest('Unknown student in request');
        if (String(s.section) !== ctx.id) throw badRequest(`${s.name} does not belong to this section`);
        if (!s.isActive) throw badRequest(`${s.name} is inactive`);
      }

      let register = await AttendanceRegisterModel.findOne({ section: ctx.id, date: body.date });
      if (register?.state === 'LOCKED') throw conflict('This register is locked. Ask an authorized user to reopen it.');
      if (!register) {
        try {
          register = await AttendanceRegisterModel.create({ academicSession: ctx.academicSession, class: ctx.classId, section: ctx.id, date: body.date, state: 'DRAFT', markedBy: req.user!.id });
        } catch (e) {
          if (!isDup(e)) throw e;
          register = await AttendanceRegisterModel.findOne({ section: ctx.id, date: body.date });
        }
      }
      if (!register) throw conflict('Register could not be created');
      if (register.state === 'LOCKED') throw conflict('This register is locked.');

      const existing = await AttendanceRecordModel.find({ student: { $in: ids }, academicSession: ctx.academicSession, date: body.date }).lean();
      const existingBy = new Map(existing.map((x) => [String(x.student), x]));
      for (const x of existing) if (String(x.section) !== ctx.id) throw conflict('A student already has attendance recorded for this date in another section');

      const changes = body.entries.filter((e) => existingBy.has(e.student) && existingBy.get(e.student)!.status !== e.status);
      const additions = body.entries.filter((e) => !existingBy.has(e.student));
      const submitted = register.state !== 'DRAFT';
      if (submitted && changes.length) {
        const mayCorrect = (await actorHas(req, 'attendance:correct')) || body.date === todayString();
        if (!mayCorrect) throw forbidden('Correcting a submitted register on a past date requires attendance correction permission');
        if ((body.reason ?? '').length < ATTENDANCE_REASON_MIN_LENGTH)
          throw badRequest(`A correction reason of at least ${ATTENDANCE_REASON_MIN_LENGTH} characters is required`);
      }

      if (body.submit) {
        const active = await StudentModel.find({ section: ctx.id, isActive: true }).select('_id').lean();
        const markedIds = new Set([...existingBy.keys(), ...additions.map((a) => a.student)]);
        const allMarked = await AttendanceRecordModel.find({ section: ctx.id, date: body.date }).select('student').lean();
        for (const m of allMarked) markedIds.add(String(m.student));
        const unmarked = active.filter((s) => !markedIds.has(String(s._id)));
        if (unmarked.length) throw badRequest(`${unmarked.length} student(s) are still unmarked. Mark everyone before submitting.`);
      }

      const now = new Date();
      const base = { academicSession: ctx.academicSession, class: ctx.classId, section: ctx.id, date: body.date, by: req.user!.id, byName: req.user!.fullName, at: now };
      const history: Array<Record<string, unknown>> = [];
      const ops: Parameters<typeof AttendanceRecordModel.bulkWrite>[0] = [];
      for (const e of additions) {
        const s = byId.get(e.student)!;
        ops.push({
          insertOne: {
            document: { academicSession: ctx.academicSession, class: ctx.classId, section: ctx.id, register: register._id, student: e.student, date: body.date, status: e.status, rollNumber: s.rollNumber, admissionNumber: s.admissionNumber, studentName: s.name, markedBy: req.user!.id } as never,
          },
        });
        history.push({ ...base, action: 'MARK', student: e.student, studentName: s.name, rollNumber: s.rollNumber, newStatus: e.status });
      }
      for (const e of changes) {
        const s = byId.get(e.student)!;
        const prev = existingBy.get(e.student)!.status;
        ops.push({ updateOne: { filter: { _id: existingBy.get(e.student)!._id }, update: { $set: { status: e.status, updatedBy: req.user!.id } } } });
        history.push({ ...base, action: submitted ? 'CORRECT' : 'MARK', student: e.student, studentName: s.name, rollNumber: s.rollNumber, previousStatus: prev, newStatus: e.status, reason: body.reason });
      }
      if (ops.length) {
        try {
          await AttendanceRecordModel.bulkWrite(ops, { ordered: true });
        } catch (e) {
          if (isDup(e)) throw conflict('Attendance for one of these students was recorded concurrently. Reload and retry.');
          throw e;
        }
        await AttendanceHistoryModel.insertMany(history);
      }

      let state: RegisterState = register.state as RegisterState;
      if (submitted && (changes.length || additions.length)) state = 'UPDATED';
      if (body.submit && register.state === 'DRAFT') state = 'SUBMITTED';
      if (state !== register.state || body.submit) {
        register.state = state;
        if (body.submit && !register.submittedAt) register.submittedAt = now;
        await register.save();
        if (body.submit && register.state === 'SUBMITTED')
          await AttendanceHistoryModel.create({ ...base, action: 'SUBMIT', reason: body.reason });
      }
      await audit(req, { action: 'ATTENDANCE_SAVED', entityType: 'AttendanceRegister', entityId: String(register._id), academicSession: ctx.academicSession, details: { date: body.date, added: additions.length, changed: changes.length, state } });
      res.json({ data: { ...(await buildSheet(ctx, body.date)), changed: changes.length, added: additions.length } });
    }),
  );

  // ---------- Registers: list / lock / unlock ----------
  r.get(
    '/attendance/registers',
    read,
    validate({ query: z.object({ academicSession: objectId.optional(), section: objectId.optional(), class: objectId.optional(), from: dateString.optional(), to: dateString.optional(), state: z.string().optional() }) }),
    asyncHandler(async (req, res) => {
      const q = req.query as { academicSession?: string; section?: string; class?: string; from?: string; to?: string; state?: string };
      const ids = await sectionIdsForQuery(req, q);
      const filter: Record<string, unknown> = { section: { $in: ids } };
      if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
      if (q.state) filter.state = q.state;
      const items = await AttendanceRegisterModel.find(filter).sort({ date: -1 }).limit(500).lean();
      res.json({ data: items });
    }),
  );

  const lockFilter = (b: z.infer<typeof lockBody>) => {
    if (!b.date && !b.month) throw badRequest('Provide a date or a month');
    return b.date ? { date: b.date } : { date: { $in: monthDates(b.month!) } };
  };

  r.post(
    '/attendance/registers/lock',
    authorize('attendance:lock'),
    validate({ body: lockBody }),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof lockBody>;
      const ctx = await assertSectionAccess(req, body.section);
      const targets = await AttendanceRegisterModel.find({ section: ctx.id, ...lockFilter(body), state: { $in: ['SUBMITTED', 'UPDATED'] } }).lean();
      if (!targets.length) throw conflict('No submitted registers to lock');
      const now = new Date();
      await AttendanceRegisterModel.updateMany({ _id: { $in: targets.map((t) => t._id) } }, { $set: { state: 'LOCKED', lockedBy: req.user!.id, lockedAt: now } });
      await AttendanceHistoryModel.insertMany(targets.map((t) => ({ academicSession: ctx.academicSession, class: ctx.classId, section: ctx.id, date: t.date, action: 'LOCK', reason: body.reason, by: req.user!.id, byName: req.user!.fullName, at: now })));
      await audit(req, { action: 'ATTENDANCE_LOCKED', entityType: 'AttendanceRegister', academicSession: ctx.academicSession, details: { section: ctx.id, count: targets.length } });
      res.json({ data: { locked: targets.length } });
    }),
  );

  r.post(
    '/attendance/registers/unlock',
    authorize('attendance:lock'),
    validate({ body: lockBody }),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof lockBody>;
      if ((body.reason ?? '').length < ATTENDANCE_REASON_MIN_LENGTH)
        throw badRequest(`A reason of at least ${ATTENDANCE_REASON_MIN_LENGTH} characters is required to reopen a register`);
      const ctx = await assertSectionAccess(req, body.section);
      const targets = await AttendanceRegisterModel.find({ section: ctx.id, ...lockFilter(body), state: 'LOCKED' }).lean();
      if (!targets.length) throw conflict('No locked registers found');
      const now = new Date();
      await AttendanceRegisterModel.updateMany({ _id: { $in: targets.map((t) => t._id) } }, { $set: { state: 'UPDATED' }, $unset: { lockedBy: '', lockedAt: '' } });
      await AttendanceHistoryModel.insertMany(targets.map((t) => ({ academicSession: ctx.academicSession, class: ctx.classId, section: ctx.id, date: t.date, action: 'UNLOCK', reason: body.reason, by: req.user!.id, byName: req.user!.fullName, at: now })));
      await audit(req, { action: 'ATTENDANCE_UNLOCKED', entityType: 'AttendanceRegister', academicSession: ctx.academicSession, details: { section: ctx.id, count: targets.length, reason: body.reason } });
      res.json({ data: { unlocked: targets.length } });
    }),
  );

  // ---------- Monthly ----------
  r.get(
    '/attendance/monthly',
    read,
    validate({ query: sectionMonth }),
    asyncHandler(async (req, res) => {
      const { section, month } = req.query as { section: string; month: string };
      const ctx = await assertSectionAccess(req, section);
      res.json({ data: await monthlyFor(ctx, month) });
    }),
  );

  // ---------- Student ----------
  r.get(
    '/attendance/student/:id',
    read,
    validate({ query: z.object({ from: dateString.optional(), to: dateString.optional() }) }),
    asyncHandler(async (req, res) => {
      const student = await StudentModel.findById(idParam.parse(req.params).id).lean();
      if (!student) throw notFound('Student not found');
      const recordSections = await AttendanceRecordModel.distinct('section', { student: student._id });
      const allowed = await allowedSectionIds(req, String(student.academicSession));
      if (allowed !== 'ALL' && !allowed.has(String(student.section)) && !recordSections.some((s) => allowed.has(String(s))))
        throw forbidden('You are not assigned to this student\'s section');
      const settings = await getAttendanceSettings();
      const range = await sessionRange(String(student.academicSession));
      const q = req.query as { from?: string; to?: string };
      const from = q.from ?? range.from;
      const to = q.to ?? range.to;
      const records = await AttendanceRecordModel.find({ student: student._id, date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean();
      const summary = summarizeAttendance(records.map((x) => x.status as AttendanceStatus), settings);
      const monthly = monthsBetween(from, to).map((m) => {
        const inMonth = records.filter((x) => x.date.startsWith(m));
        return { month: m, ...summarizeAttendance(inMonth.map((x) => x.status as AttendanceStatus), settings) };
      }).filter((m) => m.recorded > 0);
      res.json({
        data: {
          student: { id: String(student._id), name: student.name, rollNumber: student.rollNumber, admissionNumber: student.admissionNumber, isActive: student.isActive, section: String(student.section) },
          from, to, summary, lowAttendance: isLowAttendance(summary.percentage, settings.lowThreshold), threshold: settings.lowThreshold, monthly,
          records: records.map((x) => ({ date: x.date, status: x.status, section: String(x.section) })),
        },
      });
    }),
  );

  // ---------- Class ----------
  r.get(
    '/attendance/class',
    read,
    validate({ query: z.object({ academicSession: objectId.optional(), class: objectId.optional(), from: dateString.optional(), to: dateString.optional() }) }),
    asyncHandler(async (req, res) => {
      const q = req.query as { academicSession?: string; class?: string; from?: string; to?: string };
      const academicSession = await resolveSessionId(q.academicSession);
      res.json({ data: await classSummaries(req, { academicSession, class: q.class, from: q.from, to: q.to }) });
    }),
  );

  // ---------- Dashboard ----------
  r.get(
    '/attendance/dashboard',
    read,
    validate({ query: z.object({ academicSession: objectId.optional(), date: dateString.optional() }) }),
    asyncHandler(async (req, res) => {
      const q = req.query as { academicSession?: string; date?: string };
      const academicSession = await resolveSessionId(q.academicSession);
      const date = q.date ?? todayString();
      const settings = await getAttendanceSettings();
      const ids = await sectionIdsForQuery(req, { academicSession });
      const [sections, registers, records, holidays] = await Promise.all([
        SectionModel.find({ _id: { $in: ids }, isActive: true }).lean(),
        AttendanceRegisterModel.find({ section: { $in: ids }, date }).lean(),
        AttendanceRecordModel.aggregate<{ _id: { section: unknown; status: string }; n: number }>([
          { $match: { section: { $in: ids.map((i) => new Types.ObjectId(i)) }, date } },
          { $group: { _id: { section: '$section', status: '$status' }, n: { $sum: 1 } } },
        ]),
        holidaySet(academicSession, date, date),
      ]);
      const classes = await ClassModel.find({ _id: { $in: sections.map((s) => s.class) } }).lean();
      const className = new Map(classes.map((c) => [String(c._id), c.name]));
      const regBy = new Map(registers.map((x) => [String(x.section), x.state]));
      const counts = new Map<string, { PRESENT: number; ABSENT: number; LEAVE: number }>();
      for (const row of records) {
        const k = String(row._id.section);
        const c = counts.get(k) ?? { PRESENT: 0, ABSENT: 0, LEAVE: 0 };
        c[row._id.status as AttendanceStatus] = row.n;
        counts.set(k, c);
      }
      const studentCounts = await StudentModel.aggregate<{ _id: unknown; n: number }>([
        { $match: { section: { $in: ids.map((i) => new Types.ObjectId(i)) }, isActive: true } },
        { $group: { _id: '$section', n: { $sum: 1 } } },
      ]);
      const sc = new Map(studentCounts.map((x) => [String(x._id), x.n]));
      const rows = sections
        .map((s) => {
          const c = counts.get(String(s._id)) ?? { PRESENT: 0, ABSENT: 0, LEAVE: 0 };
          return { section: String(s._id), label: `${className.get(String(s.class)) ?? ''}-${s.name}`, state: regBy.get(String(s._id)) ?? 'NOT_STARTED', students: sc.get(String(s._id)) ?? 0, present: c.PRESENT, absent: c.ABSENT, leave: c.LEAVE };
        })
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
      const totals = rows.reduce((a, x) => ({ students: a.students + x.students, present: a.present + x.present, absent: a.absent + x.absent, leave: a.leave + x.leave }), { students: 0, present: 0, absent: 0, leave: 0 });
      const pending = rows.filter((x) => x.students > 0 && (x.state === 'NOT_STARTED' || x.state === 'DRAFT')).length;
      const range = await sessionRange(academicSession);
      const lowCounts = await countsByStudent({ sectionIds: ids, academicSession, from: range.from, to: date });
      const low = lowCounts.filter((c) => isLowAttendance(summaryFromCounts(c, settings.leaveExcluded).percentage, settings.lowThreshold)).length;
      res.json({ data: { date, nonWorking: isNonWorkingDay(date, holidays, settings.weeklyOffDays), sections: rows, totals, pendingSections: pending, lowAttendanceStudents: low, threshold: settings.lowThreshold } });
    }),
  );

  // ---------- Holidays ----------
  r.get(
    '/attendance/holidays',
    read,
    validate({ query: z.object({ academicSession: objectId.optional() }) }),
    asyncHandler(async (req, res) => {
      const academicSession = await resolveSessionId((req.query as { academicSession?: string }).academicSession);
      const [items, settings] = await Promise.all([HolidayModel.find({ academicSession }).sort({ date: 1 }).lean(), getAttendanceSettings()]);
      res.json({ data: items, weeklyOffDays: settings.weeklyOffDays });
    }),
  );

  r.post(
    '/attendance/holidays',
    authorize('attendance:manage'),
    validate({ body: holidayBody }),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof holidayBody>;
      const academicSession = await resolveSessionId(body.academicSession);
      const range = await sessionRange(academicSession);
      if (body.date < range.from || body.date > range.to) throw badRequest('Holiday date is outside the academic session');
      if (await AttendanceRecordModel.exists({ academicSession, date: body.date })) throw conflict('Attendance is already recorded on this date; it cannot be a holiday');
      try {
        const doc = await HolidayModel.create({ ...body, academicSession, updatedBy: req.user!.id });
        await audit(req, { action: 'HOLIDAY_CREATED', entityType: 'Holiday', entityId: String(doc._id), academicSession, details: { date: body.date } });
        res.status(201).json({ data: doc });
      } catch (e) {
        if (isDup(e)) throw conflict('A holiday already exists on this date');
        throw e;
      }
    }),
  );

  r.patch(
    '/attendance/holidays/:id',
    authorize('attendance:manage'),
    validate({ body: holidayBody.omit({ academicSession: true, date: true }).partial() }),
    asyncHandler(async (req, res) => {
      const doc = await HolidayModel.findByIdAndUpdate(idParam.parse(req.params).id, { $set: { ...req.body, updatedBy: req.user!.id } }, { new: true });
      if (!doc) throw notFound('Holiday not found');
      await audit(req, { action: 'HOLIDAY_UPDATED', entityType: 'Holiday', entityId: String(doc._id), academicSession: String(doc.academicSession) });
      res.json({ data: doc });
    }),
  );

  r.delete(
    '/attendance/holidays/:id',
    authorize('attendance:manage'),
    asyncHandler(async (req, res) => {
      const doc = await HolidayModel.findById(idParam.parse(req.params).id);
      if (!doc) throw notFound('Holiday not found');
      await HolidayModel.deleteOne({ _id: doc._id });
      await audit(req, { action: 'HOLIDAY_DELETED', entityType: 'Holiday', entityId: String(doc._id), academicSession: String(doc.academicSession), details: { date: doc.date, name: doc.name } });
      res.json({ data: { deleted: true } });
    }),
  );

  // ---------- History ----------
  r.get(
    '/attendance/history',
    read,
    validate({ query: z.object({ academicSession: objectId.optional(), section: objectId.optional(), class: objectId.optional(), student: objectId.optional(), from: dateString.optional(), to: dateString.optional(), action: z.enum(['MARK', 'CORRECT', 'SUBMIT', 'LOCK', 'UNLOCK']).optional() }) }),
    asyncHandler(async (req, res) => {
      const q = req.query as { academicSession?: string; section?: string; class?: string; student?: string; from?: string; to?: string; action?: string };
      const ids = await sectionIdsForQuery(req, { section: q.section, class: q.class, academicSession: q.academicSession });
      const filter: Record<string, unknown> = { section: { $in: ids } };
      if (q.student) filter.student = q.student;
      if (q.action) filter.action = q.action;
      if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
      const page = parsePage(req.query as Record<string, unknown>);
      const [items, total] = await Promise.all([
        AttendanceHistoryModel.find(filter).sort({ at: -1 }).skip(page.skip).limit(page.pageSize).lean(),
        AttendanceHistoryModel.countDocuments(filter),
      ]);
      res.json({ data: items, total, page: page.page, pageSize: page.pageSize });
    }),
  );

  // ---------- Settings ----------
  r.get('/attendance/settings', read, asyncHandler(async (_req, res) => res.json({ data: await getAttendanceSettings() })));

  r.put(
    '/attendance/settings',
    authorize('attendance:manage'),
    validate({ body: settingsBody }),
    asyncHandler(async (req, res) => {
      const before = await getAttendanceSettings();
      await SettingModel.updateOne({ key: SETTINGS_KEY }, { $set: { value: req.body, updatedBy: req.user!.id } }, { upsert: true });
      await audit(req, { action: 'ATTENDANCE_SETTINGS_CHANGED', entityType: 'SystemSetting', entityId: SETTINGS_KEY, details: { before: { ...before, logoDataUrl: undefined }, after: { ...req.body, logoDataUrl: undefined } } });
      res.json({ data: await getAttendanceSettings() });
    }),
  );

  return r;
}

async function loadSectionStrict(sectionId: string): Promise<SectionCtx> {
  const { loadSection } = await import('./attendance.service');
  const ctx = await loadSection(sectionId);
  const s = await SectionModel.findById(sectionId).select('isActive').lean();
  if (!s?.isActive) throw badRequest('Section is inactive');
  return ctx;
}

export async function monthlyFor(ctx: SectionCtx, month: string) {
  const dates = monthDates(month);
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const [settings, roster, records, holidays, sessionRow, register] = await Promise.all([
    getAttendanceSettings(),
    rosterFor(ctx.id, first, last),
    AttendanceRecordModel.find({ section: ctx.id, date: { $gte: first, $lte: last } }).select('student date status').lean(),
    holidaySet(ctx.academicSession, first, last),
    AcademicSessionModel.findById(ctx.academicSession).select('name').lean(),
    AttendanceRegisterModel.find({ section: ctx.id, date: { $gte: first, $lte: last } }).select('date state').lean(),
  ]);
  const matrix = buildMonthlyRegister({
    month,
    students: roster.map((s) => ({ id: s.id, rollNumber: s.rollNumber, admissionNumber: s.admissionNumber, name: s.name })),
    records: records.map((x) => ({ student: String(x.student), date: x.date, status: x.status as AttendanceStatus })),
    holidays,
    weeklyOffDays: settings.weeklyOffDays,
    leaveExcluded: settings.leaveExcluded,
  });
  return {
    ...matrix,
    sessionName: sessionRow?.name ?? '',
    section: { id: ctx.id, name: ctx.name, classId: ctx.classId, className: ctx.className },
    threshold: settings.lowThreshold,
    leaveExcluded: settings.leaveExcluded,
    states: Object.fromEntries(register.map((x) => [x.date, x.state])),
  };
}

export async function classSummaries(req: Request, q: { academicSession: string; class?: string; from?: string; to?: string }) {
  const settings = await getAttendanceSettings();
  const range = await sessionRange(q.academicSession);
  const from = q.from ?? range.from;
  const to = q.to ?? range.to;
  const ids = await sectionIdsForQuery(req, { class: q.class, academicSession: q.academicSession });
  const sections = await SectionModel.find({ _id: { $in: ids } }).lean();
  const classes = await ClassModel.find({ _id: { $in: sections.map((s) => s.class) } }).lean();
  const className = new Map(classes.map((c) => [String(c._id), c.name]));
  const students = await StudentModel.find({ section: { $in: ids } }).select('section isActive').lean();
  const counts = await countsByStudent({ sectionIds: ids, from, to });
  const byStudent = new Map(counts.map((c) => [c.student, c]));
  const rows = sections.map((s) => {
    const mine = students.filter((st) => String(st.section) === String(s._id));
    const agg = { present: 0, absent: 0, leave: 0 };
    let low = 0;
    for (const st of mine) {
      const c = byStudent.get(String(st._id));
      if (!c) continue;
      agg.present += c.present;
      agg.absent += c.absent;
      agg.leave += c.leave;
      if (isLowAttendance(summaryFromCounts(c, settings.leaveExcluded).percentage, settings.lowThreshold)) low += 1;
    }
    const sum = summaryFromCounts(agg, settings.leaveExcluded);
    return { section: String(s._id), class: String(s.class), label: `${className.get(String(s.class)) ?? ''}-${s.name}`, students: mine.filter((m) => m.isActive).length, ...sum, lowAttendanceStudents: low };
  });
  rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  return { from, to, threshold: settings.lowThreshold, rows };
}
