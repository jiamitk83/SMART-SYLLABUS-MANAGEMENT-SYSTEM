import { describe, expect, it } from 'vitest';
import {
  aggregatePlannedProgress,
  aggregateProgress,
  calculateChapterProgress,
  calculateTopicProgress,
  summarizeProgress,
  validateWeights,
  activityBreakdown,
  DEFAULT_ACTIVITY_WEIGHTS,
  ProgressError,
} from './index';

const all = (percent: number) => ({
  TEACHING: { applicable: true, percent },
  NOTEBOOK_WORK: { applicable: true, percent },
  NOTEBOOK_CORRECTION: { applicable: true, percent },
  WORKSHEET: { applicable: true, percent },
  TEST: { applicable: true, percent },
  REVISION: { applicable: true, percent },
});

describe('weights', () => {
  it('defaults total 100', () => {
    expect(() => validateWeights(DEFAULT_ACTIVITY_WEIGHTS)).not.toThrow();
  });
  it('rejects totals other than 100', () => {
    expect(() => validateWeights({ ...DEFAULT_ACTIVITY_WEIGHTS, TEACHING: 50 })).toThrow(ProgressError);
  });
  it('rejects negative weights', () => {
    expect(() => validateWeights({ ...DEFAULT_ACTIVITY_WEIGHTS, TEACHING: 50, TEST: -10 })).toThrow(ProgressError);
  });
});

describe('chapter progress', () => {
  it('is 100 when all activities complete', () => {
    expect(calculateChapterProgress(all(100))).toBe(100);
  });
  it('teaching alone is only 40%', () => {
    expect(calculateChapterProgress({ ...all(0), TEACHING: { applicable: true, percent: 100 } })).toBe(40);
  });
  it('missing activities count as not started, not as complete', () => {
    expect(calculateChapterProgress({})).toBe(0);
  });
  it('excludes N/A activities and normalises weights', () => {
    const a = { ...all(100), TEST: { applicable: false, percent: 0 }, REVISION: { applicable: false, percent: 0 } };
    expect(calculateChapterProgress(a)).toBe(100);
    const b = { ...a, TEACHING: { applicable: true, percent: 50 } };
    // applicable weight 80; earned 40*50 + 40*100 = 6000 => 75
    expect(calculateChapterProgress(b)).toBe(75);
  });
  it('returns 0 when nothing applicable', () => {
    const none = Object.fromEntries(Object.keys(all(0)).map((k) => [k, { applicable: false, percent: 100 }]));
    expect(calculateChapterProgress(none)).toBe(0);
  });
  it('clamps out-of-range percentages', () => {
    expect(calculateChapterProgress({ TEACHING: { applicable: true, percent: 250 } })).toBe(100);
    expect(calculateChapterProgress({ TEACHING: { applicable: true, percent: -5 } })).toBe(0);
  });
  it('supports custom weights', () => {
    const w = { TEACHING: 70, NOTEBOOK_WORK: 10, NOTEBOOK_CORRECTION: 5, WORKSHEET: 5, TEST: 5, REVISION: 5 };
    expect(calculateChapterProgress({ TEACHING: { applicable: true, percent: 100 }, ...{} }, w)).toBe(100);
    expect(
      calculateChapterProgress({ ...all(0), TEACHING: { applicable: true, percent: 100 } }, w),
    ).toBe(70);
  });
  it('breakdown normalised weights sum to 100 for applicable activities', () => {
    const rows = activityBreakdown({ ...all(10), TEST: { applicable: false, percent: 0 } });
    const sum = rows.reduce((s, r) => s + r.normalizedWeight, 0);
    expect(Math.round(sum)).toBe(100);
    expect(rows.find((r) => r.type === 'TEST')?.normalizedWeight).toBe(0);
  });
});

describe('topic progress', () => {
  it('uses best status', () => {
    expect(calculateTopicProgress([])).toBe(0);
    expect(calculateTopicProgress(['NOT_TAUGHT', 'PARTIAL'])).toBe(50);
    expect(calculateTopicProgress(['PARTIAL', 'COMPLETED'])).toBe(100);
  });
});

describe('aggregation', () => {
  it('is weighted, not an unweighted mean', () => {
    const r = aggregateProgress([
      { progress: 100, weight: 9 },
      { progress: 0, weight: 1 },
    ]);
    expect(r).toBe(90);
  });
  it('falls back to estimated periods', () => {
    expect(
      aggregateProgress([
        { progress: 100, estimatedPeriods: 3 },
        { progress: 0, estimatedPeriods: 1 },
      ]),
    ).toBe(75);
  });
  it('approved weight overrides estimated periods', () => {
    expect(
      aggregateProgress([
        { progress: 100, weight: 1, estimatedPeriods: 100 },
        { progress: 0, weight: 1, estimatedPeriods: 1 },
      ]),
    ).toBe(50);
  });
  it('equal weight when no chapter is weighted', () => {
    expect(aggregateProgress([{ progress: 100 }, { progress: 0 }])).toBe(50);
  });
  it('empty list is 0', () => {
    expect(aggregateProgress([])).toBe(0);
  });
});

describe('planned progress and summary', () => {
  const d = (s: string) => new Date(s);
  it('is linear between start and end', () => {
    const p = aggregatePlannedProgress(
      [{ weight: 1, plannedStart: d('2026-04-01'), plannedEnd: d('2026-04-11') }],
      d('2026-04-06'),
    );
    expect(p).toBe(50);
  });
  it('is 0 before and 100 after', () => {
    const c = [{ weight: 1, plannedStart: d('2026-04-01'), plannedEnd: d('2026-04-11') }];
    expect(aggregatePlannedProgress(c, d('2026-03-01'))).toBe(0);
    expect(aggregatePlannedProgress(c, d('2026-05-01'))).toBe(100);
  });
  it('throws on inverted dates', () => {
    expect(() =>
      aggregatePlannedProgress([{ plannedStart: d('2026-04-11'), plannedEnd: d('2026-04-01') }], d('2026-04-05')),
    ).toThrow(ProgressError);
  });
  it('summarises planned, actual, completed, pending and delayed', () => {
    const s = summarizeProgress(
      [
        { weight: 1, progress: 100, isCompleted: true, plannedStart: d('2026-04-01'), plannedEnd: d('2026-04-10') },
        { weight: 1, progress: 40, isCompleted: false, plannedStart: d('2026-04-01'), plannedEnd: d('2026-04-10') },
      ],
      d('2026-05-01'),
    );
    expect(s).toEqual({ planned: 100, actual: 70, completed: 50, pending: 30, delayed: 50 });
  });
  it('teaching entries do not complete a chapter', () => {
    const s = summarizeProgress([{ weight: 1, progress: 40, isCompleted: false }], d('2026-05-01'));
    expect(s.completed).toBe(0);
  });
});
