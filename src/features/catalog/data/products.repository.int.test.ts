// [LT] Step 40: the products repository on real PostgreSQL: version-checked writes (BR12.1), version
// rows (BR10.3, BR10.6) including two concurrent publishes from the same token (Q14: exactly one
// version is created), plan items, the BR10.8 current-plan lookup and bounded reads (SC-209).
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Executor } from '#src/server/db.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { nextVersionNumber } from '../domain/products.ts';
import { createCourseRepository } from './course.repository.ts';
import { createProductRepository } from './products.repository.ts';

let t: TestDatabase;
let goalId: string;
const products = createProductRepository();
const courses = createCourseRepository();
const at = new Date('2026-11-17T04:00:00.000Z');
const admin = randomUUID();

beforeAll(async () => {
  t = await createTestDatabase();
  const n = randomBytes(4).toString('hex');
  const segment = await t.pool.query<{ segment_id: string }>(
    `INSERT INTO goal_segment (name_bn, name_en, segment_type, battle_band)
     VALUES ($1, $2, 'academic', $3) RETURNING segment_id`,
    [`সেগমেন্ট ${n}`, `Segment ${n}`, `band_${n}`],
  );
  const goal = await t.pool.query<{ goal_id: string }>(
    `INSERT INTO goal (segment_id, name_bn, name_en, status) VALUES ($1, 'লক্ষ্য', 'Goal', 'active')
     RETURNING goal_id`,
    [segment.rows[0]?.segment_id],
  );
  goalId = goal.rows[0]?.goal_id as string;
});
afterAll(async () => {
  await t.drop();
});

const inTransaction = <T>(fn: (exec: Executor) => Promise<T>): Promise<T> =>
  t.db.transaction(async (tx) => fn(tx as unknown as Executor));

const newExam = () =>
  products.insertExam(t.db, {
    goalId,
    titleBn: 'মডেল টেস্ট',
    titleEn: 'Model test',
    listPricePoisha: 49_900,
    draftQuestionIds: [randomUUID(), randomUUID()],
    draftTimeLimitMinutes: 60,
    createdBy: admin,
  });

async function publishedCourse() {
  const row = await courses.insert(t.db, {
    goalId,
    titleBn: 'কোর্স',
    titleEn: 'Course',
    createdBy: admin,
  });
  await t.pool.query(
    `UPDATE course SET status = 'published', first_published_at = now() WHERE course_id = $1`,
    [row.courseId],
  );
  return row.courseId;
}

/** The repository half of publishExamPackage: lock, version-check, insert version n+1, point at it. */
async function publishExam(exec: Executor, examPackageId: string, expectedVersion: number) {
  const row = await products.getExamForUpdate(exec, examPackageId);
  if (!row || row.version !== expectedVersion) return 'stale' as const;
  const number = nextVersionNumber(await products.latestExamVersionNumber(exec, examPackageId));
  const version = await products.insertExamVersion(exec, {
    examPackageId,
    versionNumber: number,
    questionIds: row.draftQuestionIds,
    timeLimitMinutes: row.draftTimeLimitMinutes as number,
    publishedAt: at,
    publishedBy: admin,
  });
  const updated = await products.updateExam(
    exec,
    examPackageId,
    row.version,
    {
      status: 'published',
      currentVersionId: version.examPackageVersionId,
      hasUnpublishedChanges: false,
    },
    at,
  );
  return updated.kind === 'applied' ? number : ('stale' as const);
}

describe('exam packages', () => {
  it('applies a write with the expected version and bumps it', async () => {
    const exam = await newExam();
    const updated = await products.updateExam(t.db, exam.examPackageId, 1, { titleEn: 'Mock' }, at);
    expect(updated).toMatchObject({ kind: 'applied', row: { titleEn: 'Mock', version: 2 } });
  });

  it('reports stale and missing writes without changing anything (BR12.1)', async () => {
    const exam = await newExam();
    expect(await products.updateExam(t.db, exam.examPackageId, 7, { titleEn: 'X' }, at)).toEqual({
      kind: 'stale',
      currentVersion: 1,
    });
    expect(await products.updateExam(t.db, randomUUID(), 1, { titleEn: 'X' }, at)).toEqual({
      kind: 'missing',
    });
    expect((await products.getExam(t.db, exam.examPackageId))?.titleEn).toBe('Model test');
  });

  it('numbers versions 1, 2 and keeps each version exactly as published (BR10.3)', async () => {
    const exam = await newExam();
    expect(await inTransaction((x) => publishExam(x, exam.examPackageId, 1))).toBe(1);
    const firstQuestions = exam.draftQuestionIds;
    const edited = await products.updateExam(
      t.db,
      exam.examPackageId,
      2,
      { draftQuestionIds: [randomUUID()], hasUnpublishedChanges: true },
      at,
    );
    expect(edited.kind).toBe('applied');
    expect(await inTransaction((x) => publishExam(x, exam.examPackageId, 3))).toBe(2);
    const rows = await t.pool.query<{ version_number: number; question_ids: string[] }>(
      'SELECT version_number, question_ids FROM exam_package_version WHERE exam_package_id = $1 ORDER BY 1',
      [exam.examPackageId],
    );
    expect(rows.rows[0]).toEqual({ version_number: 1, question_ids: firstQuestions });
    expect(rows.rows[1]?.question_ids).not.toEqual(firstQuestions);
  });

  it('Q14 concurrency: two publishes from the same token create exactly one version', async () => {
    const exam = await newExam();
    const outcomes = await Promise.all([
      inTransaction((x) => publishExam(x, exam.examPackageId, 1)),
      inTransaction((x) => publishExam(x, exam.examPackageId, 1)),
    ]);
    expect(outcomes.sort()).toEqual([1, 'stale']);
    const { rows } = await t.pool.query(
      'SELECT count(*)::int AS n FROM exam_package_version WHERE exam_package_id = $1',
      [exam.examPackageId],
    );
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('Q14 concurrency: an edit racing a publish never changes the version being published', async () => {
    const exam = await newExam();
    const published = exam.draftQuestionIds;
    const [publish, edit] = await Promise.all([
      inTransaction((x) => publishExam(x, exam.examPackageId, 1)),
      inTransaction(async (x) => {
        const row = await products.getExamForUpdate(x, exam.examPackageId);
        return products
          .updateExam(x, exam.examPackageId, 1, { draftQuestionIds: [randomUUID()] }, at)
          .then((w) => (row ? w.kind : 'missing'));
      }),
    ]);
    // Exactly one of the two based-on-version-1 writes wins.
    expect([publish === 1, edit === 'applied'].filter(Boolean)).toHaveLength(1);
    const { rows } = await t.pool.query<{ question_ids: string[] }>(
      'SELECT question_ids FROM exam_package_version WHERE exam_package_id = $1',
      [exam.examPackageId],
    );
    for (const r of rows) expect(r.question_ids).toEqual(published);
  });

  it('lists the Admin page newest first, bounded by MAX_PRODUCT_PAGE', async () => {
    await newExam();
    const page = await products.listExamsAdmin(t.db, { limit: 1000, offset: 0 });
    expect(page.rows.length).toBeLessThanOrEqual(100);
    expect(page.total).toBeGreaterThan(0);
    const created = page.rows.map((r) => r.createdAt.getTime());
    expect([...created].sort((a, b) => b - a)).toEqual(created);
  });
});

describe('plans', () => {
  async function planWithVersion(
    courseIds: string[],
    status: 'published' | 'retired' = 'published',
  ) {
    const plan = await products.insertPlan(t.db, {
      goalId,
      nameBn: 'প্ল্যান',
      nameEn: 'Plan',
      draftMonthlyPricePoisha: 39_900,
      draftCourseIds: courseIds,
      createdBy: admin,
    });
    const version = await products.insertPlanVersion(
      t.db,
      {
        planId: plan.planId,
        versionNumber: 1,
        monthlyPricePoisha: 39_900,
        publishedAt: at,
        publishedBy: admin,
      },
      { courseIds, examPackageIds: [] },
    );
    await products.updatePlan(
      t.db,
      plan.planId,
      1,
      { status, currentVersionId: version.planVersionId },
      at,
    );
    return { planId: plan.planId, planVersionId: version.planVersionId };
  }

  it('stores a version with its items and reads them back sorted (BR10.6)', async () => {
    const a = await publishedCourse();
    const b = await publishedCourse();
    const { planVersionId } = await planWithVersion([b, a]);
    expect(await products.planVersionItems(t.db, planVersionId)).toEqual({
      courseIds: [a, b].sort(),
      examPackageIds: [],
    });
    expect(
      await products.latestPlanVersionNumber(
        t.db,
        (await products.getPlanVersion(t.db, planVersionId))?.planId as string,
      ),
    ).toBe(1);
  });

  it('BR10.8 finds only published plans whose current version includes the item', async () => {
    const shared = await publishedCourse();
    const live = await planWithVersion([shared]);
    await planWithVersion([shared], 'retired');
    const other = await publishedCourse();
    expect(await products.currentPlansIncluding(t.db, { type: 'course', id: shared })).toEqual([
      live.planId,
    ]);
    expect(await products.currentPlansIncluding(t.db, { type: 'course', id: other })).toEqual([]);
  });

  it('BR10.8 forgets an item once a newer current version drops it', async () => {
    const a = await publishedCourse();
    const b = await publishedCourse();
    const { planId } = await planWithVersion([a, b]);
    const v2 = await products.insertPlanVersion(
      t.db,
      { planId, versionNumber: 2, monthlyPricePoisha: 39_900, publishedAt: at, publishedBy: admin },
      { courseIds: [b], examPackageIds: [] },
    );
    await products.updatePlan(t.db, planId, 2, { currentVersionId: v2.planVersionId }, at);
    expect(await products.currentPlansIncluding(t.db, { type: 'course', id: a })).toEqual([]);
    expect(await products.currentPlansIncluding(t.db, { type: 'course', id: b })).toEqual([planId]);
  });

  it('reads the Goal and status of requested items, and the published candidates of a Goal', async () => {
    const courseId = await publishedCourse();
    const exam = await newExam();
    const facts = await products.planItemFacts(t.db, {
      courseIds: [courseId, randomUUID()],
      examPackageIds: [exam.examPackageId],
    });
    expect(facts).toEqual(
      expect.arrayContaining([
        { type: 'course', id: courseId, goalId, status: 'published' },
        { type: 'exam_package', id: exam.examPackageId, goalId, status: 'draft' },
      ]),
    );
    expect(facts).toHaveLength(2);
    const candidates = await products.planCandidates(t.db, goalId);
    expect(candidates.courses.map((c) => c.id)).toContain(courseId);
    expect(candidates.examPackages.map((e) => e.id)).not.toContain(exam.examPackageId);
    expect(await products.planItemFacts(t.db, { courseIds: [], examPackageIds: [] })).toEqual([]);
  });
});

describe('Practice Packs', () => {
  it('lists only published packs for S4 and every pack for its course', async () => {
    const courseId = await publishedCourse();
    const base = {
      courseId,
      titleBn: 'অনুশীলন',
      titleEn: 'Practice',
      listPricePoisha: 19_900,
      questionSetIds: [randomUUID()],
      createdBy: admin,
    };
    const draft = await products.insertPack(t.db, base);
    const live = await products.insertPack(t.db, base);
    const published = await products.updatePack(
      t.db,
      live.practicePackId,
      1,
      { status: 'published', firstPublishedAt: at },
      at,
    );
    expect(published.kind).toBe('applied');
    expect(
      (await products.listPublishedPacksForCourse(t.db, courseId)).map((p) => p.practicePackId),
    ).toEqual([live.practicePackId]);
    expect(
      (await products.listPacksForCourse(t.db, courseId)).map((p) => p.practicePackId),
    ).toEqual([draft.practicePackId, live.practicePackId]);
    expect(await products.updatePack(t.db, draft.practicePackId, 9, { titleEn: 'x' }, at)).toEqual({
      kind: 'stale',
      currentVersion: 1,
    });
  });
});
