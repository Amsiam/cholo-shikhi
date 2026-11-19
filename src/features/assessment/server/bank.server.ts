// Question bank service (U4 Assessment): the subject / topic / sub-topic taxonomy (Admins), question
// authoring with review (Instructors write, Admins review; an Admin's own question publishes
// directly), and read access for Learning (topic practice, Mistake Vault similarity). Students never
// receive a correct answer from these reads before answering.

import type { Actor } from '#src/features/identity-access/index.ts';
import { getIdentity } from '#src/features/identity-access/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import {
  type BankQuestionRow,
  createBankRepository,
  type TopicRow,
} from '../data/bank.repository.ts';
import {
  blendedCorrectRate,
  canEdit,
  type Difficulty,
  effectiveDifficulty,
  initialStatus,
  nextStatus,
  type ReviewAction,
  type Reviewer,
  validateBankQuestion,
} from '../domain/bank.ts';
import {
  BankListInput,
  BankQuestionRef,
  ReviewBankInput,
  SaveBankQuestionInput,
  SaveSubjectInput,
  SaveTopicInput,
} from './bank.schema.ts';

const repo = createBankRepository();
const REVIEW_ACTIONS: readonly ReviewAction[] = [
  'submit',
  'approve',
  'reject',
  'retire',
  'restore',
];
const PAGE_SIZE = 20;
type BankError = AppError<
  'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'VALIDATION_FAILED' | 'INVALID_STATE'
>;

const reviewerOf = (actor: Actor): Reviewer => ({
  isAdmin: actor.roles.includes('admin'),
  userId: actor.userId,
});

// ----------------------------------------------------------------- taxonomy

export type TaxonomyTopic = {
  topicId: string;
  nameBn: string;
  nameEn: string;
  subtopics: Array<{ topicId: string; nameBn: string; nameEn: string }>;
};
export type TaxonomySubject = {
  subjectId: string;
  nameBn: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
  goalIds: string[];
  topics: TaxonomyTopic[];
};

function treeOf(topics: readonly TopicRow[], subjectId: string): TaxonomyTopic[] {
  const mine = topics.filter((t) => t.subjectId === subjectId);
  return mine
    .filter((t) => t.parentTopicId === null)
    .map((t) => ({
      topicId: t.topicId,
      nameBn: t.nameBn,
      nameEn: t.nameEn,
      subtopics: mine
        .filter((s) => s.parentTopicId === t.topicId)
        .map((s) => ({ topicId: s.topicId, nameBn: s.nameBn, nameEn: s.nameEn })),
    }));
}

/** The whole taxonomy (staff: authoring and the topic manager). */
export async function getTaxonomy(): Promise<Result<TaxonomySubject[], never>> {
  const db = getDb();
  const [subjects, links, topics] = await Promise.all([
    repo.subjects(db),
    repo.subjectGoals(db),
    repo.topics(db),
  ]);
  return ok(
    subjects.map((s) => ({
      subjectId: s.subjectId,
      nameBn: s.nameBn,
      nameEn: s.nameEn,
      sortOrder: s.sortOrder,
      isActive: s.isActive,
      goalIds: links.filter((l) => l.subjectId === s.subjectId).map((l) => l.goalId),
      topics: treeOf(topics, s.subjectId),
    })),
  );
}

export async function saveSubject(
  raw: SaveSubjectInput,
): Promise<Result<{ subjectId: string }, never>> {
  const input = SaveSubjectInput.parse(raw);
  const db = getDb();
  const subjectId = await repo.saveSubject(db, {
    ...(input.subjectId ? { subjectId: input.subjectId } : {}),
    nameBn: input.nameBn,
    nameEn: input.nameEn,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
  });
  await repo.setSubjectGoals(db, subjectId, input.goalIds);
  return ok({ subjectId });
}

export async function saveTopic(
  raw: SaveTopicInput,
): Promise<Result<{ topicId: string }, AppError<'VALIDATION_FAILED'>>> {
  const input = SaveTopicInput.parse(raw);
  const db = getDb();
  if (input.parentTopicId) {
    // One level of sub-topics: the parent must be a root topic of the same subject.
    const parent = await repo.topicById(db, input.parentTopicId);
    if (!parent || parent.subjectId !== input.subjectId || parent.parentTopicId !== null)
      return err(
        appError('VALIDATION_FAILED', {
          fieldErrors: { parentTopicId: ['errors.bank.parentInvalid'] },
        }),
      );
  }
  const topicId = await repo.saveTopic(db, {
    ...(input.topicId ? { topicId: input.topicId } : {}),
    subjectId: input.subjectId,
    parentTopicId: input.parentTopicId ?? null,
    nameBn: input.nameBn,
    nameEn: input.nameEn,
    sortOrder: input.sortOrder,
  });
  return ok({ topicId });
}

// ----------------------------------------------------------------- authoring

export type BankQuestionView = {
  questionId: string;
  topicId: string;
  difficulty: Difficulty;
  /** Measured from first attempts, blended with the teacher's difficulty. */
  effectiveDifficulty: Difficulty;
  firstAttempts: number;
  /** Share of first attempts answered correctly, or null before any. */
  firstCorrectRate: number | null;
  /** The blended correct rate behind effectiveDifficulty (0–1). */
  blendedRate: number;
  promptBn: string;
  promptEn: string;
  optionsBn: string[];
  optionsEn: string[];
  correctIndex: number;
  explanationBn: string | null;
  explanationEn: string | null;
  sourceNote: string | null;
  isPastPaper: boolean;
  status: BankQuestionRow['status'];
  authorId: string;
  authorName: string;
  reviewNote: string | null;
  version: number;
  updatedAt: string;
  canEdit: boolean;
  /** Review actions this viewer may take now. */
  actions: ReviewAction[];
};

async function viewsOf(
  rows: readonly BankQuestionRow[],
  by: Reviewer,
): Promise<BankQuestionView[]> {
  const names = await getIdentity().displayNamesOf([...new Set(rows.map((r) => r.authorId))]);
  return rows.map((r) => ({
    questionId: r.questionId,
    topicId: r.topicId,
    difficulty: r.difficulty,
    effectiveDifficulty: r.effectiveDifficulty,
    firstAttempts: r.firstAttempts,
    firstCorrectRate: r.firstAttempts > 0 ? r.firstCorrect / r.firstAttempts : null,
    blendedRate: blendedCorrectRate(r.difficulty, r.firstAttempts, r.firstCorrect),
    promptBn: r.promptBn,
    promptEn: r.promptEn,
    optionsBn: r.optionsBn,
    optionsEn: r.optionsEn,
    correctIndex: r.correctIndex,
    explanationBn: r.explanationBn,
    explanationEn: r.explanationEn,
    sourceNote: r.sourceNote,
    isPastPaper: r.isPastPaper,
    status: r.status,
    authorId: r.authorId,
    authorName: names[r.authorId] ?? '',
    reviewNote: r.reviewNote,
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
    canEdit: canEdit(r.status, r.authorId, by),
    actions: REVIEW_ACTIONS.filter((a) => nextStatus(r.status, a, r.authorId, by) !== null),
  }));
}

/** Topic IDs of a subject or topic filter: a topic covers its sub-topics. */
async function topicScope(subjectId?: string, topicId?: string): Promise<string[] | undefined> {
  if (!subjectId && !topicId) return undefined;
  const topics = await repo.topics(getDb(), subjectId ? [subjectId] : undefined);
  if (topicId)
    return topics
      .filter((t) => t.topicId === topicId || t.parentTopicId === topicId)
      .map((t) => t.topicId);
  return topics.map((t) => t.topicId);
}

/**
 * The bank for staff. Instructors see their own questions and every published one; Admins see all.
 * The review queue is the `in_review` filter.
 */
export async function listBank(
  actor: Actor,
  raw: BankListInput,
): Promise<
  Result<{ rows: BankQuestionView[]; total: number; page: number; pageCount: number }, never>
> {
  const input = BankListInput.parse(raw);
  const by = reviewerOf(actor);
  const topicIds = await topicScope(input.subjectId, input.topicId);
  // Instructors: their own (any status) unless filtering to published.
  const authorId =
    !by.isAdmin && input.status !== 'published'
      ? actor.userId
      : input.mine
        ? actor.userId
        : undefined;
  const { rows, total } = await repo.listQuestions(
    getDb(),
    {
      ...(topicIds ? { topicIds } : {}),
      ...(input.difficulty ? { difficulty: input.difficulty } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(authorId ? { authorId } : {}),
      ...(input.q ? { query: input.q } : {}),
    },
    input.page,
    PAGE_SIZE,
  );
  return ok({
    rows: await viewsOf(rows, by),
    total,
    page: input.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    isAdmin: by.isAdmin,
  });
}

export async function saveBankQuestion(
  actor: Actor,
  raw: SaveBankQuestionInput,
): Promise<Result<BankQuestionView, BankError>> {
  const input = SaveBankQuestionInput.parse(raw);
  const by = reviewerOf(actor);
  const clean = validateBankQuestion(input);
  if (!clean.ok) return clean;
  const db = getDb();
  const topic = await repo.topicById(db, input.topicId);
  if (!topic)
    return err(
      appError('VALIDATION_FAILED', { fieldErrors: { topicId: ['errors.bank.topicRequired'] } }),
    );
  if (!input.questionId) {
    const row = await repo.insertQuestion(db, {
      ...clean.value,
      topicId: input.topicId,
      difficulty: input.difficulty,
      status: initialStatus(by),
      authorId: actor.userId,
    });
    return ok((await viewsOf([row], by))[0] as BankQuestionView);
  }
  const existing = await repo.questionById(db, input.questionId);
  if (!existing) return err(appError('NOT_FOUND'));
  if (!canEdit(existing.status, existing.authorId, by)) return err(appError('FORBIDDEN'));
  const row = await repo.updateQuestion(db, input.questionId, input.expectedVersion ?? -1, {
    ...clean.value,
    topicId: input.topicId,
    difficulty: input.difficulty,
    // A changed teacher difficulty is a new prior; the measured evidence is kept.
    effectiveDifficulty: effectiveDifficulty(
      input.difficulty,
      existing.firstAttempts,
      existing.firstCorrect,
    ),
  });
  if (!row) return err(appError('CONFLICT'));
  return ok((await viewsOf([row], by))[0] as BankQuestionView);
}

export async function reviewBankQuestion(
  actor: Actor,
  raw: ReviewBankInput,
): Promise<Result<BankQuestionView, BankError>> {
  const input = ReviewBankInput.parse(raw);
  const by = reviewerOf(actor);
  const db = getDb();
  const existing = await repo.questionById(db, input.questionId);
  if (!existing) return err(appError('NOT_FOUND'));
  const next = nextStatus(existing.status, input.action, existing.authorId, by);
  if (!next) return err(appError('INVALID_STATE'));
  if (input.action === 'reject' && !input.note?.trim())
    return err(
      appError('VALIDATION_FAILED', { fieldErrors: { note: ['errors.bank.noteRequired'] } }),
    );
  const isReview = input.action === 'approve' || input.action === 'reject';
  const row = await repo.updateQuestion(db, input.questionId, input.expectedVersion, {
    status: next,
    ...(isReview
      ? { reviewedBy: actor.userId, reviewedAt: new Date(), reviewNote: input.note?.trim() || null }
      : {}),
  });
  if (!row) return err(appError('CONFLICT'));
  return ok((await viewsOf([row], by))[0] as BankQuestionView);
}

export async function getBankQuestion(
  actor: Actor,
  raw: BankQuestionRef,
): Promise<Result<BankQuestionView, AppError<'NOT_FOUND'>>> {
  const input = BankQuestionRef.parse(raw);
  const by = reviewerOf(actor);
  const row = await repo.questionById(getDb(), input.questionId);
  // An Instructor may read their own questions and published ones.
  if (!row || (!by.isAdmin && row.authorId !== actor.userId && row.status !== 'published'))
    return err(appError('NOT_FOUND'));
  return ok((await viewsOf([row], by))[0] as BankQuestionView);
}

// ----------------------------------------------------------------- reads for Learning

/** A question as a Student sees it before answering (no correct answer). */
export type StudentQuestion = {
  questionId: string;
  topicId: string;
  difficulty: Difficulty;
  promptBn: string;
  promptEn: string;
  optionsBn: string[];
  optionsEn: string[];
  sourceNote: string | null;
  /** US4.7: shown to Students as "from past papers". */
  isPastPaper: boolean;
};

export const toStudentQuestion = (r: BankQuestionRow): StudentQuestion => ({
  questionId: r.questionId,
  topicId: r.topicId,
  difficulty: r.effectiveDifficulty,
  promptBn: r.promptBn,
  promptEn: r.promptEn,
  optionsBn: r.optionsBn,
  optionsEn: r.optionsEn,
  sourceNote: r.sourceNote,
  isPastPaper: r.isPastPaper,
});

/** The Goal's subjects and topics with published question counts (topic practice catalog). */
export async function practiceCatalogFor(goalId: string) {
  const db = getDb();
  const subjects = await repo.subjectsOfGoal(db, goalId);
  const topics = await repo.topics(
    db,
    subjects.map((s) => s.subjectId),
  );
  const counts = await repo.publishedCounts(
    db,
    topics.map((t) => t.topicId),
  );
  const countOf = (ids: readonly string[]) =>
    counts.filter((c) => ids.includes(c.topicId)).reduce((n, c) => n + c.n, 0);
  return subjects.map((s) => {
    const tree = treeOf(topics, s.subjectId);
    return {
      subjectId: s.subjectId,
      nameBn: s.nameBn,
      nameEn: s.nameEn,
      topics: tree.map((t) => {
        const ids = [t.topicId, ...t.subtopics.map((x) => x.topicId)];
        return {
          ...t,
          questionCount: countOf(ids),
          subtopics: t.subtopics.map((x) => ({ ...x, questionCount: countOf([x.topicId]) })),
        };
      }),
    };
  });
}

/** Published questions of a topic (and its sub-topics) for one Student, least recently seen first. */
export async function practiceQuestionsFor(
  userId: string,
  topicId: string,
  difficulty: Difficulty | null,
  count: number,
): Promise<StudentQuestion[]> {
  const db = getDb();
  const topics = await repo.topics(db);
  const ids = topics
    .filter((t) => t.topicId === topicId || t.parentTopicId === topicId)
    .map((t) => t.topicId);
  if (ids.length === 0) return [];
  return (await repo.practiceQuestions(db, userId, ids, difficulty, count)).map(toStudentQuestion);
}

/** Bank questions by ID (published or not; the caller decides what to reveal). */
export async function bankQuestionsByIds(ids: readonly string[]): Promise<BankQuestionRow[]> {
  return repo.questionsByIds(getDb(), ids);
}

/** A different published question on the same topic and difficulty, or null. */
export async function similarBankQuestion(
  q: { questionId: string; topicId: string; difficulty: Difficulty },
  excludeIds: readonly string[],
): Promise<BankQuestionRow | null> {
  return repo.similarQuestion(getDb(), q, excludeIds);
}

/** Records a Student's practice answer; a first attempt updates the measured difficulty. */
export async function recordBankAnswer(row: {
  userId: string;
  questionId: string;
  chosenIndex: number;
  isCorrect: boolean;
}): Promise<void> {
  await withTransaction(getDb(), async (tx) => {
    await repo.recordAnswer(unwrapTx(tx), row, (q, attempts, correct) =>
      effectiveDifficulty(q.difficulty, attempts, correct),
    );
  });
}

/** Topic names by ID (for vault grouping). */
export async function topicNamesOf(
  ids: readonly string[],
): Promise<Record<string, { nameBn: string; nameEn: string; subjectId: string }>> {
  if (ids.length === 0) return {};
  const topics = await repo.topics(getDb());
  return Object.fromEntries(
    topics
      .filter((t) => ids.includes(t.topicId))
      .map((t) => [t.topicId, { nameBn: t.nameBn, nameEn: t.nameEn, subjectId: t.subjectId }]),
  );
}
