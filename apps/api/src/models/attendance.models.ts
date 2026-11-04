import { Schema, model } from 'mongoose';
import { ATTENDANCE_STATUSES, REGISTER_STATES } from '@ssms/shared';

const ref = (to: string, required = true) => ({ type: Schema.Types.ObjectId, ref: to, required });

/** Student master. Students are never deleted; they are deactivated and keep their historical attendance. */
const studentSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    class: ref('SchoolClass'),
    section: ref('Section'),
    rollNumber: { type: String, required: true, trim: true },
    admissionNumber: { type: String, required: true, trim: true, unique: true },
    name: { type: String, required: true, trim: true },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'] },
    guardianName: { type: String, trim: true },
    guardianPhone: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    sectionHistory: [
      new Schema({ section: ref('Section'), rollNumber: String, from: Date, by: ref('User', false) }, { _id: false }),
    ],
  },
  { timestamps: true },
);
studentSchema.index({ section: 1, isActive: 1, rollNumber: 1 });
studentSchema.index({ academicSession: 1, class: 1, section: 1 });
export const StudentModel = model('Student', studentSchema);

/** One register per section per date. Holds workflow state; statuses live in AttendanceRecord. */
const registerSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    class: ref('SchoolClass'),
    section: ref('Section'),
    date: { type: String, required: true },
    state: { type: String, enum: REGISTER_STATES, default: 'DRAFT' },
    markedBy: ref('User', false),
    submittedAt: Date,
    lockedBy: ref('User', false),
    lockedAt: Date,
  },
  { timestamps: true },
);
registerSchema.index({ section: 1, date: 1 }, { unique: true });
registerSchema.index({ academicSession: 1, date: 1 });
export const AttendanceRegisterModel = model('AttendanceRegister', registerSchema);

/** Unique per student, session and date. Section/roll/name are snapshots so history survives transfers. */
const recordSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    class: ref('SchoolClass'),
    section: ref('Section'),
    register: ref('AttendanceRegister'),
    student: ref('Student'),
    date: { type: String, required: true },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    rollNumber: String,
    admissionNumber: String,
    studentName: String,
    markedBy: ref('User'),
    updatedBy: ref('User', false),
  },
  { timestamps: true },
);
recordSchema.index({ student: 1, academicSession: 1, date: 1 }, { unique: true });
recordSchema.index({ section: 1, date: 1 });
recordSchema.index({ academicSession: 1, class: 1, date: 1 });
export const AttendanceRecordModel = model('AttendanceRecord', recordSchema);

/** Append-only audit trail of every change to attendance. */
const historySchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    class: ref('SchoolClass', false),
    section: ref('Section', false),
    student: ref('Student', false),
    studentName: String,
    rollNumber: String,
    date: { type: String, required: true },
    action: { type: String, enum: ['MARK', 'CORRECT', 'SUBMIT', 'LOCK', 'UNLOCK'], required: true },
    previousStatus: { type: String, enum: ATTENDANCE_STATUSES },
    newStatus: { type: String, enum: ATTENDANCE_STATUSES },
    reason: { type: String, trim: true },
    by: ref('User'),
    byName: String,
    at: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
historySchema.index({ section: 1, date: 1 });
historySchema.index({ student: 1, at: -1 });
historySchema.index({ at: -1 });
export const AttendanceHistoryModel = model('AttendanceHistory', historySchema);

const holidaySchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    date: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    updatedBy: ref('User', false),
  },
  { timestamps: true },
);
holidaySchema.index({ academicSession: 1, date: 1 }, { unique: true });
export const HolidayModel = model('Holiday', holidaySchema);
