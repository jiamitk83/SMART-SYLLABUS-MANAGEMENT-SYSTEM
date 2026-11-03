import {
  ChapterModel,
  ClassModel,
  SubjectModel,
  SubtopicModel,
  SyllabusVersionModel,
  TopicModel,
} from '../../models/academic.models';
import { badRequest, notFound } from '../../utils/errors';

export interface TreeSubtopic {
  id: string;
  title: string;
  order: number;
  isActive: boolean;
}
export interface TreeTopic {
  id: string;
  title: string;
  order: number;
  estimatedPeriods: number;
  isActive: boolean;
  subtopics: TreeSubtopic[];
}
export interface TreeChapter {
  id: string;
  title: string;
  order: number;
  estimatedPeriods: number;
  importance: string;
  weight?: number;
  isActive: boolean;
  topics: TreeTopic[];
}

export async function buildTree(academicSession: string, cls: string, subject: string): Promise<TreeChapter[]> {
  const chapters = await ChapterModel.find({ academicSession, class: cls, subject }).sort({ order: 1 }).lean();
  const ids = chapters.map((c) => c._id);
  const [topics, subtopics] = await Promise.all([
    TopicModel.find({ chapter: { $in: ids } }).sort({ order: 1 }).lean(),
    SubtopicModel.find({ chapter: { $in: ids } }).sort({ order: 1 }).lean(),
  ]);
  return chapters.map((c) => ({
    id: String(c._id),
    title: c.title,
    order: c.order,
    estimatedPeriods: c.estimatedPeriods,
    importance: c.importance,
    weight: c.weight ?? undefined,
    isActive: c.isActive,
    topics: topics
      .filter((t) => String(t.chapter) === String(c._id))
      .map((t) => ({
        id: String(t._id),
        title: t.title,
        order: t.order,
        estimatedPeriods: t.estimatedPeriods,
        isActive: t.isActive,
        subtopics: subtopics
          .filter((s) => String(s.topic) === String(t._id))
          .map((s) => ({ id: String(s._id), title: s.title, order: s.order, isActive: s.isActive })),
      })),
  }));
}

export async function recordVersion(
  academicSession: string,
  cls: string,
  subject: string,
  userId: string | undefined,
  reason: string,
): Promise<void> {
  const last = await SyllabusVersionModel.findOne({ academicSession, class: cls, subject }).sort({ version: -1 }).select('version').lean();
  await SyllabusVersionModel.create({
    academicSession,
    class: cls,
    subject,
    version: (last?.version ?? 0) + 1,
    reason,
    changedBy: userId,
    snapshot: await buildTree(academicSession, cls, subject),
  });
}

export interface ImportChapter {
  title: string;
  order?: number;
  estimatedPeriods?: number;
  importance?: 'LOW' | 'MEDIUM' | 'HIGH';
  weight?: number;
  topics?: Array<{ title: string; estimatedPeriods?: number; subtopics?: Array<{ title: string }> }>;
}

export interface ImportReport {
  chaptersCreated: number;
  chaptersSkipped: number;
  topicsCreated: number;
  subtopicsCreated: number;
}

/** Adds missing chapters/topics/subtopics by title. Existing records are never overwritten. */
export async function importTree(
  academicSession: string,
  cls: string,
  subject: string,
  chapters: ImportChapter[],
): Promise<ImportReport> {
  const report: ImportReport = { chaptersCreated: 0, chaptersSkipped: 0, topicsCreated: 0, subtopicsCreated: 0 };
  let nextOrder = ((await ChapterModel.findOne({ academicSession, class: cls, subject }).sort({ order: -1 }).select('order').lean())?.order ?? 0) + 1;
  for (const ch of chapters) {
    let chapter = await ChapterModel.findOne({ academicSession, class: cls, subject, title: ch.title });
    if (chapter) report.chaptersSkipped += 1;
    else {
      chapter = await ChapterModel.create({
        academicSession,
        class: cls,
        subject,
        title: ch.title,
        order: ch.order ?? nextOrder,
        estimatedPeriods: ch.estimatedPeriods ?? 1,
        importance: ch.importance ?? 'MEDIUM',
        weight: ch.weight,
      });
      nextOrder = Math.max(nextOrder, chapter.order) + 1;
      report.chaptersCreated += 1;
    }
    let topicOrder = ((await TopicModel.findOne({ chapter: chapter._id }).sort({ order: -1 }).select('order').lean())?.order ?? 0) + 1;
    for (const tp of ch.topics ?? []) {
      let topic = await TopicModel.findOne({ chapter: chapter._id, title: tp.title });
      if (!topic) {
        topic = await TopicModel.create({ academicSession, chapter: chapter._id, title: tp.title, order: topicOrder++, estimatedPeriods: tp.estimatedPeriods ?? 1 });
        report.topicsCreated += 1;
      }
      let subOrder = ((await SubtopicModel.findOne({ topic: topic._id }).sort({ order: -1 }).select('order').lean())?.order ?? 0) + 1;
      for (const st of tp.subtopics ?? []) {
        if (await SubtopicModel.exists({ topic: topic._id, title: st.title })) continue;
        await SubtopicModel.create({ academicSession, chapter: chapter._id, topic: topic._id, title: st.title, order: subOrder++ });
        report.subtopicsCreated += 1;
      }
    }
  }
  return report;
}

export async function copySyllabus(
  fromSession: string,
  toSession: string,
  opts: { classId?: string; subjectId?: string },
  userId: string | undefined,
): Promise<ImportReport & { classesProcessed: number; unmatchedClasses: string[] }> {
  if (fromSession === toSession) throw badRequest('Source and target sessions must differ');
  const sourceClasses = await ClassModel.find({ academicSession: fromSession, ...(opts.classId ? { _id: opts.classId } : {}) }).lean();
  if (!sourceClasses.length) throw notFound('No source classes found');
  const subjects = await SubjectModel.find(opts.subjectId ? { _id: opts.subjectId } : {}).lean();
  const total = { chaptersCreated: 0, chaptersSkipped: 0, topicsCreated: 0, subtopicsCreated: 0, classesProcessed: 0, unmatchedClasses: [] as string[] };
  for (const sc of sourceClasses) {
    const target = await ClassModel.findOne({ academicSession: toSession, name: sc.name }).lean();
    if (!target) {
      total.unmatchedClasses.push(sc.name);
      continue;
    }
    total.classesProcessed += 1;
    for (const subj of subjects) {
      const tree = await buildTree(fromSession, String(sc._id), String(subj._id));
      if (!tree.length) continue;
      const rep = await importTree(
        toSession,
        String(target._id),
        String(subj._id),
        tree.map((c) => ({
          title: c.title,
          order: c.order,
          estimatedPeriods: c.estimatedPeriods,
          importance: c.importance as 'LOW' | 'MEDIUM' | 'HIGH',
          weight: c.weight,
          topics: c.topics.map((t) => ({ title: t.title, estimatedPeriods: t.estimatedPeriods, subtopics: t.subtopics.map((s) => ({ title: s.title })) })),
        })),
      );
      total.chaptersCreated += rep.chaptersCreated;
      total.chaptersSkipped += rep.chaptersSkipped;
      total.topicsCreated += rep.topicsCreated;
      total.subtopicsCreated += rep.subtopicsCreated;
      if (rep.chaptersCreated || rep.topicsCreated) await recordVersion(toSession, String(target._id), String(subj._id), userId, 'Copied from another academic session');
    }
  }
  return total;
}
