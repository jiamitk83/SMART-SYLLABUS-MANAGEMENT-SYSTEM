import type { Types } from 'mongoose';
import {
  AcademicSessionModel,
  ChapterModel,
  ClassModel,
  SectionModel,
  SubjectModel,
  SubtopicModel,
  TeacherAssignmentModel,
  TopicModel,
} from '../../models/academic.models';
import { badRequest, forbidden } from '../../utils/errors';

export async function currentSessionId(): Promise<string> {
  const s = await AcademicSessionModel.findOne({ isCurrent: true }).select('_id').lean();
  if (!s) throw badRequest('No current academic session is set');
  return String(s._id);
}

export async function resolveSessionId(value: unknown): Promise<string> {
  if (typeof value === 'string' && value) {
    if (!(await AcademicSessionModel.exists({ _id: value }))) throw badRequest('Academic session not found');
    return value;
  }
  return currentSessionId();
}

export interface HierarchyInput {
  academicSession: string;
  class?: string;
  section?: string;
  subject?: string;
  chapter?: string;
  topic?: string;
  subtopic?: string;
}

const same = (a: unknown, b: unknown) => String(a) === String(b);

/** Verifies every referenced record exists, is active where relevant, and belongs to the stated session/class/chapter. */
export async function assertHierarchy(h: HierarchyInput): Promise<void> {
  if (h.class) {
    const c = await ClassModel.findById(h.class).lean();
    if (!c || !same(c.academicSession, h.academicSession)) throw badRequest('Class does not belong to the academic session');
  }
  if (h.section) {
    const s = await SectionModel.findById(h.section).lean();
    if (!s || !same(s.academicSession, h.academicSession)) throw badRequest('Section does not belong to the academic session');
    if (h.class && !same(s.class, h.class)) throw badRequest('Section does not belong to the class');
  }
  if (h.subject && !(await SubjectModel.exists({ _id: h.subject }))) throw badRequest('Subject not found');
  if (h.chapter) {
    const ch = await ChapterModel.findById(h.chapter).lean();
    if (!ch || !same(ch.academicSession, h.academicSession)) throw badRequest('Chapter does not belong to the academic session');
    if (h.class && !same(ch.class, h.class)) throw badRequest('Chapter does not belong to the class');
    if (h.subject && !same(ch.subject, h.subject)) throw badRequest('Chapter does not belong to the subject');
  }
  if (h.topic) {
    const t = await TopicModel.findById(h.topic).lean();
    if (!t || (h.chapter && !same(t.chapter, h.chapter))) throw badRequest('Topic does not belong to the chapter');
  }
  if (h.subtopic) {
    const st = await SubtopicModel.findById(h.subtopic).lean();
    if (!st || (h.topic && !same(st.topic, h.topic))) throw badRequest('Subtopic does not belong to the topic');
  }
}

export async function assertTeacherAssigned(teacherId: string, section: string, subject: string): Promise<void> {
  const ok = await TeacherAssignmentModel.exists({ teacher: teacherId, section, subject, isActive: true });
  if (!ok) throw forbidden('You are not assigned to this section and subject');
}

export async function teacherAssignments(teacherId: string, academicSession?: string) {
  return TeacherAssignmentModel.find({ teacher: teacherId, isActive: true, ...(academicSession ? { academicSession } : {}) }).lean();
}

export const toId = (v: Types.ObjectId | string): string => String(v);
