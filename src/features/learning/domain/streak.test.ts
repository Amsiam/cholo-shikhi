// [LT] Goal streak (FR-RTN-1): Dhaka days, a run alive until midnight, reset after a missed day,
// no carry-over across Goals.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeStreak, dhakaDay, shiftDay } from './streak.ts';

describe('dhakaDay', () => {
  it('uses Asia/Dhaka (UTC+6) calendar days', () => {
    expect(dhakaDay(new Date('2026-11-17T17:59:00Z'))).toBe('2026-11-17');
    expect(dhakaDay(new Date('2026-11-17T18:00:00Z'))).toBe('2026-11-18');
  });
  it('shifts across month and year ends', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2027-03-01', -1)).toBe('2027-02-28');
  });
});

describe('computeStreak', () => {
  const today = '2026-11-18';
  it('counts consecutive days ending today', () => {
    expect(computeStreak(['2026-11-16', '2026-11-17', today], today, '2026-01-01')).toMatchObject({
      current: 3,
      isActiveToday: true,
    });
  });
  it('keeps a run alive until midnight when today has no activity yet', () => {
    expect(computeStreak(['2026-11-16', '2026-11-17'], today, '2026-01-01')).toMatchObject({
      current: 2,
      isActiveToday: false,
    });
  });
  it('resets to 0 after a whole missed day', () => {
    expect(computeStreak(['2026-11-15', '2026-11-16'], today, '2026-01-01').current).toBe(0);
  });
  it('ignores days before the current Goal was chosen (no carry-over)', () => {
    expect(computeStreak(['2026-11-16', '2026-11-17', today], today, '2026-11-17')).toMatchObject({
      current: 2,
      best: 2,
    });
  });
  it('reports the best run and a 7-day strip', () => {
    const s = computeStreak(
      ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-17'],
      today,
      '2026-01-01',
    );
    expect(s.best).toBe(3);
    expect(s.week.map((d) => d.isActive)).toEqual([false, false, false, false, false, true, false]);
    expect(s.week.at(-1)?.day).toBe(today);
  });
  it('current never exceeds best, and both stay within the counted days', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { maxLength: 40 }), (offsets) => {
        const days = offsets.map((n) => shiftDay(today, -n));
        const s = computeStreak(days, today, '2026-01-01');
        expect(s.current).toBeLessThanOrEqual(s.best);
        expect(s.best).toBeLessThanOrEqual(days.length);
      }),
    );
  });
});

// [LT] Streak-shields (US5.7): a shield forgives one whole missed day, oldest shield first.
describe('computeStreak with shields', () => {
  const run = (from: string, to: string) => {
    const out: string[] = [];
    for (let d = from; d <= to; d = shiftDay(d, 1)) out.push(d);
    return out;
  };
  const shield = (shieldId: string, earnedDay: string) => ({ shieldId, earnedDay });

  it('AC5.7.1: a 9-day run, a missed Tuesday and 2 shields: one is used, the streak stays 9', () => {
    // Nine days up to Monday 2026-11-16, Tuesday missed, read on Wednesday.
    const s = computeStreak(run('2026-11-08', '2026-11-16'), '2026-11-18', '2026-01-01', {
      usedDays: [],
      available: [shield('a', '2026-11-01'), shield('b', '2026-11-05')],
    });
    expect(s.current).toBe(9);
    expect(s.newUses).toEqual([{ shieldId: 'a', day: '2026-11-17' }]);
    expect(s.week.at(-2)).toMatchObject({ day: '2026-11-17', isActive: false, isShielded: true });
  });
  it('AC5.7.2: two missed days and two shields keep the run going', () => {
    const s = computeStreak(run('2026-11-10', '2026-11-15'), '2026-11-18', '2026-01-01', {
      usedDays: [],
      available: [shield('a', '2026-11-01'), shield('b', '2026-11-01')],
    });
    expect(s.current).toBe(6);
    expect(s.newUses.map((u) => u.day)).toEqual(['2026-11-16', '2026-11-17']);
  });
  it('AC5.7.3: two missed days and one shield reset the streak to 0', () => {
    const s = computeStreak(run('2026-11-10', '2026-11-15'), '2026-11-18', '2026-01-01', {
      usedDays: [],
      available: [shield('a', '2026-11-01')],
    });
    expect(s.current).toBe(0);
  });
  it('treats days forgiven earlier as covered and never spends a shield twice for them', () => {
    const s = computeStreak(
      [...run('2026-11-10', '2026-11-15'), '2026-11-17'],
      '2026-11-18',
      '2026-01-01',
      { usedDays: ['2026-11-16'], available: [shield('a', '2026-11-01')] },
    );
    expect(s.current).toBe(7);
    expect(s.newUses).toEqual([]);
  });
  it('only uses a shield earned on or before the missed day', () => {
    const s = computeStreak(run('2026-11-10', '2026-11-16'), '2026-11-18', '2026-01-01', {
      usedDays: [],
      available: [shield('late', '2026-11-18')],
    });
    expect(s.current).toBe(0);
    expect(s.newUses).toEqual([]);
  });
  it('does not spend shields when there is no run to save, nor for today', () => {
    expect(
      computeStreak([], '2026-11-18', '2026-01-01', {
        usedDays: [],
        available: [shield('a', '2026-11-01')],
      }).newUses,
    ).toEqual([]);
    const s = computeStreak(['2026-11-17'], '2026-11-18', '2026-01-01', {
      usedDays: [],
      available: [shield('a', '2026-11-01')],
    });
    expect(s).toMatchObject({ current: 1, newUses: [] });
  });
  it('a shielded day never adds to the streak, and shields used never exceed shields held', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 30 }), { maxLength: 30 }),
        fc.integer({ min: 0, max: 5 }),
        (offsets, n) => {
          const today = '2026-11-18';
          const days = offsets.map((o) => shiftDay(today, -o));
          const available = Array.from({ length: n }, (_, i) => shield(`s${i}`, '2026-01-01'));
          const s = computeStreak(days, today, '2026-01-01', { usedDays: [], available });
          expect(s.newUses.length).toBeLessThanOrEqual(n);
          expect(s.current).toBeLessThanOrEqual(days.length);
          expect(new Set(s.newUses.map((u) => u.shieldId)).size).toBe(s.newUses.length);
        },
      ),
    );
  });
});
