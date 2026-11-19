// [LT] Step 40: the CR-8 question-reference port (BR10.4): registered once, a second registration
// fails start-up, and the unregistered path answers 'unavailable'.
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerQuestionReferenceCheck,
  resetQuestionReferenceCheckForTests,
  runQuestionReferenceCheck,
} from './question-check.server.ts';

afterEach(() => {
  resetQuestionReferenceCheckForTests();
});

describe('registerQuestionReferenceCheck (CR-8)', () => {
  it('answers unavailable until a check is registered', async () => {
    expect(await runQuestionReferenceCheck({ questionIds: ['q1'] })).toBe('unavailable');
  });

  it('runs the registered check with the publish input', async () => {
    const seen: unknown[] = [];
    registerQuestionReferenceCheck(async (input) => {
      seen.push(input);
      return { valid: false, unknownIds: ['q2'] };
    });
    expect(await runQuestionReferenceCheck({ questionSetIds: ['s1'], courseId: 'c1' })).toEqual({
      valid: false,
      unknownIds: ['q2'],
    });
    expect(seen).toEqual([{ questionSetIds: ['s1'], courseId: 'c1' }]);
  });

  it('refuses a second registration, keeping the first check', async () => {
    registerQuestionReferenceCheck(async () => ({ valid: true }));
    expect(() => registerQuestionReferenceCheck(async () => ({ valid: true }))).toThrow(
      /already registered/,
    );
    expect(await runQuestionReferenceCheck({ questionIds: ['q1'] })).toEqual({ valid: true });
  });

  it('refuses a value that is not a function', () => {
    expect(() => registerQuestionReferenceCheck(null as never)).toThrow(TypeError);
  });

  it('propagates a failing check as a fault, never as a pass', async () => {
    registerQuestionReferenceCheck(async () => {
      throw new Error('assessment down');
    });
    await expect(runQuestionReferenceCheck({ questionIds: ['q1'] })).rejects.toThrow(
      'assessment down',
    );
  });
});
