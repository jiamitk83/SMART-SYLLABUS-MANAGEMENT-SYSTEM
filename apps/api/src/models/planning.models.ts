import { Schema, model } from 'mongoose';
import { ACTIVITY_TYPES, RECORD_STATES, TEACHING_STATUSES } from '@ssms/shared';

const ref = (to: string, required = true) => ({ type: Schema.Types.ObjectId, ref: to, required });

export const PLAN_LEVELS = ['ANNUAL', 'MONTHLY', 'WEEKLY'] as const;
export const COMPLETION_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REOPENED'] as const;

const syllabusPlanSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    class: ref('SchoolClass'),
    section: ref('Section', false),
    subject: ref('Subject'),
    chapter: ref('Chapter'),
    topics: [{ type: Schema.Types.ObjectId, ref: 'Topic' }],
    level: { type: String, enum: PLAN_LEVELS, required: true },
    month: { type: Number, min: 1, max: 12 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    estimatedPeriods: { type: Number, default: 0, min: 0 },
    target: { type: String, default: '' },
    createdBy: ref('User', false),
    reschedules: [
      {
        fromStart: Date,
        fromEnd: Date,
        toStart: Date,
        toEnd: Date,
        reason: String,
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now },
      },
    ],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
syllabusPlanSchema.index({ academicSession: 1, class: 1, subject: 1, level: 1 });
syllabusPlanSchema.index({ chapter: 1 });
export const SyllabusPlanModel = model('SyllabusPlan', syllabusPlanSchema);

const teachingSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    date: { type: Date, required: true },
    class: ref('SchoolClass'),
    section: ref('Section'),
    subject: ref('Subject'),
    teacher: ref('User'),
    chapter: ref('Chapter'),
    topic: ref('Topic', false),
    subtopic: ref('Subtopic', false),
    periodNumber: { type: Number, required: true, min: 1, max: 20 },
    description: { type: String, default: '', maxlength: 2000 },
    teachingStatus: { type: String, enum: TEACHING_STATUSES, required: true },
    remarks: { type: String, default: '', maxlength: 1000 },
    state: { type: String, enum: RECORD_STATES, default: 'DRAFT' },
    submittedAt: Date,
    history: [
      {
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        action: String,
        changes: Schema.Types.Mixed,
      },
    ],
  },
  { timestamps: true },
);
teachingSchema.index({ section: 1, date: 1, periodNumber: 1 }, { unique: true });
teachingSchema.index({ teacher: 1, date: -1 });
teachingSchema.index({ academicSession: 1, chapter: 1 });
export const TeachingRecordModel = model('DailyTeachingRecord', teachingSchema);

const completionSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    class: ref('SchoolClass'),
    section: ref('Section'),
    subject: ref('Subject'),
    chapter: ref('Chapter'),
    status: { type: String, enum: COMPLETION_STATUSES, required: true },
    requestedBy: ref('User', false),
    reviewedBy: ref('User', false),
    remarks: { type: String, default: '' },
    completedAt: Date,
    history: [
      {
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        fromStatus: String,
        toStatus: String,
        remarks: String,
      },
    ],
  },
  { timestamps: true },
);
completionSchema.index({ section: 1, chapter: 1 }, { unique: true });
completionSchema.index({ academicSession: 1, status: 1 });
export const CompletionModel = model('ChapterCompletionRecord', completionSchema);

const activitySchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    class: ref('SchoolClass'),
    section: ref('Section'),
    subject: ref('Subject'),
    chapter: ref('Chapter'),
    activityType: { type: String, enum: ACTIVITY_TYPES, required: true },
    applicable: { type: Boolean, default: true },
    percent: { type: Number, default: 0, min: 0, max: 100 },
    notes: { type: String, default: '' },
    updatedBy: ref('User', false),
    history: [
      {
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        applicable: Boolean,
        percent: Number,
      },
    ],
  },
  { timestamps: true },
);
activitySchema.index({ section: 1, chapter: 1, activityType: 1 }, { unique: true });
export const ActivityModel = model('ActivityRecord', activitySchema);

const assessmentSchema = new Schema(
  {
    academicSession: ref('AcademicSession'),
    type: { type: String, enum: ['WORKSHEET', 'TEST'], required: true },
    title: { type: String, required: true, trim: true },
    class: ref('SchoolClass'),
    section: ref('Section'),
    subject: ref('Subject'),
    chapters: [{ type: Schema.Types.ObjectId, ref: 'Chapter' }],
    date: { type: Date, required: true },
    maxMarks: { type: Number, default: 0, min: 0 },
    passMarks: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['PLANNED', 'CONDUCTED'], default: 'PLANNED' },
    createdBy: ref('User', false),
    results: [
      {
        rollNo: { type: String, required: true },
        studentName: { type: String, required: true },
        marksObtained: { type: Number, min: 0 },
        outcome: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true },
);
assessmentSchema.index({ academicSession: 1, section: 1, subject: 1, date: -1 });
export const AssessmentModel = model('Assessment', assessmentSchema);

const notificationSchema = new Schema(
  {
    user: ref('User'),
    type: {
      type: String,
      enum: ['PENDING_ACTIVITY', 'DELAYED_CHAPTER', 'UPCOMING_DEADLINE', 'REVIEW_REQUEST', 'ANNOUNCEMENT'],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    link: { type: String },
    dedupeKey: { type: String },
    readAt: Date,
  },
  { timestamps: true },
);
notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ user: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
export const NotificationModel = model('Notification', notificationSchema);

const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: ref('User', false),
  },
  { timestamps: true },
);
export const SettingModel = model('SystemSetting', settingSchema);
