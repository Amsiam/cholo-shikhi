// Mistake Vault service (FR-ADP-1). Quiz submission records mistakes inside its own transaction;
// practice reads only the caller's items and never sends a correct answer before it is answered.
import {
  bankQuestionsByIds,
  type Difficulty,
  topicNamesOf,
} from '#src/features/assessment/index.ts';
import { courseTitlesOf } from '#src/features/catalog/index.ts';
import { getCurrentGoal } from '#src/features/goals/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { isVaultItemHeld, vaultHeldUpTo } from '#src/features/trustops/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Executor } from '#src/server/db.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createVaultRepository } from '../data/vault.repository.ts';
import { applyPracticeAnswer, practiceQueue, recordWrong } from '../domain/vault.ts';
import { VaultAnswerInput } from './learning.schema.ts';

const repo = createVaultRepository();

/** Called inside quiz submission: each wrong answer enters (or re-enters) the vault. */
export async function recordQuizMistakes(
  exec: Executor,
  input: {
    userId: string;
    courseId: string;
    lessonId: string;
    goalId: string | null;
    at: Date;
    wrong: ReadonlyArray<{ questionId: string; chosenIndex: number | null }>;
  },
): Promise<void> {
  if (input.wrong.length === 0) return;
  const existing = new Map(
    (
      await repo.itemsForUpdate(
        exec,
        input.userId,
        input.wrong.map((w) => w.questionId),
      )
    ).map((r) => [r.questionId, r]),
  );
  for (const w of input.wrong) {
    const prior = existing.get(w.questionId);
    const next = recordWrong(prior ? repo.toState(prior) : null, input.at);
    await repo.upsert(exec, {
      userId: input.userId,
      questionId: w.questionId,
      source: 'lesson',
      lessonId: input.lessonId,
      courseId: input.courseId,
      topicId: null,
      difficulty: null,
      goalId: input.goalId ?? prior?.goalId ?? null,
      lastWrongChoice: w.chosenIndex,
      firstWrongAt: prior?.firstWrongAt ?? input.at,
      ...next,
    });
  }
}

/** A wrong answer in topic practice (question bank) enters, or re-enters, the vault. */
export async function recordBankMistake(
  exec: Executor,
  input: {
    userId: string;
    questionId: string;
    topicId: string;
    difficulty: Difficulty;
    goalId: string | null;
    chosenIndex: number;
    at: Date;
  },
): Promise<void> {
  const [prior] = await repo.itemsForUpdate(exec, input.userId, [input.questionId]);
  const next = recordWrong(prior ? repo.toState(prior) : null, input.at);
  await repo.upsert(exec, {
    userId: input.userId,
    questionId: input.questionId,
    source: 'bank',
    lessonId: null,
    courseId: null,
    topicId: input.topicId,
    difficulty: input.difficulty,
    goalId: input.goalId ?? prior?.goalId ?? null,
    lastWrongChoice: input.chosenIndex,
    firstWrongAt: prior?.firstWrongAt ?? input.at,
    ...next,
  });
}

/** Midnight in Asia/Dhaka (UTC+6, no DST) for "today" counts. */
function dhakaMidnight(now: Date): Date {
  const shifted = new Date(now.getTime() + 6 * 3600 * 1000);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      6 * 3600 * 1000,
  );
}

const currentGoalIdOf = async (userId: string) => {
  const goal = await getCurrentGoal(userId);
  return goal.ok ? goal.value.goalId : null;
};

/** Vault items are grouped by their course (lesson quizzes) or their topic (question bank). */
export type VaultGroup = {
  groupId: string;
  kind: 'course' | 'topic';
  titleBn: string;
  titleEn: string;
  isCurrentGoal: boolean;
  active: number;
  mastered: number;
};

export type VaultSummary = {
  active: number;
  mastered: number;
  answeredToday: number;
  currentGoalId: string | null;
  groups: VaultGroup[];
};

type Item = Awaited<ReturnType<typeof repo.itemsOf>>[number];
const groupOf = (i: Item): { groupId: string; kind: VaultGroup['kind'] } =>
  i.source === 'bank'
    ? { groupId: i.topicId ?? i.questionId, kind: 'topic' }
    : { groupId: i.courseId ?? i.questionId, kind: 'course' };

/** Course titles and topic names for a set of vault items. */
async function groupTitlesOf(items: readonly Item[]) {
  const [courses, topics] = await Promise.all([
    courseTitlesOf([
      ...new Set(items.flatMap((i) => (i.source === 'lesson' && i.courseId ? [i.courseId] : []))),
    ]),
    topicNamesOf([
      ...new Set(items.flatMap((i) => (i.source === 'bank' && i.topicId ? [i.topicId] : []))),
    ]),
  ]);
  return (i: Item) => {
    const g = groupOf(i);
    if (g.kind === 'topic') {
      const t = topics[g.groupId];
      return { titleBn: t?.nameBn ?? '', titleEn: t?.nameEn ?? '' };
    }
    const c = courses[g.groupId];
    return { titleBn: c?.titleBn ?? '', titleEn: c?.titleEn ?? '' };
  };
}

export async function getVaultSummary(actor: Actor): Promise<Result<VaultSummary, never>> {
  const db = getDb();
  const [items, goalId, answeredToday] = await Promise.all([
    repo.itemsOf(db, actor.userId),
    currentGoalIdOf(actor.userId),
    repo.answeredToday(db, actor.userId, dhakaMidnight(new Date())),
  ]);
  const titleOf = await groupTitlesOf(items);
  const groups = new Map<string, VaultGroup>();
  for (const i of items) {
    const g = groupOf(i);
    const c = groups.get(g.groupId) ?? {
      ...g,
      ...titleOf(i),
      isCurrentGoal: i.goalId !== null && i.goalId === goalId,
      active: 0,
      mastered: 0,
    };
    if (i.status === 'active') c.active += 1;
    else c.mastered += 1;
    groups.set(g.groupId, c);
  }
  return ok({
    active: items.filter((i) => i.status === 'active').length,
    mastered: items.filter((i) => i.status === 'mastered').length,
    answeredToday,
    currentGoalId: goalId,
    groups: [...groups.values()].sort(
      (a, b) =>
        Number(b.isCurrentGoal) - Number(a.isCurrentGoal) ||
        b.active - a.active ||
        a.groupId.localeCompare(b.groupId),
    ),
  });
}

export type VaultQuestion = {
  questionId: string;
  groupTitleBn: string;
  groupTitleEn: string;
  promptBn: string;
  promptEn: string;
  optionsBn: string[];
  optionsEn: string[];
  correctRun: number;
  wrongCount: number;
  lastWrongChoice: number | null;
};

/** The next practice round: up to 10 active items, current Goal first. No answers are sent. */
export async function getVaultSession(
  actor: Actor,
): Promise<Result<{ questions: VaultQuestion[] }, never>> {
  const db = getDb();
  const [items, goalId, heldUpTo] = await Promise.all([
    repo.itemsOf(db, actor.userId),
    currentGoalIdOf(actor.userId),
    vaultHeldUpTo(actor.userId),
  ]);
  // US4.8 / US4.9: items an Admin flagged as gamed are held out of resurfacing until cleared.
  const queue = practiceQueue(
    items.filter((i) => !isVaultItemHeld(i.lastWrongAt, heldUpTo)),
    goalId,
  );
  const [questions, titleOf] = await Promise.all([questionsOf(db, queue), groupTitlesOf(queue)]);
  return ok({
    questions: queue.flatMap((item) => {
      const q = questions.get(item.questionId);
      if (!q) return [];
      const title = titleOf(item);
      return [
        {
          questionId: item.questionId,
          groupTitleBn: title.titleBn,
          groupTitleEn: title.titleEn,
          promptBn: q.promptBn,
          promptEn: q.promptEn,
          optionsBn: q.optionsBn,
          optionsEn: q.optionsEn,
          correctRun: item.correctRun,
          wrongCount: item.wrongCount,
          lastWrongChoice: item.lastWrongChoice,
        },
      ];
    }),
  });
}

type GradableQuestion = {
  promptBn: string;
  promptEn: string;
  optionsBn: string[];
  optionsEn: string[];
  correctIndex: number;
  explanationBn: string | null;
  explanationEn: string | null;
};

/** Lesson-quiz and question-bank questions of vault items, by question ID. */
async function questionsOf(
  exec: Executor,
  items: ReadonlyArray<Pick<Item, 'questionId' | 'source'>>,
): Promise<Map<string, GradableQuestion>> {
  const lessonIds = items.filter((i) => i.source === 'lesson').map((i) => i.questionId);
  const bankIds = items.filter((i) => i.source === 'bank').map((i) => i.questionId);
  const [lesson, bank] = await Promise.all([
    repo.questionsByIds(exec, lessonIds),
    bankQuestionsByIds(bankIds),
  ]);
  return new Map<string, GradableQuestion>([
    ...lesson.map((q) => [q.questionId, q] as const),
    ...bank.map((q) => [q.questionId, q] as const),
  ]);
}

export type VaultAnswerResult = {
  isCorrect: boolean;
  correctIndex: number;
  explanationBn: string | null;
  explanationEn: string | null;
  status: 'active' | 'mastered';
  correctRun: number;
};

/** Grades one practice answer for an item in the caller's own vault. */
export async function answerVaultQuestion(
  actor: Actor,
  raw: VaultAnswerInput,
): Promise<Result<VaultAnswerResult, AppError<'NOT_FOUND'>>> {
  const input = VaultAnswerInput.parse(raw);
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const item = await repo.itemForUpdate(exec, actor.userId, input.questionId);
    if (!item) return err(appError('NOT_FOUND'));
    const question = (await questionsOf(exec, [item])).get(input.questionId);
    if (!question) return err(appError('NOT_FOUND'));
    const isCorrect = input.chosenIndex === question.correctIndex;
    const now = new Date();
    const next = applyPracticeAnswer(repo.toState(item), isCorrect, now);
    await repo.upsert(exec, {
      userId: actor.userId,
      questionId: item.questionId,
      source: item.source,
      lessonId: item.lessonId,
      courseId: item.courseId,
      topicId: item.topicId,
      difficulty: item.difficulty,
      goalId: item.goalId,
      lastWrongChoice: isCorrect ? item.lastWrongChoice : input.chosenIndex,
      firstWrongAt: item.firstWrongAt,
      ...next,
    });
    await repo.insertAnswer(exec, {
      userId: actor.userId,
      questionId: item.questionId,
      chosenIndex: input.chosenIndex,
      isCorrect,
    });
    return ok({
      isCorrect,
      correctIndex: question.correctIndex,
      explanationBn: question.explanationBn,
      explanationEn: question.explanationEn,
      status: next.status,
      correctRun: next.correctRun,
    });
  });
}

/** Active vault items (the dashboard's "questions in your vault" count). */
export async function countActiveVaultItems(userId: string): Promise<number> {
  const items = await repo.itemsOf(getDb(), userId);
  return items.filter((i) => i.status === 'active').length;
}

/** Active question-bank vault items of these Students, optionally within some topics. */
export async function activeVaultBankQuestionIds(
  userIds: readonly string[],
  topicIds: readonly string[] | null,
): Promise<string[]> {
  const rows = await repo.activeBankItems(getDb(), userIds);
  return [
    ...new Set(
      rows
        .filter((r) => !topicIds || (r.topicId !== null && topicIds.includes(r.topicId)))
        .map((r) => r.questionId),
    ),
  ];
}
