import { Router, type Request } from 'express';
import { z } from 'zod';
import { isLowAttendance, monthsBetween, summarizeAttendance, type AttendanceStatus } from '@ssms/shared';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/error.middleware';
import { ClassModel, SectionModel } from '../../models/academic.models';
import { AttendanceRecordModel, StudentModel } from '../../models/attendance.models';
import { asyncHandler, badRequest, forbidden, notFound } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import { objectId } from '../common/crud';
import { resolveSessionId } from '../common/integrity';
import { sendReport, type ReportTable } from '../reports/report.format';
import { buildRegisterPdf, monthTitle } from './attendance.pdf';
import { monthlyFor } from './attendance.routes';
import {
  allowedSectionIds,
  assertSectionAccess,
  countsByStudent,
  dateString,
  getAttendanceSettings,
  monthString,
  sectionIdsForQuery,
  sessionRange,
  summaryFromCounts,
  todayString,
} from './attendance.service';

const TYPES = ['register', 'student', 'class', 'monthly', 'annual', 'cumulative', 'low'] as const;
const FORMATS = ['json', 'xlsx', 'csv', 'pdf'] as const;

const query = z.object({
  format: z.enum(FORMATS).default('json'),
  academicSession: objectId.optional(),
  class: objectId.optional(),
  section: objectId.optional(),
  student: objectId.optional(),
  month: monthString.optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  threshold: z.coerce.number().min(1).max(100).optional(),
});
type Q = z.infer<typeof query>;

const pct = (v: number | null): string => (v === null ? '-' : `${v}%`);

async function labels(sectionIds: string[]): Promise<Map<string, string>> {
  const sections = await SectionModel.find({ _id: { $in: sectionIds } }).lean();
  const classes = await ClassModel.find({ _id: { $in: sections.map((s) => s.class) } }).lean();
  const cn = new Map(classes.map((c) => [String(c._id), c.name]));
  return new Map(sections.map((s) => [String(s._id), `${cn.get(String(s.class)) ?? ''}-${s.name}`]));
}

interface StudentRow {
  id: string;
  label: string;
  roll: string;
  adm: string;
  name: string;
  present: number;
  absent: number;
  leave: number;
  recorded: number;
  percentage: number | null;
}

/** Totals per student over a window. Students with no records are included (percentage "-"), never counted as present/absent. */
async function studentRows(sectionIds: string[], from: string, to: string, academicSession: string | undefined, leaveExcluded: boolean): Promise<StudentRow[]> {
  const [students, counts, labelMap] = await Promise.all([
    StudentModel.find({ section: { $in: sectionIds }, isActive: true }).lean(),
    countsByStudent({ sectionIds, academicSession, from, to }),
    labels(sectionIds),
  ]);
  const byId = new Map(counts.map((c) => [c.student, c]));
  const known = new Set(students.map((s) => String(s._id)));
  const extra = counts.filter((c) => !known.has(c.student)).map((c) => c.student);
  const others = extra.length ? await StudentModel.find({ _id: { $in: extra } }).lean() : [];
  return [...students, ...others]
    .map((s) => {
      const c = byId.get(String(s._id)) ?? { present: 0, absent: 0, leave: 0 };
      const sum = summaryFromCounts(c, leaveExcluded);
      return { id: String(s._id), label: labelMap.get(String(s.section)) ?? '', roll: s.rollNumber, adm: s.admissionNumber, name: s.name, present: c.present, absent: c.absent, leave: c.leave, recorded: sum.recorded, percentage: sum.percentage };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }) || a.roll.localeCompare(b.roll, undefined, { numeric: true }));
}

const head = ['Class-Section', 'Roll', 'Admission No', 'Student', 'Present', 'Absent', 'Leave', 'Recorded Days', 'Attendance %'];
const rowOf = (r: StudentRow): Array<string | number> => [r.label, r.roll, r.adm, r.name, r.present, r.absent, r.leave, r.recorded, pct(r.percentage)];

async function build(req: Request, type: (typeof TYPES)[number], q: Q): Promise<ReportTable> {
  const settings = await getAttendanceSettings();
  const academicSession = await resolveSessionId(q.academicSession);
  const range = await sessionRange(academicSession);
  const from = q.from ?? range.from;
  const to = q.to ?? (todayString() < range.to ? todayString() : range.to);
  const note = `Percentage = Present ÷ (Present + Absent${settings.leaveExcluded ? '' : ' + Leave'}). Holidays and unrecorded days are excluded.`;

  if (type === 'student') {
    if (!q.student) throw badRequest('student is required');
    const st = await StudentModel.findById(q.student).lean();
    if (!st) throw notFound('Student not found');
    const allowed = await allowedSectionIds(req, String(st.academicSession));
    const recSections = await AttendanceRecordModel.distinct('section', { student: st._id });
    if (allowed !== 'ALL' && !allowed.has(String(st.section)) && !recSections.some((s) => allowed.has(String(s)))) throw forbidden('You are not assigned to this student');
    const records = await AttendanceRecordModel.find({ student: st._id, date: { $gte: from, $lte: to } }).select('date status').lean();
    const rows = monthsBetween(from, to)
      .map((m) => {
        const s = summarizeAttendance(records.filter((x) => x.date.startsWith(m)).map((x) => x.status as AttendanceStatus), settings);
        return { m, s };
      })
      .filter((x) => x.s.recorded > 0)
      .map((x) => [monthTitle(x.m), x.s.present, x.s.absent, x.s.leave, x.s.recorded, pct(x.s.percentage)] as Array<string | number>);
    const total = summarizeAttendance(records.map((x) => x.status as AttendanceStatus), settings);
    rows.push(['Total', total.present, total.absent, total.leave, total.recorded, pct(total.percentage)]);
    return { title: `Student Attendance - ${st.name}`, subtitle: `Roll ${st.rollNumber} | Adm ${st.admissionNumber} | ${from} to ${to}. ${note}`, columns: ['Month', 'Present', 'Absent', 'Leave', 'Recorded Days', 'Attendance %'], rows };
  }

  if (type === 'class') {
    const ids = await sectionIdsForQuery(req, { class: q.class, academicSession });
    const labelMap = await labels(ids);
    const students = await StudentModel.find({ section: { $in: ids }, isActive: true }).select('section').lean();
    const counts = await countsByStudent({ sectionIds: ids, academicSession, from, to });
    const sectionOf = new Map(students.map((s) => [String(s._id), String(s.section)]));
    const rows = ids.map((id) => {
      const agg = { present: 0, absent: 0, leave: 0 };
      let low = 0;
      for (const c of counts) {
        if (sectionOf.get(c.student) !== id) continue;
        agg.present += c.present;
        agg.absent += c.absent;
        agg.leave += c.leave;
        if (isLowAttendance(summaryFromCounts(c, settings.leaveExcluded).percentage, settings.lowThreshold)) low += 1;
      }
      const sum = summaryFromCounts(agg, settings.leaveExcluded);
      return [labelMap.get(id) ?? '', sectionOf.size ? [...sectionOf.values()].filter((v) => v === id).length : 0, agg.present, agg.absent, agg.leave, pct(sum.percentage), low] as Array<string | number>;
    });
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
    return { title: 'Class-wise Attendance', subtitle: `${from} to ${to}. ${note}`, columns: ['Class-Section', 'Students', 'Present', 'Absent', 'Leave', 'Attendance %', `Below ${settings.lowThreshold}%`], rows };
  }

  if (type === 'low') {
    const ids = await sectionIdsForQuery(req, { section: q.section, class: q.class, academicSession });
    const threshold = q.threshold ?? settings.lowThreshold;
    const rows = (await studentRows(ids, from, to, academicSession, settings.leaveExcluded)).filter((r) => isLowAttendance(r.percentage, threshold));
    return { title: 'Low Attendance Students', subtitle: `Below ${threshold}% | ${from} to ${to}. ${note}`, columns: head, rows: rows.map(rowOf) };
  }

  if (!q.section) throw badRequest('section is required');
  const ctx = await assertSectionAccess(req, q.section);
  const sectionLabel = `${ctx.className}-${ctx.name}`;

  if (type === 'cumulative') {
    const rows = await studentRows([ctx.id], from, to, undefined, settings.leaveExcluded);
    return { title: `Cumulative Attendance - ${sectionLabel}`, subtitle: `${from} to ${to}. ${note}`, columns: head, rows: rows.map(rowOf) };
  }

  if (type === 'annual') {
    const months = monthsBetween(range.from, range.to);
    const students = await studentRows([ctx.id], range.from, range.to, undefined, settings.leaveExcluded);
    const records = await AttendanceRecordModel.find({ section: ctx.id, date: { $gte: range.from, $lte: range.to } }).select('student date status').lean();
    const per = new Map<string, Map<string, AttendanceStatus[]>>();
    for (const r of records) {
      const byMonth = per.get(String(r.student)) ?? new Map<string, AttendanceStatus[]>();
      const arr = byMonth.get(r.date.slice(0, 7)) ?? [];
      arr.push(r.status as AttendanceStatus);
      byMonth.set(r.date.slice(0, 7), arr);
      per.set(String(r.student), byMonth);
    }
    const rows = students.map((s) => [s.roll, s.adm, s.name, ...months.map((m) => pct(summarizeAttendance(per.get(s.id)?.get(m) ?? [], settings).percentage)), s.present, s.absent, s.leave, pct(s.percentage)] as Array<string | number>);
    return { title: `Annual Attendance - ${sectionLabel}`, subtitle: `Session ${range.name}. ${note}`, columns: ['Roll', 'Admission No', 'Student', ...months.map(monthTitle), 'Present', 'Absent', 'Leave', 'Annual %'], rows };
  }

  if (!q.month) throw badRequest('month is required');
  const monthly = await monthlyFor(ctx, q.month);
  if (type === 'monthly') {
    return {
      title: `Monthly Attendance - ${sectionLabel} - ${monthTitle(q.month)}`,
      subtitle: `Working days: ${monthly.workingDays}. ${note}`,
      columns: ['Roll', 'Admission No', 'Student', 'Present', 'Absent', 'Leave', 'Recorded Days', 'Attendance %'],
      rows: monthly.rows.map((r) => [r.rollNumber, r.admissionNumber, r.name, r.summary.present, r.summary.absent, r.summary.leave, r.summary.recorded, pct(r.summary.percentage)]),
    };
  }
  // register: matrix with day columns
  return {
    title: `Attendance Register - ${sectionLabel} - ${monthTitle(q.month)}`,
    subtitle: `Session ${monthly.sessionName}. P=Present A=Absent L=Leave H=Holiday blank=not recorded. Working days: ${monthly.workingDays}`,
    columns: ['Roll', 'Admission No', 'Student', ...monthly.dates.map((d) => String(Number(d.slice(8)))), 'P', 'A', 'L', 'Working Days', '%'],
    rows: monthly.rows.map((r) => [r.rollNumber, r.admissionNumber, r.name, ...r.cells, r.summary.present, r.summary.absent, r.summary.leave, monthly.workingDays, pct(r.summary.percentage)]),
  };
}

export function attendanceReportRoutes(): Router {
  const r = Router();
  r.use(authenticate);
  r.get(
    '/attendance/reports/:type',
    authorize('attendance:read'),
    validate({ query }),
    asyncHandler(async (req, res) => {
      const type = z.enum(TYPES).parse(req.params.type);
      const q = req.query as unknown as Q;
      if (type === 'register' && q.format === 'pdf') {
        if (!q.section || !q.month) throw badRequest('section and month are required');
        const ctx = await assertSectionAccess(req, q.section);
        const settings = await getAttendanceSettings();
        const monthly = await monthlyFor(ctx, q.month);
        const buf = await buildRegisterPdf({
          schoolName: settings.schoolName,
          logoDataUrl: settings.logoDataUrl,
          sessionName: monthly.sessionName,
          className: ctx.className,
          sectionName: ctx.name,
          register: monthly,
          threshold: settings.lowThreshold,
        });
        await audit(req, { action: 'ATTENDANCE_REPORT_EXPORTED', entityType: 'AttendanceReport', details: { type, format: 'pdf', section: ctx.id, month: q.month } });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="attendance-register-${q.month}.pdf"`);
        res.send(buf);
        return;
      }
      const table = await build(req, type, q);
      if (q.format !== 'json') await audit(req, { action: 'ATTENDANCE_REPORT_EXPORTED', entityType: 'AttendanceReport', details: { type, format: q.format } });
      await sendReport(res, table, q.format, `attendance-${type}`);
    }),
  );
  return r;
}
