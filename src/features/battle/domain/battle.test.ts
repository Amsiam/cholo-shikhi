// [LT] Battle rules: lifecycle, joining, ranking, room codes and question choice.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type BattleClock,
  canJoin,
  chooseQuestions,
  effectiveStatus,
  makeJoinCode,
  normaliseJoinCode,
  QUICK_WAIT_MS,
  rankStandings,
} from './battle.ts';

const t0 = new Date('2026-11-20T10:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const base: BattleClock = {
  mode: 'quick',
  status: 'waiting',
  createdAt: t0,
  startsAt: null,
  endsAt: null,
  playerCount: 1,
};

describe('lifecycle', () => {
  it('a lonely quick match is called off after 90 seconds', () => {
    expect(effectiveStatus(base, at(QUICK_WAIT_MS - 1))).toBe('waiting');
    expect(effectiveStatus(base, at(QUICK_WAIT_MS))).toBe('cancelled');
  });
  it('a hosted battle starts on time and finishes when time is up', () => {
    const hosted = { ...base, mode: 'hosted' as const, startsAt: at(60_000), endsAt: at(360_000) };
    expect(effectiveStatus(hosted, at(0))).toBe('waiting');
    expect(effectiveStatus(hosted, at(60_000))).toBe('running');
    expect(effectiveStatus(hosted, at(360_000))).toBe('finished');
  });
  it('a running battle finishes at its end', () => {
    const running = { ...base, status: 'running' as const, endsAt: at(300_000), playerCount: 2 };
    expect(effectiveStatus(running, at(299_999))).toBe('running');
    expect(effectiveStatus(running, at(300_000))).toBe('finished');
  });
  it('joining: open while waiting and not full; hosted takes latecomers for a minute', () => {
    expect(canJoin(base, 2, at(0))).toBe(true);
    expect(canJoin({ ...base, playerCount: 2 }, 2, at(0))).toBe(false);
    const hosted = { ...base, mode: 'hosted' as const, startsAt: at(0), endsAt: at(300_000) };
    expect(canJoin(hosted, 500, at(59_000))).toBe(true);
    expect(canJoin(hosted, 500, at(61_000))).toBe(false);
  });
});

describe('ranking', () => {
  it('most right first, then faster; exact ties share a place', () => {
    const ranked = rankStandings([
      { userId: 'a', correct: 7, tookMs: 100, finished: true },
      { userId: 'b', correct: 9, tookMs: 900, finished: true },
      { userId: 'c', correct: 7, tookMs: 100, finished: true },
      { userId: 'd', correct: 7, tookMs: 50, finished: true },
    ]);
    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([
      ['b', 1],
      ['d', 2],
      ['a', 3],
      ['c', 3],
    ]);
  });
});

describe('codes and questions', () => {
  it('room codes are six unambiguous characters and read back however typed', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.999999, noNaN: true }), (r) =>
        /^[A-HJKMNP-Z2-9]{6}$/.test(makeJoinCode(() => r)),
      ),
    );
    expect(normaliseJoinCode(' ab3-k9q ')).toBe('AB3K9Q');
  });
  it('vault questions first, topped up from the bank, no repeats', () => {
    const ids = chooseQuestions(['v1', 'v2'], ['v1', 'b1', 'b2', 'b3'], 4, () => 0.3);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids.slice(0, 2).sort()).toEqual(['v1', 'v2']);
    expect(chooseQuestions([], ['b1'], 10, Math.random)).toEqual(['b1']);
  });
});
