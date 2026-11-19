// [LT] Mistake Vault rules (FR-ADP-1): wrong answers enter, two in a row master, order by Goal.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyPracticeAnswer,
  MASTERY_STREAK,
  practiceQueue,
  type QueueItem,
  recordWrong,
} from './vault.ts';

const t = (n: number) => new Date(Date.UTC(2026, 10, 1, 0, n));

describe('recordWrong', () => {
  it('opens a new active item', () => {
    expect(recordWrong(null, t(1))).toMatchObject({
      status: 'active',
      correctRun: 0,
      wrongCount: 1,
    });
  });
  it('sends a mastered item back to the start and counts the mistake', () => {
    const mastered = {
      ...recordWrong(null, t(1)),
      status: 'mastered' as const,
      correctRun: 2,
      masteredAt: t(2),
    };
    expect(recordWrong(mastered, t(3))).toMatchObject({
      status: 'active',
      correctRun: 0,
      wrongCount: 2,
      masteredAt: null,
      lastWrongAt: t(3),
    });
  });
});

describe('applyPracticeAnswer', () => {
  it('masters an item after two correct answers in a row', () => {
    expect(MASTERY_STREAK).toBe(2);
    const a = applyPracticeAnswer(recordWrong(null, t(1)), true, t(2));
    expect(a).toMatchObject({ status: 'active', correctRun: 1 });
    expect(applyPracticeAnswer(a, true, t(3))).toMatchObject({
      status: 'mastered',
      correctRun: 2,
      masteredAt: t(3),
    });
  });
  it('a wrong answer between two correct ones restarts the run', () => {
    let s = recordWrong(null, t(1));
    s = applyPracticeAnswer(s, true, t(2));
    s = applyPracticeAnswer(s, false, t(3));
    s = applyPracticeAnswer(s, true, t(4));
    expect(s).toMatchObject({ status: 'active', correctRun: 1, wrongCount: 2 });
  });
  it('never masters without two consecutive correct answers', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 30 }), (answers) => {
        let s = recordWrong(null, t(0));
        let run = 0;
        let mastered = false;
        answers.forEach((ok, i) => {
          s = applyPracticeAnswer(s, ok, t(i + 1));
          run = ok ? run + 1 : 0;
          if (!ok) mastered = false;
          if (run >= 2) mastered = true;
        });
        expect(s.status === 'mastered').toBe(mastered);
      }),
    );
  });
});

const item = (id: string, over: Partial<QueueItem> = {}): QueueItem => ({
  questionId: id,
  goalId: 'g1',
  status: 'active',
  lastWrongAt: t(5),
  lastPractisedAt: null,
  ...over,
});

describe('practiceQueue', () => {
  it('serves the current Goal first, never-practised first, oldest mistake first, active only', () => {
    const q = practiceQueue(
      [
        item('other-goal', { goalId: 'g2', lastWrongAt: t(0) }),
        item('practised', { lastPractisedAt: t(9) }),
        item('newer', { lastWrongAt: t(7) }),
        item('older', { lastWrongAt: t(3) }),
        item('mastered', { status: 'mastered', lastWrongAt: t(0) }),
      ],
      'g1',
    );
    expect(q.map((i) => i.questionId)).toEqual(['older', 'newer', 'practised', 'other-goal']);
  });
  it('caps the session', () => {
    const many = Array.from({ length: 25 }, (_, i) => item(`q${String(i).padStart(2, '0')}`));
    expect(practiceQueue(many, 'g1', 10)).toHaveLength(10);
  });
});
