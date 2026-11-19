// [LT] Course statistics arithmetic.
import { describe, expect, it } from 'vitest';
import {
  enrolmentsByMonth,
  fillMonths,
  lastMonths,
  pageOfStudents,
  ratioBps,
  repeatStudents,
  studentRows,
  summarizeStudents,
} from './insights.ts';

describe('months', () => {
  it('lists the last months in Dhaka time, crossing a year', () => {
    // 2026-12-31T19:00Z is already 1 January 2027 in Dhaka (UTC+6).
    expect(lastMonths(new Date('2026-12-31T19:00:00Z'), 3)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });

  it('fills missing months with zero', () => {
    expect(fillMonths([{ month: '2026-10', amount: 5, sales: 1 }], ['2026-09', '2026-10'])).toEqual(
      [
        { month: '2026-09', amount: 0, sales: 0 },
        { month: '2026-10', amount: 5, sales: 1 },
      ],
    );
  });

  it('counts enrolments by Dhaka month', () => {
    const e = (startsAt: string) => ({
      userId: 'u',
      status: 'active' as const,
      startsAt,
      endsAt: startsAt,
    });
    expect(
      enrolmentsByMonth(
        [e('2026-10-31T19:00:00Z'), e('2026-10-15T00:00:00Z')],
        ['2026-10', '2026-11'],
      ),
    ).toEqual([
      { month: '2026-10', count: 1 },
      { month: '2026-11', count: 1 },
    ]);
  });
});

describe('ratioBps', () => {
  it('rounds down, caps at 100% and handles zero', () => {
    expect(ratioBps(1, 3)).toBe(3333);
    expect(ratioBps(5, 3)).toBe(10_000);
    expect(ratioBps(1, 0)).toBe(0);
  });
});

const enrol = (userId: string, startsAt: string, status: 'active' | 'expired' = 'active') => ({
  userId,
  status,
  startsAt,
  endsAt: '2027-12-01T00:00:00Z',
});

describe('students', () => {
  const rows = studentRows(
    [
      enrol('a', '2026-10-01T00:00:00Z', 'expired'),
      enrol('a', '2026-11-01T00:00:00Z'),
      enrol('b', '2026-09-01T00:00:00Z'),
      enrol('c', '2026-08-01T00:00:00Z'),
    ],
    [
      { userId: 'a', completed: 4, lastActiveAt: '2026-11-17T00:00:00Z' },
      { userId: 'b', completed: 9, lastActiveAt: '2026-10-01T00:00:00Z' },
    ],
    { a: 'Ayesha', b: 'Bilal', c: 'Chaity' },
    4,
  );

  it('keeps each student once with their newest enrolment, newest first, progress capped', () => {
    expect(rows.map((r) => [r.userId, r.status, r.progressBps])).toEqual([
      ['a', 'active', 10_000],
      ['b', 'active', 10_000],
      ['c', 'active', 0],
    ]);
  });

  it('summarizes progress, completion and recent activity', () => {
    expect(summarizeStudents(rows, new Date('2026-11-18T00:00:00Z'))).toEqual({
      students: 3,
      active: 3,
      recentlyActive: 1,
      averageProgressBps: 6666,
      completionRateBps: 6666,
    });
    expect(summarizeStudents([], new Date()).averageProgressBps).toBe(0);
  });

  it('searches by name and clamps the page', () => {
    expect(pageOfStudents(rows, 'BIL', 1, 10).rows.map((r) => r.name)).toEqual(['Bilal']);
    const last = pageOfStudents(rows, '', 99, 2);
    expect([last.page, last.pageCount, last.rows.length, last.total]).toEqual([2, 2, 1, 3]);
    expect(pageOfStudents(rows, 'zzz', 1, 10)).toMatchObject({ total: 0, page: 1, pageCount: 1 });
  });
});

describe('repeatStudents (FR7.9)', () => {
  const e = (userId: string, courseId: string, startsAt: string) => ({
    userId,
    courseId,
    startsAt,
  });
  it('counts a Student who took a second course within 12 months, once', () => {
    expect(
      repeatStudents([
        e('a', 'c1', '2026-01-10T00:00:00Z'),
        e('a', 'c2', '2026-06-01T00:00:00Z'),
        e('a', 'c3', '2026-07-01T00:00:00Z'),
        e('b', 'c1', '2025-01-01T00:00:00Z'),
        e('b', 'c2', '2026-06-01T00:00:00Z'),
        e('c', 'c1', '2026-01-01T00:00:00Z'),
        e('c', 'c1', '2026-05-01T00:00:00Z'),
      ]),
    ).toEqual({ students: 3, repeat: 1 });
  });
  it('is empty without enrolments', () => {
    expect(repeatStudents([])).toEqual({ students: 0, repeat: 0 });
  });
});
