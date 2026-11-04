import { ACTIVITY_TYPES, DEFAULT_ACTIVITY_WEIGHTS, type ActivityType, type TeachingStatus } from './roles';

export type ActivityWeights = Record<ActivityType, number>;

export interface ActivityInput {
  applicable: boolean;
  /** Percentage of the activity done, 0..100. */
  percent: number;
}

export type ChapterActivities = Partial<Record<ActivityType, ActivityInput>>;

export const ACTIVITY_STATUSES = ['PENDING', 'COMPLETED', 'NOT_APPLICABLE'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
/** PARTIAL only describes legacy records with a stored percentage between 0 and 100. */
export type DisplayActivityStatus = ActivityStatus | 'PARTIAL';

export const ACTIVITY_STATUS_LABEL: Record<DisplayActivityStatus, string> = {
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  NOT_APPLICABLE: 'N/A',
  PARTIAL: 'Partial',
};

/** Completed = 100%, Pending = 0%, N/A = excluded from the weighted calculation. */
export function statusToInput(status: ActivityStatus): ActivityInput {
  if (status === 'NOT_APPLICABLE') return { applicable: false, percent: 0 };
  return { applicable: true, percent: status === 'COMPLETED' ? 100 : 0 };
}

export function activityStatusOf(input: { applicable?: boolean; percent?: number } | undefined | null): DisplayActivityStatus {
  if (!input || input.applicable === false) return 'NOT_APPLICABLE';
  const p = clampPercent(input.percent ?? 0);
  if (p >= 100) return 'COMPLETED';
  return p <= 0 ? 'PENDING' : 'PARTIAL';
}

export class ProgressError extends Error {}

const EPS = 1e-9;

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function validateWeights(weights: ActivityWeights): void {
  let total = 0;
  for (const type of ACTIVITY_TYPES) {
    const w = weights[type];
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) {
      throw new ProgressError(`Invalid weight for ${type}`);
    }
    total += w;
  }
  if (Math.abs(total - 100) > EPS) {
    throw new ProgressError(`Activity weights must total 100 (got ${total})`);
  }
}

/**
 * Weighted chapter progress. Non-applicable activities are excluded and the
 * remaining weights are normalised so they still represent 100%.
 * Each activity is counted exactly once. Returns 0 when nothing is applicable.
 */
export function calculateChapterProgress(
  activities: ChapterActivities,
  weights: ActivityWeights = DEFAULT_ACTIVITY_WEIGHTS,
): number {
  validateWeights(weights);
  let applicableWeight = 0;
  let earned = 0;
  for (const type of ACTIVITY_TYPES) {
    const input = activities[type];
    if (!input || !input.applicable) continue;
    const w = weights[type];
    applicableWeight += w;
    earned += w * clampPercent(input.percent);
  }
  if (applicableWeight <= EPS) return 0;
  return round2(earned / applicableWeight);
}

export function activityBreakdown(
  activities: ChapterActivities,
  weights: ActivityWeights = DEFAULT_ACTIVITY_WEIGHTS,
): Array<{ type: ActivityType; applicable: boolean; percent: number; normalizedWeight: number }> {
  validateWeights(weights);
  const applicableWeight = ACTIVITY_TYPES.reduce(
    (sum, t) => sum + (activities[t]?.applicable ? weights[t] : 0),
    0,
  );
  return ACTIVITY_TYPES.map((type) => {
    const input = activities[type];
    const applicable = Boolean(input?.applicable);
    return {
      type,
      applicable,
      percent: applicable ? clampPercent(input?.percent ?? 0) : 0,
      normalizedWeight: applicable && applicableWeight > EPS ? round2((weights[type] / applicableWeight) * 100) : 0,
    };
  });
}

export const TOPIC_STATUS_PERCENT: Record<TeachingStatus, number> = {
  COMPLETED: 100,
  PARTIAL: 50,
  NOT_TAUGHT: 0,
};

/** Topic progress is the best status recorded across its submitted teaching entries. */
export function calculateTopicProgress(statuses: TeachingStatus[]): number {
  let best = 0;
  for (const s of statuses) best = Math.max(best, TOPIC_STATUS_PERCENT[s]);
  return best;
}

export interface WeightedChapter {
  progress: number;
  /** Approved chapter weight; falls back to estimatedPeriods when absent or zero. */
  weight?: number | null;
  estimatedPeriods?: number | null;
}

export function chapterWeight(chapter: Pick<WeightedChapter, 'weight' | 'estimatedPeriods'>): number {
  if (chapter.weight && chapter.weight > 0) return chapter.weight;
  if (chapter.estimatedPeriods && chapter.estimatedPeriods > 0) return chapter.estimatedPeriods;
  return 0;
}

/**
 * Weighted aggregate of chapter progress values. Never an unweighted mean when
 * chapters carry weights. Chapters without any weight are counted with weight 1
 * only if every chapter is unweighted; otherwise they are excluded.
 */
export function aggregateProgress(chapters: WeightedChapter[]): number {
  if (chapters.length === 0) return 0;
  const weights = chapters.map(chapterWeight);
  const anyWeighted = weights.some((w) => w > 0);
  const effective = anyWeighted ? weights : weights.map(() => 1);
  const total = effective.reduce((a, b) => a + b, 0);
  if (total <= EPS) return 0;
  const earned = chapters.reduce((sum, c, i) => sum + (effective[i] ?? 0) * clampPercent(c.progress), 0);
  return round2(earned / total);
}

export interface PlannedChapter {
  weight?: number | null;
  estimatedPeriods?: number | null;
  plannedStart?: Date | null;
  plannedEnd?: Date | null;
}

/** Planned progress as of a date: 0 before start, 100 after end, linear in between. */
export function plannedChapterProgress(chapter: PlannedChapter, asOf: Date): number {
  const { plannedStart, plannedEnd } = chapter;
  if (!plannedStart || !plannedEnd) return 0;
  if (plannedEnd < plannedStart) throw new ProgressError('Planned end precedes planned start');
  const t = asOf.getTime();
  if (t < plannedStart.getTime()) return 0;
  if (t >= plannedEnd.getTime()) return 100;
  const span = plannedEnd.getTime() - plannedStart.getTime();
  return round2(((t - plannedStart.getTime()) / span) * 100);
}

export function aggregatePlannedProgress(chapters: PlannedChapter[], asOf: Date): number {
  return aggregateProgress(
    chapters.map((c) => ({ ...c, progress: plannedChapterProgress(c, asOf) })),
  );
}

export interface ProgressSummary {
  planned: number;
  actual: number;
  completed: number;
  pending: number;
  delayed: number;
}

export interface SummaryChapter extends PlannedChapter {
  progress: number;
  isCompleted: boolean;
}

/**
 * Planned vs actual vs completed vs pending vs delayed.
 * completed: weighted share of chapters formally marked complete.
 * pending: 100 - actual.
 * delayed: weighted share of chapters whose planned end passed but are not complete.
 */
export function summarizeProgress(chapters: SummaryChapter[], asOf: Date): ProgressSummary {
  const actual = aggregateProgress(chapters);
  const planned = aggregatePlannedProgress(chapters, asOf);
  const completed = aggregateProgress(chapters.map((c) => ({ ...c, progress: c.isCompleted ? 100 : 0 })));
  const delayed = aggregateProgress(
    chapters.map((c) => ({
      ...c,
      progress: !c.isCompleted && c.plannedEnd && c.plannedEnd.getTime() < asOf.getTime() ? 100 : 0,
    })),
  );
  return { planned, actual, completed, pending: round2(100 - actual), delayed };
}

export function isChapterDelayed(
  chapter: { plannedEnd?: Date | null; isCompleted: boolean },
  asOf: Date,
): boolean {
  return !chapter.isCompleted && !!chapter.plannedEnd && chapter.plannedEnd.getTime() < asOf.getTime();
}
