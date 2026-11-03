import { Schema, model, type Types } from 'mongoose';
import { CHAPTER_IMPORTANCE } from '@ssms/shared';

const ref = (to: string, required = true) => ({ type: Schema.Types.ObjectId, ref: to, required });

const academicSessionSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isCurrent: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
academicSessionSchema.index({ isCurrent: 1 }, { unique: true, partialFilterExpression: { isCurrent: true } });
export const AcademicSessionModel = model('AcademicSession', academicSessionSchema);

const classSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    name: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
classSchema.index({ academicSession: 1, name: 1 }, { unique: true });
export const ClassModel = model('SchoolClass', classSchema);

const sectionSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    class: ref('SchoolClass'),
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
sectionSchema.index({ class: 1, name: 1 }, { unique: true });
export const SectionModel = model('Section', sectionSchema);

const subjectSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const SubjectModel = model('Subject', subjectSchema);

const assignmentSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    class: ref('SchoolClass'),
    section: ref('Section'),
    subject: ref('Subject'),
    teacher: ref('User'),
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
assignmentSchema.index({ section: 1, subject: 1, teacher: 1 }, { unique: true });
assignmentSchema.index({ teacher: 1, academicSession: 1 });
export const TeacherAssignmentModel = model('TeacherAssignment', assignmentSchema);

const chapterSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    class: ref('SchoolClass'),
    subject: ref('Subject'),
    title: { type: String, required: true, trim: true },
    order: { type: Number, required: true, min: 1 },
    estimatedPeriods: { type: Number, default: 1, min: 0 },
    importance: { type: String, enum: CHAPTER_IMPORTANCE, default: 'MEDIUM' },
    weight: { type: Number, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
chapterSchema.index({ academicSession: 1, class: 1, subject: 1, title: 1 }, { unique: true });
chapterSchema.index({ academicSession: 1, class: 1, subject: 1, order: 1 });
export const ChapterModel = model('Chapter', chapterSchema);

const topicSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    chapter: ref('Chapter'),
    title: { type: String, required: true, trim: true },
    order: { type: Number, required: true, min: 1 },
    estimatedPeriods: { type: Number, default: 1, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
topicSchema.index({ chapter: 1, title: 1 }, { unique: true });
export const TopicModel = model('Topic', topicSchema);

const subtopicSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    chapter: ref('Chapter'),
    topic: ref('Topic'),
    title: { type: String, required: true, trim: true },
    order: { type: Number, required: true, min: 1 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
subtopicSchema.index({ topic: 1, title: 1 }, { unique: true });
export const SubtopicModel = model('Subtopic', subtopicSchema);

const syllabusVersionSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    class: ref('SchoolClass'),
    subject: ref('Subject'),
    version: { type: Number, required: true },
    reason: { type: String },
    changedBy: ref('User', false),
    snapshot: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
syllabusVersionSchema.index({ academicSession: 1, class: 1, subject: 1, version: -1 });
export const SyllabusVersionModel = model('SyllabusVersion', syllabusVersionSchema);

export type Id = Types.ObjectId;
