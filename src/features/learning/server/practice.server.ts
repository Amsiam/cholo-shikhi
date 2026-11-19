// Topic-wise practice from the question bank (U4 reads through the Assessment public surface).
// A Student practises the subjects of their current Goal; questions arrive without answers, each
// answer is graded on the server, and a wrong answer enters the Mistake Vault.
import {
  bankQuestionsByIds,
  practiceCatalogFor,
  practiceQuestionsFor,
  recordBankAnswer,
  type StudentQuestion,
} from '#src/features/assessment/index.ts';
import { getCurrentGoal } from '#src/features/goals/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { getDb } from '#src/server/db.ts';
import { PracticeAnswerInput, StartPracticeInput } from './learning.schema.ts';
import { recordBankMistake } from './vault.server.ts';

export type PracticeCatalog = {
  goalId: string | null;
  subjects: Awaited<ReturnType<typeof practiceCatalogFor>>;
};

const currentGoalIdOf = async (userId: string) => {
  const goal = await getCurrentGoal(userId);
  return goal.ok ? goal.value.goalId : null;
};

export async function getPracticeCatalog(actor: Actor): Promise<Result<PracticeCatalog, never>> {
  const goalId = await currentGoalIdOf(actor.userId);
  return ok({ goalId, subjects: goalId ? await practiceCatalogFor(goalId) : [] });
}

export async function startPractice(
  actor: Actor,
  raw: StartPracticeInput,
): Promise<Result<{ questions: StudentQuestion[] }, AppError<'NOT_FOUND'>>> {
  const input = StartPracticeInput.parse(raw);
  const questions = await practiceQuestionsFor(
    actor.userId,
    input.topicId,
    input.difficulty ?? null,
    input.count,
  );
  if (questions.length === 0)
    return err({ ...appError('NOT_FOUND'), i18nKey: 'errors.practice.empty' });
  return ok({ questions });
}

export type PracticeAnswerResult = {
  isCorrect: boolean;
  correctIndex: number;
  explanationBn: string | null;
  explanationEn: string | null;
  addedToVault: boolean;
};

export async function answerPractice(
  actor: Actor,
  raw: PracticeAnswerInput,
): Promise<Result<PracticeAnswerResult, AppError<'NOT_FOUND'>>> {
  const input = PracticeAnswerInput.parse(raw);
  const [q] = await bankQuestionsByIds([input.questionId]);
  if (q?.status !== 'published') return err(appError('NOT_FOUND'));
  const isCorrect = input.chosenIndex === q.correctIndex;
  await recordBankAnswer({
    userId: actor.userId,
    questionId: q.questionId,
    chosenIndex: input.chosenIndex,
    isCorrect,
  });
  if (!isCorrect)
    await recordBankMistake(getDb(), {
      userId: actor.userId,
      questionId: q.questionId,
      topicId: q.topicId,
      difficulty: q.effectiveDifficulty,
      goalId: await currentGoalIdOf(actor.userId),
      chosenIndex: input.chosenIndex,
      at: new Date(),
    });
  return ok({
    isCorrect,
    correctIndex: q.correctIndex,
    explanationBn: q.explanationBn,
    explanationEn: q.explanationEn,
    addedToVault: !isCorrect,
  });
}
