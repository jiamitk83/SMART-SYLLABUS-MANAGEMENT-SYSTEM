import type { Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  isValidDateString,
  summarizeAttendance,
  type AttendanceSettings,
  type AttendanceStatus,
} from '@ssms/shared';
import { AcademicSessionModel, ClassModel, SectionModel, TeacherAssignmentModel } from '../../models/academic.models';
import { AttendanceRecordModel, HolidayModel, StudentModel } from '../../models/attendance.models';
import { SettingModel } from '../../models/planning.models';
import { badRequest, forbidden, notFound } from '../../utils/errors';

export const SETTINGS_KEY = 'attendanceSettings';

export const dateString = z.string().refine(isValidDateString, 'Date must be a valid YYYY-MM-DD');
export const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM');

export function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const toDateString = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

export async function getAttendanceSettings(): Promise<AttendanceSettings> {
  const row = await SettingModel.findOne({ key: SETTINGS_KEY }).lean();
  return { ...DEFAULT_ATTENDANCE_SETTINGS, ...((row?.value as Partial<AttendanceSettings> | undefined) ?? {}) };
}

export const naturalCompare = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export interface SectionCtx {
  id: string;
  name: string;
  classId: string;
  className: string;
  academicSession: string;
}

export async function loadSection(sectionId: string): Promise<SectionCtx> {
  const section = await SectionModel.findById(sectionId).lean();
  if (!section) throw notFound('Section not found');
  const cls = await ClassModel.findById(section.class).lean();
  return {
    id: String(section._id),
    name: section.name,
    classId: String(section.class),
    className: cls?.name ?? '',
    academicSession: String(section.academicSession),
  };
}

/** Teachers see/mark only sections they are assigned to; every other role is school-wide. */
export async function allowedSectionIds(req: Request, academicSession?: string): Promise<Set<string> | 'ALL'> {
  if (req.user!.role !== 'TEACHER') return 'ALL';
  const rows = await TeacherAssignmentModel.find({
    teacher: req.user!.id,
    isActive: true,
    ...(academicSession ? { academicSession } : {}),
  })
    .select('section')
    .lean();
  return new Set(rows.map((r) => String(r.section)));
}

export async function assertSectionAccess(req: Request, sectionId: string): Promise<SectionCtx> {
  const ctx = await loadSection(sectionId);
  const allowed = await allowedSectionIds(req, ctx.academicSession);
  if (allowed !== 'ALL' && !allowed.has(sectionId)) throw forbidden('You are not assigned to this section');
  return ctx;
}

export async function sectionIdsForQuery(
  req: Request,
  q: { section?: string; class?: string; academicSession?: string },
): Promise<string[]> {
  const filter: Record<string, unknown> = {};
  if (q.section) filter._id = q.section;
  if (q.class) filter.class = q.class;
  if (q.academicSession) filter.academicSession = q.academicSession;
  const sections = await SectionModel.find(filter).select('_id').lean();
  const ids = sections.map((s) => String(s._id));
  const allowed = await allowedSectionIds(req, q.academicSession);
  if (allowed === 'ALL') return ids;
  if (q.section && !allowed.has(q.section)) throw forbidden('You are not assigned to this section');
  return ids.filter((i) => allowed.has(i));
}

export async function holidaySet(academicSession: string, from?: string, to?: string): Promise<Set<string>> {
  const filter: Record<string, unknown> = { academicSession };
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const rows = await HolidayModel.find(filter).select('date').lean();
  return new Set(rows.map((h) => h.date));
}

export async function sessionRange(academicSession: string): Promise<{ from: string; to: string; name: string }> {
  const s = await AcademicSessionModel.findById(academicSession).lean();
  if (!s) throw badRequest('Academic session not found');
  return { from: toDateString(s.startDate), to: toDateString(s.endDate), name: s.name };
}

export interface RosterStudent {
  id: string;
  rollNumber: string;
  admissionNumber: string;
  name: string;
  isActive: boolean;
}

/** Active students of a section plus anyone with a record in the section within the window (inactive or transferred). */
export async function rosterFor(sectionId: string, from: string, to: string): Promise<RosterStudent[]> {
  const [active, recorded] = await Promise.all([
    StudentModel.find({ section: sectionId, isActive: true }).lean(),
    AttendanceRecordModel.find({ section: sectionId, date: { $gte: from, $lte: to } })
      .select('student rollNumber admissionNumber studentName')
      .lean(),
  ]);
  const map = new Map<string, RosterStudent>();
  for (const s of active)
    map.set(String(s._id), { id: String(s._id), rollNumber: s.rollNumber, admissionNumber: s.admissionNumber, name: s.name, isActive: true });
  const missing = new Set<string>();
  for (const r of recorded) if (!map.has(String(r.student))) missing.add(String(r.student));
  if (missing.size) {
    const others = await StudentModel.find({ _id: { $in: [...missing] } }).lean();
    const snap = new Map(recorded.map((r) => [String(r.student), r]));
    for (const s of others) {
      const r = snap.get(String(s._id));
      map.set(String(s._id), {
        id: String(s._id),
        rollNumber: r?.rollNumber ?? s.rollNumber,
        admissionNumber: r?.admissionNumber ?? s.admissionNumber,
        name: r?.studentName ?? s.name,
        isActive: s.isActive,
      });
    }
  }
  return [...map.values()].sort((a, b) => naturalCompare(a.rollNumber, b.rollNumber) || naturalCompare(a.name, b.name));
}

export interface CountRow {
  student: string;
  present: number;
  absent: number;
  leave: number;
}

/** Per-student status counts for a date window (single aggregation; unrecorded days are simply absent from the data). */
export async function countsByStudent(filter: {
  sectionIds?: string[];
  student?: string;
  academicSession?: string;
  from: string;
  to: string;
}): Promise<CountRow[]> {
  const match: Record<string, unknown> = { date: { $gte: filter.from, $lte: filter.to } };
  if (filter.sectionIds) match.section = { $in: filter.sectionIds.map((s) => new Types.ObjectId(s)) };
  if (filter.student) match.student = new Types.ObjectId(filter.student);
  if (filter.academicSession) match.academicSession = new Types.ObjectId(filter.academicSession);
  const rows = await AttendanceRecordModel.aggregate<{ _id: unknown; present: number; absent: number; leave: number }>([
    { $match: match },
    {
      $group: {
        _id: '$student',
        present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
        leave: { $sum: { $cond: [{ $eq: ['$status', 'LEAVE'] }, 1, 0] } },
      },
    },
  ]);
  return rows.map((r) => ({ student: String(r._id), present: r.present, absent: r.absent, leave: r.leave }));
}

export function summaryFromCounts(c: { present: number; absent: number; leave: number }, leaveExcluded: boolean) {
  const statuses: AttendanceStatus[] = [
    ...Array<AttendanceStatus>(c.present).fill('PRESENT'),
    ...Array<AttendanceStatus>(c.absent).fill('ABSENT'),
    ...Array<AttendanceStatus>(c.leave).fill('LEAVE'),
  ];
  return summarizeAttendance(statuses, { leaveExcluded });
}
