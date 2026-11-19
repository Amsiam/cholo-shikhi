// Question bank rules (U4 Assessment). Plain TypeScript: no framework, DB or env access.
import type { AppError } from '#src/lib/errors.ts';
import { appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export type BankStatus = 'draft' | 'in_review' | 'published' | 'rejected' | 'retired';

export const PROMPT_MAX = 1000;
export const OPTION_MAX = 300;
export const EXPLANATION_MAX = 1000;
export const SOURCE_MAX = 120;

export type BankQuestionDraft = {
  promptBn: string;
  promptEn: string;
  optionsBn: readonly string[];
  optionsEn: readonly string[];
  correctIndex: number;
  explanationBn: string;
  explanationEn: string;
  sourceNote: string;
};

export type CleanBankQuestion = {
  promptBn: string;
  promptEn: string;
  optionsBn: string[];
  optionsEn: string[];
  correctIndex: number;
  explanationBn: string | null;
  explanationEn: string | null;
  sourceNote: string | null;
};

/** Prompt and four distinct, non-empty options in both languages, one correct option. */
export function validateBankQuestion(
  q: BankQuestionDraft,
): Result<CleanBankQuestion, AppError<'VALIDATION_FAILED'>> {
  const errors: Record<string, string[]> = {};
  const add = (k: string, code: string) => {
    errors[k] = [...(errors[k] ?? []), `errors.bank.${code}`];
  };
  for (const lang of ['Bn', 'En'] as const) {
    const prompt = q[`prompt${lang}`].trim();
    if (!prompt) add(`prompt${lang}`, 'promptRequired');
    if (prompt.length > PROMPT_MAX) add(`prompt${lang}`, 'tooLong');
    const options = q[`options${lang}`].map((o) => o.trim());
    if (options.length !== 4) add(`options${lang}`, 'fourOptions');
    options.forEach((o, i) => {
      if (!o) add(`options${lang}.${i}`, 'optionRequired');
      if (o.length > OPTION_MAX) add(`options${lang}.${i}`, 'tooLong');
    });
    if (new Set(options.map((o) => o.toLocaleLowerCase())).size !== options.length)
      add(`options${lang}`, 'optionsDistinct');
    if (q[`explanation${lang}`].trim().length > EXPLANATION_MAX)
      add(`explanation${lang}`, 'tooLong');
  }
  if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3)
    add('correctIndex', 'correctRequired');
  if (q.sourceNote.trim().length > SOURCE_MAX) add('sourceNote', 'tooLong');
  if (Object.keys(errors).length > 0)
    return err(appError('VALIDATION_FAILED', { fieldErrors: errors }));
  const opt = (s: string) => (s.trim() === '' ? null : s.trim());
  return ok({
    promptBn: q.promptBn.trim(),
    promptEn: q.promptEn.trim(),
    optionsBn: q.optionsBn.map((o) => o.trim()),
    optionsEn: q.optionsEn.map((o) => o.trim()),
    correctIndex: q.correctIndex,
    explanationBn: opt(q.explanationBn),
    explanationEn: opt(q.explanationEn),
    sourceNote: opt(q.sourceNote),
  });
}

export type Reviewer = { isAdmin: boolean; userId: string };
export type ReviewAction = 'submit' | 'approve' | 'reject' | 'retire' | 'restore';

/** The status a new question starts in: an Admin's publishes directly, an Instructor's is a draft. */
export function initialStatus(by: Reviewer): BankStatus {
  return by.isAdmin ? 'published' : 'draft';
}

/** Who may edit: the author while draft or rejected; an Admin always. */
export function canEdit(status: BankStatus, authorId: string, by: Reviewer): boolean {
  if (by.isAdmin) return status !== 'retired';
  return authorId === by.userId && (status === 'draft' || status === 'rejected');
}

/** The next status for a review action, or null when the action is not allowed. */
export function nextStatus(
  status: BankStatus,
  action: ReviewAction,
  authorId: string,
  by: Reviewer,
): BankStatus | null {
  switch (action) {
    case 'submit':
      return authorId === by.userId && (status === 'draft' || status === 'rejected')
        ? 'in_review'
        : null;
    case 'approve':
      return by.isAdmin && status === 'in_review' ? 'published' : null;
    case 'reject':
      return by.isAdmin && status === 'in_review' ? 'rejected' : null;
    case 'retire':
      return by.isAdmin && status === 'published' ? 'retired' : null;
    case 'restore':
      return by.isAdmin && status === 'retired' ? 'published' : null;
  }
}

// ----------------------------------------------------------------- adaptive difficulty
// The teacher's difficulty is a prior; each Student's first attempt is evidence. The blended correct
// rate is (correct + K·prior) / (attempts + K), so a handful of answers barely moves it and real
// results dominate after roughly 50–100 first attempts. Repeat attempts are not counted: a Student
// who already saw the answer makes a question look easier than it is.

export const PRIOR_CORRECT_RATE: Record<Difficulty, number> = { easy: 0.8, medium: 0.6, hard: 0.4 };
export const PRIOR_WEIGHT = 20;
export const EASY_FROM = 0.7;
export const HARD_BELOW = 0.45;

export function blendedCorrectRate(base: Difficulty, attempts: number, correct: number): number {
  return (correct + PRIOR_WEIGHT * PRIOR_CORRECT_RATE[base]) / (attempts + PRIOR_WEIGHT);
}

export function effectiveDifficulty(
  base: Difficulty,
  attempts: number,
  correct: number,
): Difficulty {
  const rate = blendedCorrectRate(base, attempts, correct);
  if (rate >= EASY_FROM) return 'easy';
  if (rate < HARD_BELOW) return 'hard';
  return 'medium';
}
