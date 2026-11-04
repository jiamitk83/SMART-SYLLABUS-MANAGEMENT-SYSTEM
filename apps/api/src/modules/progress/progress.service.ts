import {
  ACTIVITY_TYPES,
  DEFAULT_ACTIVITY_WEIGHTS,
  activityBreakdown,
  aggregateProgress,
  aggregatePlannedProgress,
  calculateChapterProgress,
  calculateTopicProgress,
  isChapterDelayed,
  summarizeProgress,
  validateWeights,
  type ActivityType,
  type ActivityWeights,
  type ChapterActivities,
  type ProgressSummary,
  type TeachingStatus,
} from '@ssms/shared';
import { ChapterModel, SectionModel, TeacherAssignmentModel, TopicModel } from '../../models/academic.models';
import { ActivityModel, CompletionModel, SettingModel, SyllabusPlanModel, TeachingRecordModel } from '../../models/planning.models';

export const WEIGHTS_KEY = 'activityWeights';

export async function getActivityWeights(): Promise<ActivityWeights> {
  const row = await SettingModel.findOne({ key: WEIGHTS_KEY }).lean();
  if (!row) return { ...DEFAULT_ACTIVITY_WEIGHTS };
  const value = row.value as ActivityWeights;
  try {
    validateWeights(value);
    return value;
  } catch {
    return { ...DEFAULT_ACTIVITY_WEIGHTS };
  }
}

export interface UnitFilter {
  academicSession: string;
  class?: string;
  section?: string;
  subject?: string;
  teacher?: string;
  chapter?: string;
}

export interface ProgressUnit {
  class: string;
  section: string;
  subject: string;
  chapter: string;
  chapterTitle: string;
  chapterOrder: number;
  weight: number | null;
  estimatedPeriods: number;
  teachers: string[];
  teachingPercent: number;
  progress: number;
  activities: ReturnType<typeof activityBreakdown>;
  isCompleted: boolean;
  completionStatus: string | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
}

const key = (...parts: unknown[]) => parts.map(String).join('|');

/** Central calculation of section × subject × chapter progress units for a session. */
export async function computeUnits(f: UnitFilter): Promise<ProgressUnit[]> {
  const weights = await getActivityWeights();
  const assignFilter: Record<string, unknown> = { academicSession: f.academicSession, isActive: true };
  if (f.class) assignFilter.class = f.class;
  if (f.section) assignFilter.section = f.section;
  if (f.subject) assignFilter.subject = f.subject;
  const allAssignments = await TeacherAssignmentModel.find(assignFilter).lean();
  const assignments = f.teacher ? allAssignments.filter((a) => String(a.teacher) === f.teacher) : allAssignments;
  if (!assignments.length) return [];

  const sectionSubject = new Map<string, { class: string; section: string; subject: string; teachers: Set<string> }>();
  for (const a of assignments) {
    const k = key(a.section, a.subject);
    const entry = sectionSubject.get(k) ?? { class: String(a.class), section: String(a.section), subject: String(a.subject), teachers: new Set<string>() };
    entry.teachers.add(String(a.teacher));
    sectionSubject.set(k, entry);
  }
  const classIds = [...new Set([...sectionSubject.values()].map((v) => v.class))];
  const subjectIds = [...new Set([...sectionSubject.values()].map((v) => v.subject))];
  const sectionIds = [...new Set([...sectionSubject.values()].map((v) => v.section))];

  const chapterFilter: Record<string, unknown> = {
    academicSession: f.academicSession,
    class: { $in: classIds },
    subject: { $in: subjectIds },
    isActive: true,
  };
  if (f.chapter) chapterFilter._id = f.chapter;
  const chapters = await ChapterModel.find(chapterFilter).lean();
  const chapterIds = chapters.map((c) => c._id);

  const [topics, records, activities, completions, plans] = await Promise.all([
    TopicModel.find({ chapter: { $in: chapterIds }, isActive: true }).lean(),
    TeachingRecordModel.find({ academicSession: f.academicSession, section: { $in: sectionIds }, chapter: { $in: chapterIds }, state: 'SUBMITTED' })
      .select('section chapter topic teachingStatus')
      .lean(),
    ActivityModel.find({ academicSession: f.academicSession, section: { $in: sectionIds }, chapter: { $in: chapterIds } }).lean(),
    CompletionModel.find({ academicSession: f.academicSession, section: { $in: sectionIds }, chapter: { $in: chapterIds } }).lean(),
    SyllabusPlanModel.find({ academicSession: f.academicSession, chapter: { $in: chapterIds }, isActive: true }).lean(),
  ]);

  const topicsByChapter = new Map<string, typeof topics>();
  for (const t of topics) {
    const k = String(t.chapter);
    topicsByChapter.set(k, [...(topicsByChapter.get(k) ?? []), t]);
  }
  const statusByTopic = new Map<string, TeachingStatus[]>();
  const statusByChapter = new Map<string, TeachingStatus[]>();
  for (const rec of records) {
    const target = rec.topic ? statusByTopic : statusByChapter;
    const k = rec.topic ? key(rec.section, rec.topic) : key(rec.section, rec.chapter);
    target.set(k, [...(target.get(k) ?? []), rec.teachingStatus as TeachingStatus]);
  }
  const activityMap = new Map(activities.map((a) => [key(a.section, a.chapter, a.activityType), a]));
  const completionMap = new Map(completions.map((c) => [key(c.section, c.chapter), c]));

  const sectionClass = new Map<string, string>();
  for (const s of await SectionModel.find({ _id: { $in: sectionIds } }).select('class').lean()) sectionClass.set(String(s._id), String(s.class));

  const units: ProgressUnit[] = [];
  for (const ss of sectionSubject.values()) {
    for (const ch of chapters) {
      if (String(ch.class) !== ss.class || String(ch.subject) !== ss.subject) continue;
      const chTopics = topicsByChapter.get(String(ch._id)) ?? [];
      let teachingPercent: number;
      // Chapter-level entries (no topic) describe the chapter as a whole. They never add to topic-level
      // progress: the chapter's teaching is the higher of the two, so the same work is not counted twice.
      const chapterLevel = calculateTopicProgress(statusByChapter.get(key(ss.section, ch._id)) ?? []);
      if (chTopics.length) {
        const totalW = chTopics.reduce((s, t) => s + (t.estimatedPeriods > 0 ? t.estimatedPeriods : 1), 0);
        const earned = chTopics.reduce(
          (s, t) => s + (t.estimatedPeriods > 0 ? t.estimatedPeriods : 1) * calculateTopicProgress(statusByTopic.get(key(ss.section, t._id)) ?? []),
          0,
        );
        teachingPercent = Math.max(totalW > 0 ? earned / totalW : 0, chapterLevel);
      } else {
        teachingPercent = Math.max(activityMap.get(key(ss.section, ch._id, 'TEACHING'))?.percent ?? 0, chapterLevel);
      }

      const chapterActivities: ChapterActivities = {};
      for (const type of ACTIVITY_TYPES) {
        const rec = activityMap.get(key(ss.section, ch._id, type));
        if (type === 'TEACHING') {
          chapterActivities.TEACHING = { applicable: rec ? rec.applicable : true, percent: teachingPercent };
        } else {
          chapterActivities[type] = { applicable: rec ? rec.applicable : true, percent: rec?.percent ?? 0 };
        }
      }

      const chPlans = plans.filter((p) => String(p.chapter) === String(ch._id) && (!p.section || String(p.section) === ss.section));
      const plannedStart = chPlans.length ? new Date(Math.min(...chPlans.map((p) => p.startDate.getTime()))) : null;
      const plannedEnd = chPlans.length ? new Date(Math.max(...chPlans.map((p) => p.endDate.getTime()))) : null;
      const completion = completionMap.get(key(ss.section, ch._id));

      units.push({
        class: ss.class,
        section: ss.section,
        subject: ss.subject,
        chapter: String(ch._id),
        chapterTitle: ch.title,
        chapterOrder: ch.order,
        weight: ch.weight ?? null,
        estimatedPeriods: ch.estimatedPeriods,
        teachers: [...ss.teachers],
        teachingPercent: Math.round(teachingPercent * 100) / 100,
        progress: calculateChapterProgress(chapterActivities, weights),
        activities: activityBreakdown(chapterActivities, weights),
        isCompleted: completion?.status === 'APPROVED',
        completionStatus: completion?.status ?? null,
        plannedStart,
        plannedEnd,
      });
    }
  }
  return units;
}

export function summarizeUnits(units: ProgressUnit[], asOf: Date): ProgressSummary & { chapters: number; completedChapters: number; delayedChapters: number } {
  const s = summarizeProgress(
    units.map((u) => ({ progress: u.progress, weight: u.weight, estimatedPeriods: u.estimatedPeriods, isCompleted: u.isCompleted, plannedStart: u.plannedStart, plannedEnd: u.plannedEnd })),
    asOf,
  );
  return {
    ...s,
    chapters: units.length,
    completedChapters: units.filter((u) => u.isCompleted).length,
    delayedChapters: units.filter((u) => isChapterDelayed(u, asOf)).length,
  };
}

export function groupSummary<K extends string>(
  units: ProgressUnit[],
  keyOf: (u: ProgressUnit) => string,
  asOf: Date,
): Array<{ key: string } & ReturnType<typeof summarizeUnits>> {
  const groups = new Map<string, ProgressUnit[]>();
  for (const u of units) groups.set(keyOf(u), [...(groups.get(keyOf(u)) ?? []), u]);
  return [...groups.entries()].map(([k, list]) => ({ key: k, ...summarizeUnits(list, asOf) }));
}

export { aggregateProgress, aggregatePlannedProgress };
export type { ActivityType };
