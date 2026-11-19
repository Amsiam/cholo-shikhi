// Taking exams (Students). Assessment owns exams and marking; this side adds the Student's goal and,
// once an attempt's results are out, feeds its answers to the measured difficulty (first attempts)
// and puts wrong answers in the Mistake Vault.
import {
  type AttemptRef,
  type AttemptSheet,
  type CreateCustomExamInput,
  closeExpiredAttempts,
  createCustomExam,
  type ExamGrants,
  type ExamRef,
  type ExamResult,
  type ExploreInput,
  ensurePackageExams,
  examResult,
  exploreQuestions,
  markAttemptsSettled,
  myExamHistory,
  recordBankAnswer,
  type SaveExamAnswerInput,
  type StudentExamCard,
  saveExamAnswer,
  settleableAttempts,
  startExamAttempt,
  studentExams,
  submitExamAttempt,
} from '#src/features/assessment/index.ts';
import { examPackageContent } from '#src/features/catalog/index.ts';
import {
  entitlementsOf,
  listActiveEnrolments,
  listTrialsOf,
  packExamAccess,
} from '#src/features/commerce/index.ts';
import { getCurrentGoal } from '#src/features/goals/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { ok, type Result } from '#src/lib/result.ts';
import { getDb } from '#src/server/db.ts';
import { recordBankMistake } from './vault.server.ts';

const currentGoalIdOf = async (userId: string) => {
  const goal = await getCurrentGoal(userId);
  return goal.ok ? goal.value.goalId : null;
};

/** Courses the Student can open now: active enrolments and running trials (course exams). */
async function openCourseIdsOf(userId: string): Promise<string[]> {
  const now = Date.now();
  const [enrolments, trials] = await Promise.all([
    listActiveEnrolments(userId),
    listTrialsOf(userId),
  ]);
  return [
    ...new Set([
      ...enrolments.map((e) => e.courseId),
      ...trials.filter((t) => new Date(t.endsAt).getTime() > now).map((t) => t.courseId),
    ]),
  ];
}

/** Exams the Student reaches through Practice Packs and exam packages (made on first need). */
async function grantsOf(userId: string): Promise<ExamGrants> {
  const [packs, ent] = await Promise.all([packExamAccess(userId), entitlementsOf(userId)]);
  const contents = (
    await Promise.all(ent.examPackageIds.map((id) => examPackageContent(id)))
  ).filter((c): c is NonNullable<typeof c> => c !== null);
  const packageExams = contents.length > 0 ? await ensurePackageExams(contents, userId) : [];
  return { granted: [...packs.granted, ...packageExams], locked: packs.locked };
}

/** Records answers of attempts whose results are out (idempotent per attempt). */
async function settle(userId: string): Promise<void> {
  await closeExpiredAttempts(userId);
  const ready = await settleableAttempts(userId);
  if (ready.length === 0) return;
  const goalId = await currentGoalIdOf(userId);
  const now = new Date();
  for (const attempt of ready) {
    for (const a of attempt.answers) {
      await recordBankAnswer({
        userId,
        questionId: a.questionId,
        chosenIndex: a.chosenIndex,
        isCorrect: a.isCorrect,
      });
      if (!a.isCorrect)
        await recordBankMistake(getDb(), {
          userId,
          questionId: a.questionId,
          topicId: a.topicId,
          difficulty: a.difficulty,
          goalId,
          chosenIndex: a.chosenIndex,
          at: now,
        });
    }
  }
  await markAttemptsSettled(
    userId,
    ready.map((r) => r.attemptId),
  );
}

export async function listMyExams(
  actor: Actor,
): Promise<Result<{ goalId: string | null; exams: StudentExamCard[] }, never>> {
  await settle(actor.userId);
  const goalId = await currentGoalIdOf(actor.userId);
  const [courseIds, grants] = await Promise.all([
    openCourseIdsOf(actor.userId),
    grantsOf(actor.userId),
  ]);
  return ok({ goalId, exams: await studentExams(actor.userId, goalId, courseIds, grants) });
}

export async function makeCustomExam(actor: Actor, input: CreateCustomExamInput) {
  return createCustomExam(actor.userId, input);
}

export async function startExam(actor: Actor, input: ExamRef) {
  const [goalId, courseIds, grants] = await Promise.all([
    currentGoalIdOf(actor.userId),
    openCourseIdsOf(actor.userId),
    grantsOf(actor.userId),
  ]);
  return startExamAttempt(actor.userId, goalId, courseIds, input, grants);
}

export async function saveAnswer(actor: Actor, input: SaveExamAnswerInput) {
  return saveExamAnswer(actor.userId, input);
}

export async function submitExam(actor: Actor, input: AttemptRef) {
  const r = await submitExamAttempt(actor.userId, input);
  if (r.ok) await settle(actor.userId);
  return r;
}

export async function getExamResult(actor: Actor, input: AttemptRef) {
  await settle(actor.userId);
  return examResult(actor.userId, input);
}

export type { AttemptSheet, ExamResult, StudentExamCard };

/** Study mode: questions with answers, explanations and where they appeared before. */
export async function exploreMyQuestions(actor: Actor, input: ExploreInput) {
  const [goalId, courseIds, grants] = await Promise.all([
    currentGoalIdOf(actor.userId),
    openCourseIdsOf(actor.userId),
    grantsOf(actor.userId),
  ]);
  return exploreQuestions(goalId, courseIds, input, grants);
}

export async function myExamResults(actor: Actor) {
  await settle(actor.userId);
  return myExamHistory(actor.userId);
}
