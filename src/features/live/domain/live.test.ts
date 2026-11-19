// [LT] Live class rules: room states, the pop-quiz clock, attendance time and the heatmap.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { heartbeatSeconds, heatmap, liveClassState, quizClock, shieldWinners } from './live.ts';

const t0 = new Date('2026-11-20T14:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

describe('liveClassState', () => {
  it('is upcoming, then open 15 minutes early, live for its length, then ended', () => {
    expect(liveClassState(t0, 60, at(-16 * 60_000))).toBe('upcoming');
    expect(liveClassState(t0, 60, at(-10 * 60_000))).toBe('open');
    expect(liveClassState(t0, 60, at(30 * 60_000))).toBe('live');
    expect(liveClassState(t0, 60, at(60 * 60_000))).toBe('ended');
  });
});

describe('quizClock', () => {
  it('opens one question per minute for everyone, then is over', () => {
    expect(quizClock(t0, 3, at(0))).toMatchObject({ phase: 'running', index: 0 });
    expect(quizClock(t0, 3, at(61_000))).toMatchObject({
      phase: 'running',
      index: 1,
      closesAt: at(120_000),
    });
    expect(quizClock(t0, 3, at(180_000))).toEqual({ phase: 'over' });
  });
});

describe('heartbeatSeconds', () => {
  it('counts visible time since the last beat, capped at a minute', () => {
    expect(heartbeatSeconds(t0, at(30_000), true)).toBe(30);
    expect(heartbeatSeconds(t0, at(600_000), true)).toBe(60);
    expect(heartbeatSeconds(t0, at(30_000), false)).toBe(0);
    expect(heartbeatSeconds(null, at(30_000), true)).toBe(0);
  });
  it('is never negative or above the cap', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e9 }), fc.boolean(), (ms, v) => {
        const s = heartbeatSeconds(t0, at(ms), v);
        return s >= 0 && s <= 60;
      }),
    );
  });
});

describe('heatmap', () => {
  it('counts answers, right answers and each choice per question', () => {
    const rows = heatmap(
      [
        { questionId: 'a', correctIndex: 1 },
        { questionId: 'b', correctIndex: 0 },
      ],
      [
        { questionId: 'a', chosenIndex: 1 },
        { questionId: 'a', chosenIndex: 1 },
        { questionId: 'a', chosenIndex: 3 },
      ],
    );
    expect(rows[0]).toEqual({
      questionId: 'a',
      answered: 3,
      correct: 2,
      percent: 66,
      choices: [0, 2, 0, 1],
    });
    expect(rows[1]).toMatchObject({ answered: 0, percent: null });
  });
});

// [LT] US5.6: the fixed top N of a pop-quiz earn a streak-shield.
describe('shieldWinners', () => {
  const qs = ['q1', 'q2', 'q3'];
  const ans = (userId: string, questionId: string, isCorrect: boolean, ms: number) => ({
    userId,
    questionId,
    isCorrect,
    answeredAt: at(qs.indexOf(questionId) * 60_000 + ms),
  });
  it('AC5.6.1: ranks by score and takes exactly N', () => {
    const answers = [
      ans('a', 'q1', true, 1000),
      ans('a', 'q2', true, 1000),
      ans('b', 'q1', true, 1000),
      ans('c', 'q1', true, 2000),
      ans('d', 'q1', false, 500),
    ];
    expect(shieldWinners(t0, qs, answers, 2)).toEqual(['a', 'b']);
  });
  it('AC5.6.2: ties go to the lower total time, then the earlier last answer, then the lower ID', () => {
    expect(
      shieldWinners(t0, qs, [ans('x', 'q1', true, 5000), ans('y', 'q1', true, 3000)], 1),
    ).toEqual(['y']);
    expect(
      shieldWinners(
        t0,
        qs,
        [
          ans('x', 'q1', true, 1000),
          ans('x', 'q2', false, 3000),
          ans('y', 'q1', true, 3000),
          ans('y', 'q2', false, 1000),
        ],
        1,
      ),
    ).toEqual(['y']);
    expect(
      shieldWinners(t0, qs, [ans('n2', 'q1', true, 1000), ans('n1', 'q1', true, 1000)], 1),
    ).toEqual(['n1']);
  });
  it('AC5.6.3: fewer players than N: everyone with a score above 0 wins; 0 never does', () => {
    const answers = [ans('a', 'q1', true, 1000), ans('b', 'q1', false, 1000)];
    expect(shieldWinners(t0, qs, answers, 10)).toEqual(['a']);
  });
});
