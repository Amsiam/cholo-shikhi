// Exam packages, subscription plans and Practice Packs (entities.md). Writes are version-checked in
// the UPDATE itself (BR12.1) and run under the product's row lock; a version row is inserted once
// and never changed (BR10.3, BR10.6, enforced again by migration 0006's triggers). Every read is
// bounded (SC-209). Plans lock after the items they read, never before (lock order: course → exam
// package → plan; PD-209).
import { and, asc, count, desc, eq, inArray, max, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import {
  course,
  examPackage,
  examPackageVersion,
  goal,
  practicePack,
  subscriptionPlan,
  subscriptionPlanVersion,
  subscriptionPlanVersionItem,
} from '#src/server/schema/index.ts';
import type { VersionedWrite } from './course.repository.ts';

export type ExamPackageRow = typeof examPackage.$inferSelect;
export type ExamPackageVersionRow = typeof examPackageVersion.$inferSelect;
export type PlanRow = typeof subscriptionPlan.$inferSelect;
export type PlanVersionRow = typeof subscriptionPlanVersion.$inferSelect;
export type PracticePackRow = typeof practicePack.$inferSelect;

/** Upper bound of one Admin list page and of a candidate or item list (SC-209). */
export const MAX_PRODUCT_PAGE = 100;
export const MAX_CANDIDATES = 500;

type ExamPatch = Partial<
  Pick<
    ExamPackageRow,
    | 'goalId'
    | 'titleBn'
    | 'titleEn'
    | 'descriptionBn'
    | 'descriptionEn'
    | 'listPricePoisha'
    | 'status'
    | 'draftQuestionIds'
    | 'draftTimeLimitMinutes'
    | 'hasUnpublishedChanges'
    | 'currentVersionId'
    | 'firstPublishedAt'
    | 'unpublishedAt'
    | 'retiredAt'
    | 'pinRank'
  >
>;
type PlanPatch = Partial<
  Pick<
    PlanRow,
    | 'goalId'
    | 'nameBn'
    | 'nameEn'
    | 'status'
    | 'draftMonthlyPricePoisha'
    | 'draftCourseIds'
    | 'draftExamPackageIds'
    | 'hasUnpublishedChanges'
    | 'currentVersionId'
    | 'firstPublishedAt'
    | 'unpublishedAt'
    | 'retiredAt'
    | 'pinRank'
  >
>;
type PackPatch = Partial<
  Pick<
    PracticePackRow,
    | 'titleBn'
    | 'titleEn'
    | 'listPricePoisha'
    | 'questionSetIds'
    | 'status'
    | 'firstPublishedAt'
    | 'unpublishedAt'
    | 'retiredAt'
  >
>;

export type PlanItemFactsRow = {
  type: 'course' | 'exam_package';
  id: string;
  goalId: string;
  status: string;
};

export function createProductRepository() {
  async function getExam(exec: Executor, examPackageId: string) {
    const [row] = await exec
      .select()
      .from(examPackage)
      .where(eq(examPackage.examPackageId, examPackageId))
      .limit(1);
    return row;
  }
  async function getPlan(exec: Executor, planId: string) {
    const [row] = await exec
      .select()
      .from(subscriptionPlan)
      .where(eq(subscriptionPlan.planId, planId))
      .limit(1);
    return row;
  }
  async function getPack(exec: Executor, practicePackId: string) {
    const [row] = await exec
      .select()
      .from(practicePack)
      .where(eq(practicePack.practicePackId, practicePackId))
      .limit(1);
    return row;
  }

  return {
    // ------------------------------------------------------------ exam packages
    getExam,
    async getExamForUpdate(exec: Executor, examPackageId: string) {
      const [row] = await exec
        .select()
        .from(examPackage)
        .where(eq(examPackage.examPackageId, examPackageId))
        .limit(1)
        .for('update');
      return row;
    },
    async insertExam(exec: Executor, values: typeof examPackage.$inferInsert) {
      const [row] = await exec.insert(examPackage).values(values).returning();
      return row as ExamPackageRow;
    },
    async updateExam(
      exec: Executor,
      examPackageId: string,
      expectedVersion: number,
      patch: ExamPatch,
      at: Date,
    ): Promise<VersionedWrite<ExamPackageRow>> {
      const [row] = await exec
        .update(examPackage)
        .set({ ...patch, version: sql`${examPackage.version} + 1`, updatedAt: at })
        .where(
          and(
            eq(examPackage.examPackageId, examPackageId),
            eq(examPackage.version, expectedVersion),
          ),
        )
        .returning();
      if (row) return { kind: 'applied', row };
      const current = await getExam(exec, examPackageId);
      return current ? { kind: 'stale', currentVersion: current.version } : { kind: 'missing' };
    },
    async latestExamVersionNumber(exec: Executor, examPackageId: string): Promise<number | null> {
      const [row] = await exec
        .select({ n: max(examPackageVersion.versionNumber) })
        .from(examPackageVersion)
        .where(eq(examPackageVersion.examPackageId, examPackageId));
      return row?.n ?? null;
    },
    async insertExamVersion(exec: Executor, values: typeof examPackageVersion.$inferInsert) {
      const [row] = await exec.insert(examPackageVersion).values(values).returning();
      return row as ExamPackageVersionRow;
    },
    async getExamVersion(exec: Executor, examPackageVersionId: string) {
      const [row] = await exec
        .select()
        .from(examPackageVersion)
        .where(eq(examPackageVersion.examPackageVersionId, examPackageVersionId))
        .limit(1);
      return row;
    },
    async listExamsAdmin(exec: Executor, page: { limit: number; offset: number }) {
      const rows = await exec
        .select()
        .from(examPackage)
        .orderBy(desc(examPackage.createdAt), asc(examPackage.examPackageId))
        .limit(Math.min(page.limit, MAX_PRODUCT_PAGE))
        .offset(page.offset);
      const [total] = await exec.select({ n: count() }).from(examPackage);
      return { rows, total: total?.n ?? 0 };
    },

    // ------------------------------------------------------------ plans
    getPlan,
    async getPlanForUpdate(exec: Executor, planId: string) {
      const [row] = await exec
        .select()
        .from(subscriptionPlan)
        .where(eq(subscriptionPlan.planId, planId))
        .limit(1)
        .for('update');
      return row;
    },
    async insertPlan(exec: Executor, values: typeof subscriptionPlan.$inferInsert) {
      const [row] = await exec.insert(subscriptionPlan).values(values).returning();
      return row as PlanRow;
    },
    async updatePlan(
      exec: Executor,
      planId: string,
      expectedVersion: number,
      patch: PlanPatch,
      at: Date,
    ): Promise<VersionedWrite<PlanRow>> {
      const [row] = await exec
        .update(subscriptionPlan)
        .set({ ...patch, version: sql`${subscriptionPlan.version} + 1`, updatedAt: at })
        .where(
          and(eq(subscriptionPlan.planId, planId), eq(subscriptionPlan.version, expectedVersion)),
        )
        .returning();
      if (row) return { kind: 'applied', row };
      const current = await getPlan(exec, planId);
      return current ? { kind: 'stale', currentVersion: current.version } : { kind: 'missing' };
    },
    async latestPlanVersionNumber(exec: Executor, planId: string): Promise<number | null> {
      const [row] = await exec
        .select({ n: max(subscriptionPlanVersion.versionNumber) })
        .from(subscriptionPlanVersion)
        .where(eq(subscriptionPlanVersion.planId, planId));
      return row?.n ?? null;
    },
    /** BR10.6: the version row and its items, inserted once in the publish transaction. */
    async insertPlanVersion(
      exec: Executor,
      values: typeof subscriptionPlanVersion.$inferInsert,
      items: { courseIds: readonly string[]; examPackageIds: readonly string[] },
    ) {
      const [row] = await exec.insert(subscriptionPlanVersion).values(values).returning();
      const version = row as PlanVersionRow;
      const rows = [
        ...items.courseIds.map((courseId) => ({
          planVersionId: version.planVersionId,
          itemType: 'course' as const,
          courseId,
        })),
        ...items.examPackageIds.map((examPackageId) => ({
          planVersionId: version.planVersionId,
          itemType: 'exam_package' as const,
          examPackageId,
        })),
      ];
      if (rows.length > 0) await exec.insert(subscriptionPlanVersionItem).values(rows);
      return version;
    },
    async getPlanVersion(exec: Executor, planVersionId: string) {
      const [row] = await exec
        .select()
        .from(subscriptionPlanVersion)
        .where(eq(subscriptionPlanVersion.planVersionId, planVersionId))
        .limit(1);
      return row;
    },
    async planVersionItems(exec: Executor, planVersionId: string) {
      const rows = await exec
        .select({
          courseId: subscriptionPlanVersionItem.courseId,
          examPackageId: subscriptionPlanVersionItem.examPackageId,
        })
        .from(subscriptionPlanVersionItem)
        .where(eq(subscriptionPlanVersionItem.planVersionId, planVersionId))
        .limit(MAX_CANDIDATES);
      return {
        courseIds: rows.flatMap((r) => (r.courseId ? [r.courseId] : [])).sort(),
        examPackageIds: rows.flatMap((r) => (r.examPackageId ? [r.examPackageId] : [])).sort(),
      };
    },
    async listPlansAdmin(exec: Executor, page: { limit: number; offset: number }) {
      const rows = await exec
        .select()
        .from(subscriptionPlan)
        .orderBy(desc(subscriptionPlan.createdAt), asc(subscriptionPlan.planId))
        .limit(Math.min(page.limit, MAX_PRODUCT_PAGE))
        .offset(page.offset);
      const [total] = await exec.select({ n: count() }).from(subscriptionPlan);
      return { rows, total: total?.n ?? 0 };
    },
    /**
     * BR10.8: the published plans whose current version includes the item. Locks those plan rows
     * (share), so a plan publish that would add the item waits for this unpublish or retire.
     */
    async currentPlansIncluding(
      exec: Executor,
      item: { type: 'course' | 'exam_package'; id: string },
    ): Promise<string[]> {
      const column =
        item.type === 'course'
          ? subscriptionPlanVersionItem.courseId
          : subscriptionPlanVersionItem.examPackageId;
      const rows = await exec
        .select({ planId: subscriptionPlan.planId })
        .from(subscriptionPlan)
        .innerJoin(
          subscriptionPlanVersionItem,
          eq(subscriptionPlanVersionItem.planVersionId, subscriptionPlan.currentVersionId),
        )
        .where(and(eq(subscriptionPlan.status, 'published'), eq(column, item.id)))
        .orderBy(asc(subscriptionPlan.planId))
        .limit(MAX_CANDIDATES)
        .for('share', { of: subscriptionPlan });
      return rows.map((r) => r.planId);
    },

    /** BR10.1 / BR10.5: Goal and status of the requested plan items, read under a share lock. */
    async planItemFacts(
      exec: Executor,
      ids: { courseIds: readonly string[]; examPackageIds: readonly string[] },
    ): Promise<PlanItemFactsRow[]> {
      const courses = ids.courseIds.length
        ? await exec
            .select({ id: course.courseId, goalId: course.goalId, status: course.status })
            .from(course)
            .where(inArray(course.courseId, [...ids.courseIds]))
            .orderBy(asc(course.courseId))
            .limit(MAX_CANDIDATES)
            .for('share')
        : [];
      const exams = ids.examPackageIds.length
        ? await exec
            .select({
              id: examPackage.examPackageId,
              goalId: examPackage.goalId,
              status: examPackage.status,
            })
            .from(examPackage)
            .where(inArray(examPackage.examPackageId, [...ids.examPackageIds]))
            .orderBy(asc(examPackage.examPackageId))
            .limit(MAX_CANDIDATES)
            .for('share')
        : [];
      return [
        ...courses.map((c) => ({ type: 'course' as const, ...c })),
        ...exams.map((e) => ({ type: 'exam_package' as const, ...e })),
      ];
    },
    /** A9 item picker: published courses and exam packages of the Goal (BR10.1, BR10.5). */
    async planCandidates(exec: Executor, goalId: string) {
      const courses = await exec
        .select({ id: course.courseId, titleBn: course.titleBn, titleEn: course.titleEn })
        .from(course)
        .where(and(eq(course.goalId, goalId), eq(course.status, 'published')))
        .orderBy(asc(course.titleEn), asc(course.courseId))
        .limit(MAX_CANDIDATES);
      const exams = await exec
        .select({
          id: examPackage.examPackageId,
          titleBn: examPackage.titleBn,
          titleEn: examPackage.titleEn,
        })
        .from(examPackage)
        .where(and(eq(examPackage.goalId, goalId), eq(examPackage.status, 'published')))
        .orderBy(asc(examPackage.titleEn), asc(examPackage.examPackageId))
        .limit(MAX_CANDIDATES);
      return {
        courses: courses.map((c) => ({ type: 'course' as const, ...c })),
        examPackages: exams.map((e) => ({ type: 'exam_package' as const, ...e })),
      };
    },
    async goalStatus(exec: Executor, goalId: string) {
      const [row] = await exec
        .select({ status: goal.status })
        .from(goal)
        .where(eq(goal.goalId, goalId))
        .limit(1);
      return row;
    },

    // ------------------------------------------------------------ Practice Packs
    getPack,
    async getPackForUpdate(exec: Executor, practicePackId: string) {
      const [row] = await exec
        .select()
        .from(practicePack)
        .where(eq(practicePack.practicePackId, practicePackId))
        .limit(1)
        .for('update');
      return row;
    },
    async insertPack(exec: Executor, values: typeof practicePack.$inferInsert) {
      const [row] = await exec.insert(practicePack).values(values).returning();
      return row as PracticePackRow;
    },
    async updatePack(
      exec: Executor,
      practicePackId: string,
      expectedVersion: number,
      patch: PackPatch,
      at: Date,
    ): Promise<VersionedWrite<PracticePackRow>> {
      const [row] = await exec
        .update(practicePack)
        .set({ ...patch, version: sql`${practicePack.version} + 1`, updatedAt: at })
        .where(
          and(
            eq(practicePack.practicePackId, practicePackId),
            eq(practicePack.version, expectedVersion),
          ),
        )
        .returning();
      if (row) return { kind: 'applied', row };
      const current = await getPack(exec, practicePackId);
      return current ? { kind: 'stale', currentVersion: current.version } : { kind: 'missing' };
    },
    async listPacksForCourse(exec: Executor, courseId: string) {
      return exec
        .select()
        .from(practicePack)
        .where(eq(practicePack.courseId, courseId))
        .orderBy(asc(practicePack.createdAt), asc(practicePack.practicePackId))
        .limit(MAX_PRODUCT_PAGE);
    },
    /** Every published pack's course and contents (Practice Pack mock tests, for access checks). */
    async listPublishedPackContents(exec: Executor) {
      return exec
        .select({
          practicePackId: practicePack.practicePackId,
          courseId: practicePack.courseId,
          questionSetIds: practicePack.questionSetIds,
        })
        .from(practicePack)
        .where(eq(practicePack.status, 'published'));
    },
    /** BR11.8: the course's published packs, for S4 (the course itself is checked by the caller). */
    async listPublishedPacksForCourse(exec: Executor, courseId: string) {
      return exec
        .select({
          practicePackId: practicePack.practicePackId,
          titleBn: practicePack.titleBn,
          titleEn: practicePack.titleEn,
          listPricePoisha: practicePack.listPricePoisha,
        })
        .from(practicePack)
        .where(and(eq(practicePack.courseId, courseId), eq(practicePack.status, 'published')))
        .orderBy(asc(practicePack.firstPublishedAt), asc(practicePack.practicePackId))
        .limit(MAX_PRODUCT_PAGE);
    },
  };
}

export type ProductRepository = ReturnType<typeof createProductRepository>;
