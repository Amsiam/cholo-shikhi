// [LT] Which course "continue where you left off" picks.
import { describe, expect, it } from 'vitest';
import type { MyCourse } from '../server/learning.types.ts';
import { resumeCourse } from './ContinueCard.tsx';

const course = (id: string, lastActiveAt: string | null, hasNext = true) =>
  ({
    courseId: id,
    lastActiveAt,
    nextLesson: hasNext ? { lessonId: `${id}-l`, kind: 'video', titleBn: '', titleEn: '' } : null,
  }) as unknown as MyCourse;

describe('resumeCourse', () => {
  it('picks the most recently active course with a lesson left', () => {
    expect(
      resumeCourse([
        course('a', '2026-11-01T00:00:00Z'),
        course('b', '2026-11-10T00:00:00Z'),
        course('c', '2026-11-12T00:00:00Z', false),
      ])?.courseId,
    ).toBe('b');
  });
  it('falls back to the first unstarted course, or none', () => {
    expect(resumeCourse([course('x', null), course('y', null)])?.courseId).toBe('x');
    expect(resumeCourse([course('z', '2026-11-01T00:00:00Z', false)])).toBeNull();
  });
});
