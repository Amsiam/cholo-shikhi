// CR-8 question-reference port (BR10.4; functional-spec §9). U4 Assessment registers its check once
// at start-up; Catalog never imports Assessment (ADR-020). A second registration throws, so a
// mis-wired start-up fails instead of silently replacing the check. Until a check is registered,
// exam packages and Practice Packs save as drafts but cannot publish (questionCheckUnavailable).
import type {
  QuestionCheckInput,
  QuestionCheckOutcome,
  QuestionReferenceCheck,
} from '../domain/products.ts';

let registered: QuestionReferenceCheck | null = null;

/** Contract 5 (CR-8): called once by Assessment at start-up. */
export function registerQuestionReferenceCheck(check: QuestionReferenceCheck): void {
  if (typeof check !== 'function')
    throw new TypeError('question reference check must be a function');
  if (registered) throw new Error('a question reference check is already registered (CR-8)');
  registered = check;
}

/**
 * Runs the registered check. 'unavailable' when nothing is registered. A failing check is an
 * infrastructure fault and propagates (the publish transaction rolls back, nothing is published).
 */
export async function runQuestionReferenceCheck(
  input: QuestionCheckInput,
): Promise<QuestionCheckOutcome | 'unavailable'> {
  if (!registered) return 'unavailable';
  return registered(input);
}

/** Test seam: forgets the registered check, so tests can register an in-repo stub. */
export function resetQuestionReferenceCheckForTests(): void {
  registered = null;
}
