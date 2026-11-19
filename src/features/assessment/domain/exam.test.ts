// [LT] Exam marking, windows and the merit list.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  attemptDeadline,
  attemptOrder,
  dhakaLocalToUtc,
  isAcceptingAnswers,
  liveState,
  markAttempt,
  maskName,
  rankMerit,
  utcToDhakaLocal,
} from './exam.ts';

const key = [
  { questionId: 'a', correctIndex: 0 },
  { questionId: 'b', correctIndex: 1 },
  { questionId: 'c', correctIndex: 2 },
  { questionId: 'd', correctIndex: 3 },
];

describe('markAttempt', () => {
  it('one mark per right answer, half a mark off per wrong one, nothing for skipped', () => {
    expect(markAttempt(key, { a: 0, b: 1, c: 0 }, 5000)).toEqual({
      correct: 2,
      wrong: 1,
      skipped: 1,
      scoreX100: 150,
      maxX100: 400,
    });
  });
  it('without negative marking a wrong answer costs nothing', () => {
    expect(markAttempt(key, { a: 3, b: 3 }, 0).scoreX100).toBe(0);
  });
  it('counts always add up and the score never exceeds the maximum', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.constantFrom('a', 'b', 'c', 'd', 'zz'), fc.integer({ min: 0, max: 3 })),
        fc.integer({ min: 0, max: 10_000 }),
        (answers, bps) => {
          const m = markAttempt(key, answers, bps);
          return m.correct + m.wrong + m.skipped === 4 && m.scoreX100 <= m.maxX100;
        },
      ),
    );
  });
});

describe('windows', () => {
  const t0 = new Date('2026-11-20T14:00:00Z');
  it('a live window cuts an attempt short', () => {
    const end = new Date('2026-11-20T14:30:00Z');
    expect(attemptDeadline(new Date('2026-11-20T14:10:00Z'), 30, end)).toEqual(end);
    expect(attemptDeadline(t0, 20, end)).toEqual(new Date('2026-11-20T14:20:00Z'));
  });
  it('accepts answers until the deadline plus a short grace', () => {
    expect(isAcceptingAnswers(t0, new Date(t0.getTime() + 29_000))).toBe(true);
    expect(isAcceptingAnswers(t0, new Date(t0.getTime() + 31_000))).toBe(false);
  });
  it('a live exam is upcoming, open, then ended', () => {
    expect(liveState(t0, 60, new Date('2026-11-20T13:59:00Z'))).toBe('upcoming');
    expect(liveState(t0, 60, new Date('2026-11-20T14:30:00Z'))).toBe('open');
    expect(liveState(t0, 60, new Date('2026-11-20T15:00:00Z'))).toBe('ended');
  });
  it('reads Dhaka local time', () => {
    expect(dhakaLocalToUtc('2026-11-20T20:00')).toEqual(t0);
    expect(utcToDhakaLocal(t0)).toBe('2026-11-20T20:00');
    expect(dhakaLocalToUtc('20 Nov')).toBeNull();
  });
});

describe('merit list', () => {
  it('ranks by score, then speed; exact ties share a rank', () => {
    const ranked = rankMerit([
      { userId: 'a', scoreX100: 300, tookMs: 500 },
      { userId: 'b', scoreX100: 400, tookMs: 900 },
      { userId: 'c', scoreX100: 300, tookMs: 400 },
      { userId: 'd', scoreX100: 300, tookMs: 500 },
    ]);
    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
      ['d', 3],
    ]);
  });
  it('masks other names', () => {
    expect(maskName('Rahim Uddin')).toBe('Rahim U.');
    expect(maskName('  Nusrat ')).toBe('Nusrat');
    expect(maskName('আয়েশা সিদ্দিকা খান')).toBe('আয়েশা খ.');
  });
});

describe('attemptOrder', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `q${i}`);
  it('is a permutation, the same for the same attempt', () => {
    const a = attemptOrder(ids, 'attempt-1');
    expect([...a].sort()).toEqual([...ids].sort());
    expect(attemptOrder(ids, 'attempt-1')).toEqual(a);
  });
  it('differs between attempts', () => {
    expect(attemptOrder(ids, 'attempt-1')).not.toEqual(attemptOrder(ids, 'attempt-2'));
  });
});
