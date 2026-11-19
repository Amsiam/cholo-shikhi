// [LT] Free trial caps (FR-DIST-1): 30 days or the first 5 lessons, whichever first.
import { describe, expect, it } from 'vitest';
import { TRIAL_DAYS, TRIAL_LESSONS, trialEndsAt, trialLessonIds, trialState } from './trial.ts';

const now = new Date('2026-11-18T06:00:00Z');
const lessons = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'];

describe('trial', () => {
  it('opens the first 5 lessons for 30 days', () => {
    expect([TRIAL_DAYS, TRIAL_LESSONS]).toEqual([30, 5]);
    expect(trialLessonIds(lessons)).toEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
    expect(trialLessonIds(['a', 'b'])).toEqual(['a', 'b']);
    expect(trialEndsAt(now).toISOString()).toBe('2026-12-18T06:00:00.000Z');
  });
  it('is active while days and open lessons remain', () => {
    const s = trialState(trialEndsAt(now), trialLessonIds(lessons), new Set(['l1', 'l6']), now);
    expect(s).toEqual({ isExpired: false, daysLeft: 30, lessonsUsed: 1, lessonLimit: 5 });
  });
  it('expires when all open lessons are done, even with days left', () => {
    const done = new Set(['l1', 'l2', 'l3', 'l4', 'l5']);
    expect(trialState(trialEndsAt(now), trialLessonIds(lessons), done, now).isExpired).toBe(true);
  });
  it('expires when the days run out, even with lessons left', () => {
    const later = new Date(trialEndsAt(now).getTime() + 1);
    expect(trialState(trialEndsAt(now), trialLessonIds(lessons), new Set(), later)).toMatchObject({
      isExpired: true,
      daysLeft: 0,
    });
  });
});
