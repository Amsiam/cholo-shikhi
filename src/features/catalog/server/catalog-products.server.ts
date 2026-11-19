// Exam packages (UC17, A12), subscription plans (UC18, A9) and Practice Packs (UC19, I1). Every write
// runs in one transaction through the kernel (rate limit, refusal rollback, one refusal log line):
// it takes the product's row lock, checks the version token (BR12.1), re-reads its preconditions
// (BR12.2), applies the change and writes its audit entry (BR10.7) and, for a lifecycle change, one
// IDs-only outbox event (SD-219). A publish creates the next immutable version (BR10.3, BR10.6).
// Exam packages and plans are Admin products (BR10.11, roleFn('admin') with step-up); a Practice
// Pack is its course Lead's (BR10.9, roleFn('instructor') with step-up).
//
// CR-5 has no recorded approval, so unpublish of a product ships behind catalog.unpublish (default
// off, FEATURE_DISABLED), exactly as for courses. CR-8 is approved: a publish runs the question
// check that Assessment registers (BR10.4); until then it answers questionCheckUnavailable.
import { checkGoalAcceptsNewProducts } from '#src/features/goals/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import type { SettingKey } from '#src/features/platform/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import type { Executor } from '#src/server/db.ts';
import {
  createProductRepository,
  type ExamPackageRow,
  type PlanRow,
  type PracticePackRow,
} from '../data/products.repository.ts';
import { PRODUCT_CHANGED, ProductChangedV1 } from '../domain/catalog-events.schema.ts';
import { CATALOG_FLAGS } from '../domain/catalog-flags.ts';
import { CATALOG_SETTINGS } from '../domain/catalog-settings.ts';
import { notFound, staleVersion, validateTitles, validationFailed } from '../domain/course.ts';
import { type CeilingProduct, parseProductPrice, recheckPublishPrice } from '../domain/pricing.ts';
import {
  checkDistinctIds,
  checkExamPackagePublish,
  checkNotInCurrentPlan,
  checkPlanItems,
  checkProductEditable,
  decidePackAuthoring,
  decideQuestionCheck,
  marksUnpublishedChanges,
  needsNewVersion,
  nextVersionNumber,
  type PlanItemRef,
  type ProductEvent,
  type ProductStatus,
  transitionProduct,
  validatePlanNames,
} from '../domain/products.ts';
import type { CatalogKernel, Failure } from './catalog-kernel.ts';
import {
  CoursePacksInput,
  ExamPackageTransitionInput,
  PlanCandidatesInput,
  PlanTransitionInput,
  PracticePackTransitionInput,
  ProductPageInput,
  SaveExamPackageInput,
  SavePlanInput,
  SavePracticePackInput,
} from './catalog-products.schema.ts';
import type {
  ExamPackageAdminRow,
  PlanAdminRow,
  PracticePackRowView,
} from './catalog-products.types.ts';
import { runQuestionReferenceCheck } from './question-check.server.ts';

const CEILING: Readonly<Record<CeilingProduct, SettingKey<number>>> = {
  exam_package: CATALOG_SETTINGS.examPackagePriceMaxPoisha,
  subscription_plan: CATALOG_SETTINGS.planMonthlyPriceMaxPoisha,
  practice_pack: CATALOG_SETTINGS.coursePriceMaxPoisha,
};

const examView = (r: ExamPackageRow): ExamPackageAdminRow => ({
  examPackageId: r.examPackageId,
  goalId: r.goalId,
  titleBn: r.titleBn,
  titleEn: r.titleEn,
  descriptionBn: r.descriptionBn,
  descriptionEn: r.descriptionEn,
  listPricePoisha: r.listPricePoisha,
  status: r.status,
  questionIds: r.draftQuestionIds,
  timeLimitMinutes: r.draftTimeLimitMinutes,
  hasUnpublishedChanges: r.hasUnpublishedChanges,
  hasCurrentVersion: r.currentVersionId !== null,
  pinRank: r.pinRank,
  version: r.version,
});
const planView = (r: PlanRow): PlanAdminRow => ({
  planId: r.planId,
  goalId: r.goalId,
  nameBn: r.nameBn,
  nameEn: r.nameEn,
  monthlyPricePoisha: r.draftMonthlyPricePoisha,
  status: r.status,
  courseIds: r.draftCourseIds,
  examPackageIds: r.draftExamPackageIds,
  hasUnpublishedChanges: r.hasUnpublishedChanges,
  hasCurrentVersion: r.currentVersionId !== null,
  pinRank: r.pinRank,
  version: r.version,
});
const packView = (r: PracticePackRow): PracticePackRowView => ({
  practicePackId: r.practicePackId,
  courseId: r.courseId,
  titleBn: r.titleBn,
  titleEn: r.titleEn,
  listPricePoisha: r.listPricePoisha,
  questionSetIds: r.questionSetIds,
  status: r.status,
  version: r.version,
});

type LifecycleAction = 'published' | 'republished' | 'unpublished' | 'retired';
type Saved = { version: number; status: ProductStatus };

export function createProductService(kernel: CatalogKernel) {
  const repo = createProductRepository();
  const { deps } = kernel;
  const isAdmin = (actor: Actor) => actor.roles.includes('admin');

  async function emit(
    tx: TxHandle,
    event: Omit<ProductChangedV1, 'occurredAt'>,
    at: Date,
    correlationId: string,
  ) {
    const payload = ProductChangedV1.parse({ ...event, occurredAt: at.toISOString() });
    await deps.outbox.publish(tx, {
      ...PRODUCT_CHANGED,
      aggregateKey: event.productId,
      occurredAt: payload.occurredAt,
      payload,
      correlationId,
    });
  }

  /** BR5.9 / BR10.9: the ceiling of the product, SETTING_NOT_SET while unset. */
  const ceiling = (product: CeilingProduct) => deps.readPoisha(CEILING[product]);

  /** Lifecycle action of a publish: the first is published, every later one republished. */
  const publishAction = (firstPublishedAt: Date | null): LifecycleAction =>
    firstPublishedAt ? 'republished' : 'published';

  // ------------------------------------------------------------ exam packages (UC17)

  async function saveExamPackage(
    actor: Actor,
    raw: SaveExamPackageInput,
    correlationId: string,
  ): Promise<Result<Saved & { examPackageId: string }, Failure>> {
    const input = SaveExamPackageInput.parse(raw);
    const context = { actor, operation: 'saveExamPackage' };
    return kernel.write(context, correlationId, async (tx, exec) => {
      if (!isAdmin(actor)) return err(notFound());
      const titles = validateTitles(input);
      if (!titles.ok) return titles;
      const questionIds = checkDistinctIds(input.questionIds, 'questionIds');
      if (!questionIds.ok) return questionIds;
      const max = await ceiling('exam_package');
      if (!max.ok) return max;
      const price = parseProductPrice(input.price, max.value);
      if (!price.ok) return price;
      const fields = {
        ...titles.value,
        descriptionBn: input.descriptionBn?.trim() || null,
        descriptionEn: input.descriptionEn?.trim() || null,
        listPricePoisha: price.value,
        draftQuestionIds: questionIds.value,
        draftTimeLimitMinutes: input.timeLimitMinutes,
      };
      const at = kernel.now();

      if (!input.examPackageId) {
        const goal = checkGoalAcceptsNewProducts(await repo.goalStatus(exec, input.goalId));
        if (!goal.ok) return goal;
        const row = await repo.insertExam(exec, {
          goalId: input.goalId,
          ...fields,
          createdBy: actor.userId,
          createdAt: at,
          updatedAt: at,
        });
        await deps.audit.record(tx, {
          actorId: actor.userId,
          action: 'catalog.examPackage.created',
          subjectType: 'exam_package',
          subjectId: row.examPackageId,
          after: {
            goalId: row.goalId,
            listPricePoisha: row.listPricePoisha,
            questionCount: row.draftQuestionIds.length,
          },
          correlationId,
        });
        return ok({ examPackageId: row.examPackageId, version: row.version, status: row.status });
      }

      const row = await repo.getExamForUpdate(exec, input.examPackageId);
      if (!row) return err(notFound());
      if (row.version !== input.expectedVersion) return err(staleVersion(row.version));
      const editable = checkProductEditable(row.status);
      if (!editable.ok) return editable;
      if (input.goalId !== row.goalId) {
        // BR10.1: a package stays filed under its Goal once it was ever published.
        if (row.firstPublishedAt)
          return err(validationFailed({ goalId: ['errors.catalog.goalFixed'] }));
        const goal = checkGoalAcceptsNewProducts(await repo.goalStatus(exec, input.goalId));
        if (!goal.ok) return goal;
      }
      const changed = marksUnpublishedChanges(
        row.status,
        [row.draftQuestionIds, row.draftTimeLimitMinutes],
        [fields.draftQuestionIds, fields.draftTimeLimitMinutes],
      );
      const updated = await repo.updateExam(
        exec,
        row.examPackageId,
        row.version,
        {
          goalId: input.goalId,
          ...fields,
          hasUnpublishedChanges: row.hasUnpublishedChanges || changed,
        },
        at,
      );
      if (updated.kind !== 'applied') return err(staleVersion(row.version));
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.examPackage.edited',
        subjectType: 'exam_package',
        subjectId: row.examPackageId,
        before: {
          listPricePoisha: row.listPricePoisha,
          questionCount: row.draftQuestionIds.length,
        },
        after: {
          listPricePoisha: fields.listPricePoisha,
          questionCount: fields.draftQuestionIds.length,
        },
        correlationId,
      });
      return ok({
        examPackageId: row.examPackageId,
        version: updated.row.version,
        status: updated.row.status,
      });
    });
  }

  async function publishExamPackage(
    actor: Actor,
    raw: ExamPackageTransitionInput,
    correlationId: string,
  ) {
    const input = ExamPackageTransitionInput.parse(raw);
    const context = { actor, operation: 'publishExamPackage' };
    return kernel.write(context, correlationId, async (tx, exec) => {
      if (!isAdmin(actor)) return err(notFound());
      const row = await repo.getExamForUpdate(exec, input.examPackageId);
      if (!row) return err(notFound());
      if (row.version !== input.expectedVersion) return err(staleVersion(row.version));
      const next = transitionProduct(row.status, 'publish');
      if (!next.ok) return next;
      const contents = checkExamPackagePublish(row);
      if (!contents.ok) return contents;
      const max = await ceiling('exam_package');
      if (!max.ok) return max;
      const price = recheckPublishPrice(row.listPricePoisha, max.value);
      if (!price.ok) return price;
      const isNewVersion = needsNewVersion(row);
      if (isNewVersion) {
        const checked = decideQuestionCheck(
          await runQuestionReferenceCheck({ questionIds: contents.value.questionIds }),
          'questionIds',
        );
        if (!checked.ok) return checked;
      }
      const at = kernel.now();
      let currentVersionId = row.currentVersionId as string;
      let versionNumber = (await repo.latestExamVersionNumber(exec, row.examPackageId)) ?? 1;
      if (isNewVersion) {
        versionNumber = nextVersionNumber(
          await repo.latestExamVersionNumber(exec, row.examPackageId),
        );
        const version = await repo.insertExamVersion(exec, {
          examPackageId: row.examPackageId,
          versionNumber,
          ...contents.value,
          publishedAt: at,
          publishedBy: actor.userId,
        });
        currentVersionId = version.examPackageVersionId;
      }
      const updated = await repo.updateExam(
        exec,
        row.examPackageId,
        row.version,
        {
          status: 'published',
          currentVersionId,
          hasUnpublishedChanges: false,
          firstPublishedAt: row.firstPublishedAt ?? at,
        },
        at,
      );
      if (updated.kind !== 'applied') return err(staleVersion(row.version));
      const action = publishAction(row.firstPublishedAt);
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.examPackage.published',
        subjectType: 'exam_package',
        subjectId: row.examPackageId,
        before: { status: row.status },
        after: {
          status: 'published',
          versionNumber,
          isNewVersion,
          questionCount: contents.value.questionIds.length,
        },
        correlationId,
      });
      await emit(
        tx,
        {
          productType: 'exam_package',
          productId: row.examPackageId,
          goalId: row.goalId,
          action,
          versionNumber,
          actorId: actor.userId,
        },
        at,
        correlationId,
      );
      return ok({
        examPackageId: row.examPackageId,
        status: 'published' as const,
        version: updated.row.version,
        versionNumber,
      });
    });
  }

  async function changeExamStatus(
    event: Exclude<ProductEvent, 'publish'>,
    actor: Actor,
    raw: ExamPackageTransitionInput,
    correlationId: string,
  ) {
    const input = ExamPackageTransitionInput.parse(raw);
    const context = { actor, operation: `${event}ExamPackage` };
    return kernel.write(context, correlationId, async (tx, exec) => {
      if (!isAdmin(actor)) return err(notFound());
      const row = await repo.getExamForUpdate(exec, input.examPackageId);
      if (!row) return err(notFound());
      if (row.version !== input.expectedVersion) return err(staleVersion(row.version));
      const next = transitionProduct(row.status, event);
      if (!next.ok) return next;
      const guard = checkNotInCurrentPlan(
        await repo.currentPlansIncluding(exec, { type: 'exam_package', id: row.examPackageId }),
      );
      if (!guard.ok) return guard;
      const at = kernel.now();
      const updated = await repo.updateExam(
        exec,
        row.examPackageId,
        row.version,
        event === 'unpublish'
          ? { status: 'unpublished', unpublishedAt: at }
          : { status: 'retired', retiredAt: at },
        at,
      );
      if (updated.kind !== 'applied') return err(staleVersion(row.version));
      const action: LifecycleAction = event === 'unpublish' ? 'unpublished' : 'retired';
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: `catalog.examPackage.${action}`,
        subjectType: 'exam_package',
        subjectId: row.examPackageId,
        before: { status: row.status },
        after: { status: next.value },
        correlationId,
      });
      await emit(
        tx,
        {
          productType: 'exam_package',
          productId: row.examPackageId,
          goalId: row.goalId,
          action,
          versionNumber: null,
          actorId: actor.userId,
        },
        at,
        correlationId,
      );
      return ok({
        examPackageId: row.examPackageId,
        status: next.value,
        version: updated.row.version,
      });
    });
  }

  async function listExamPackagesAdmin(actor: Actor, raw: ProductPageInput) {
    const page = ProductPageInput.parse(raw);
    if (!isAdmin(actor)) return err(notFound());
    const result = await repo.listExamsAdmin(deps.db, {
      limit: page.pageSize,
      offset: (page.page - 1) * page.pageSize,
    });
    return ok({ rows: result.rows.map(examView), total: result.total, page: page.page });
  }

  // ------------------------------------------------------------ plans (UC18)

  async function checkItems(
    exec: Executor,
    goalId: string,
    ids: { courseIds: readonly string[]; examPackageIds: readonly string[] },
    requirePublished: boolean,
  ) {
    const requested: PlanItemRef[] = [
      ...ids.courseIds.map((id) => ({ type: 'course' as const, id })),
      ...ids.examPackageIds.map((id) => ({ type: 'exam_package' as const, id })),
    ];
    const facts = requested.length > 0 ? await repo.planItemFacts(exec, ids) : [];
    return checkPlanItems(goalId, requested, facts, requirePublished);
  }

  async function savePlan(
    actor: Actor,
    raw: SavePlanInput,
    correlationId: string,
  ): Promise<Result<Saved & { planId: string }, Failure>> {
    const input = SavePlanInput.parse(raw);
    const context = { actor, operation: 'savePlan' };
    return kernel.write(context, correlationId, async (tx, exec) => {
      if (!isAdmin(actor)) return err(notFound());
      const names = validatePlanNames(input);
      if (!names.ok) return names;
      const courseIds = checkDistinctIds(input.courseIds, 'items');
      if (!courseIds.ok) return courseIds;
      const examPackageIds = checkDistinctIds(input.examPackageIds, 'items');
      if (!examPackageIds.ok) return examPackageIds;
      const max = await ceiling('subscription_plan');
      if (!max.ok) return max;
      const price = parseProductPrice(input.monthlyPrice, max.value);
      if (!price.ok) return price;
      const items = await checkItems(
        exec,
        input.goalId,
        { courseIds: courseIds.value, examPackageIds: examPackageIds.value },
        false,
      );
      if (!items.ok) return items;
      const fields = {
        ...names.value,
        draftMonthlyPricePoisha: price.value,
        draftCourseIds: courseIds.value,
        draftExamPackageIds: examPackageIds.value,
      };
      const at = kernel.now();

      if (!input.planId) {
        const goal = checkGoalAcceptsNewProducts(await repo.goalStatus(exec, input.goalId));
        if (!goal.ok) return goal;
        const row = await repo.insertPlan(exec, {
          goalId: input.goalId,
          ...fields,
          createdBy: actor.userId,
          createdAt: at,
          updatedAt: at,
        });
        await deps.audit.record(tx, {
          actorId: actor.userId,
          action: 'catalog.plan.created',
          subjectType: 'subscription_plan',
          subjectId: row.planId,
          after: {
            goalId: row.goalId,
            monthlyPricePoisha: price.value,
            courseIds: courseIds.value.join(','),
            examPackageIds: examPackageIds.value.join(','),
          },
          correlationId,
        });
        return ok({ planId: row.planId, version: row.version, status: row.status });
      }

      const row = await repo.getPlanForUpdate(exec, input.planId);
      if (!row) return err(notFound());
      if (row.version !== input.expectedVersion) return err(staleVersion(row.version));
      const editable = checkProductEditable(row.status);
      if (!editable.ok) return editable;
      if (input.goalId !== row.goalId)
        return err(validationFailed({ goalId: ['errors.catalog.goalFixed'] }));
      const changed = marksUnpublishedChanges(
        row.status,
        [row.draftMonthlyPricePoisha, row.draftCourseIds, row.draftExamPackageIds],
        [fields.draftMonthlyPricePoisha, fields.draftCourseIds, fields.draftExamPackageIds],
      );
      const updated = await repo.updatePlan(
        exec,
        row.planId,
        row.version,
        { ...fields, hasUnpublishedChanges: row.hasUnpublishedChanges || changed },
        at,
      );
      if (updated.kind !== 'applied') return err(staleVersion(row.version));
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.plan.edited',
        subjectType: 'subscription_plan',
        subjectId: row.planId,
        before: {
          monthlyPricePoisha: row.draftMonthlyPricePoisha,
          courseIds: row.draftCourseIds.join(','),
          examPackageIds: row.draftExamPackageIds.join(','),
        },
        after: {
          monthlyPricePoisha: price.value,
          courseIds: courseIds.value.join(','),
          examPackageIds: examPackageIds.value.join(','),
        },
        correlationId,
      });
      return ok({ planId: row.planId, version: updated.row.version, status: updated.row.status });
    });
  }

  async function publishPlan(actor: Actor, raw: PlanTransitionInput, correlationId: string) {
    const input = PlanTransitionInput.parse(raw);
    const context = { actor, operation: 'publishPlan' };
    return kernel.write(context, correlationId, async (tx, exec) => {
      if (!isAdmin(actor)) return err(notFound());
      // Lock order: the items first (share, in ID order), then the plan row (PD-209).
      const peek = await repo.getPlan(exec, input.planId);
      if (!peek) return err(notFound());
      const items = await checkItems(
        exec,
        peek.goalId,
        { courseIds: peek.draftCourseIds, examPackageIds: peek.draftExamPackageIds },
        true,
      );
      const row = await repo.getPlanForUpdate(exec, input.planId);
      if (!row) return err(notFound());
      // A save between the item read and the lock changed the drafts: the client must reload.
      if (row.version !== input.expectedVersion || row.version !== peek.version)
        return err(staleVersion(row.version));
      const next = transitionProduct(row.status, 'publish');
      if (!next.ok) return next;
      if (!items.ok) return items;
      const max = await ceiling('subscription_plan');
      if (!max.ok) return max;
      const price = recheckPublishPrice(row.draftMonthlyPricePoisha, max.value);
      if (!price.ok) return price;
      const isNewVersion = needsNewVersion(row);
      const at = kernel.now();
      let currentVersionId = row.currentVersionId as string;
      let versionNumber = (await repo.latestPlanVersionNumber(exec, row.planId)) ?? 1;
      if (isNewVersion) {
        versionNumber = nextVersionNumber(await repo.latestPlanVersionNumber(exec, row.planId));
        const version = await repo.insertPlanVersion(
          exec,
          {
            planId: row.planId,
            versionNumber,
            monthlyPricePoisha: price.value,
            publishedAt: at,
            publishedBy: actor.userId,
          },
          { courseIds: row.draftCourseIds, examPackageIds: row.draftExamPackageIds },
        );
        currentVersionId = version.planVersionId;
      }
      const updated = await repo.updatePlan(
        exec,
        row.planId,
        row.version,
        {
          status: 'published',
          currentVersionId,
          hasUnpublishedChanges: false,
          firstPublishedAt: row.firstPublishedAt ?? at,
        },
        at,
      );
      if (updated.kind !== 'applied') return err(staleVersion(row.version));
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.plan.published',
        subjectType: 'subscription_plan',
        subjectId: row.planId,
        before: { status: row.status },
        after: {
          status: 'published',
          versionNumber,
          isNewVersion,
          monthlyPricePoisha: price.value,
          courseIds: row.draftCourseIds.join(','),
          examPackageIds: row.draftExamPackageIds.join(','),
        },
        correlationId,
      });
      await emit(
        tx,
        {
          productType: 'subscription_plan',
          productId: row.planId,
          goalId: row.goalId,
          action: publishAction(row.firstPublishedAt),
          versionNumber,
          actorId: actor.userId,
        },
        at,
        correlationId,
      );
      return ok({
        planId: row.planId,
        status: 'published' as const,
        version: updated.row.version,
        versionNumber,
      });
    });
  }

  async function changePlanStatus(
    event: Exclude<ProductEvent, 'publish'>,
    actor: Actor,
    raw: PlanTransitionInput,
    correlationId: string,
  ) {
    const input = PlanTransitionInput.parse(raw);
    const context = { actor, operation: `${event}Plan` };
    return kernel.write(context, correlationId, async (tx, exec) => {
      if (!isAdmin(actor)) return err(notFound());
      const row = await repo.getPlanForUpdate(exec, input.planId);
      if (!row) return err(notFound());
      if (row.version !== input.expectedVersion) return err(staleVersion(row.version));
      const next = transitionProduct(row.status, event);
      if (!next.ok) return next;
      const at = kernel.now();
      const updated = await repo.updatePlan(
        exec,
        row.planId,
        row.version,
        event === 'unpublish'
          ? { status: 'unpublished', unpublishedAt: at }
          : { status: 'retired', retiredAt: at },
        at,
      );
      if (updated.kind !== 'applied') return err(staleVersion(row.version));
      const action: LifecycleAction = event === 'unpublish' ? 'unpublished' : 'retired';
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: `catalog.plan.${action}`,
        subjectType: 'subscription_plan',
        subjectId: row.planId,
        before: { status: row.status },
        after: { status: next.value },
        correlationId,
      });
      await emit(
        tx,
        {
          productType: 'subscription_plan',
          productId: row.planId,
          goalId: row.goalId,
          action,
          versionNumber: null,
          actorId: actor.userId,
        },
        at,
        correlationId,
      );
      return ok({ planId: row.planId, status: next.value, version: updated.row.version });
    });
  }

  async function listPlansAdmin(actor: Actor, raw: ProductPageInput) {
    const page = ProductPageInput.parse(raw);
    if (!isAdmin(actor)) return err(notFound());
    const result = await repo.listPlansAdmin(deps.db, {
      limit: page.pageSize,
      offset: (page.page - 1) * page.pageSize,
    });
    return ok({ rows: result.rows.map(planView), total: result.total, page: page.page });
  }

  async function listPlanItemCandidates(actor: Actor, raw: PlanCandidatesInput) {
    const input = PlanCandidatesInput.parse(raw);
    if (!isAdmin(actor)) return err(notFound());
    return ok(await repo.planCandidates(deps.db, input.goalId));
  }

  // ------------------------------------------------------------ Practice Packs (UC19)

  /** BR10.9: the course row (share lock) and the caller's role on it. */
  async function loadPackCourse(exec: Executor, actor: Actor, courseId: string) {
    const loaded = await kernel.load(exec, courseId, kernel.courseActor(actor), 'share');
    if (!loaded.ok) return loaded;
    const decided = decidePackAuthoring(loaded.value.role, loaded.value.course.status);
    if (!decided.ok) return decided;
    return ok(loaded.value.course);
  }

  async function savePracticePack(
    actor: Actor,
    raw: SavePracticePackInput,
    correlationId: string,
  ): Promise<Result<Saved & { practicePackId: string }, Failure>> {
    const input = SavePracticePackInput.parse(raw);
    const context = { actor, operation: 'savePracticePack', courseId: input.courseId };
    return kernel.write(context, correlationId, async (tx, exec) => {
      const course = await loadPackCourse(exec, actor, input.courseId);
      if (!course.ok) return course;
      const max = await ceiling('practice_pack');
      if (!max.ok) return max;
      const titles = validateTitles(input);
      if (!titles.ok) return titles;
      const price = parseProductPrice(input.price, max.value);
      if (!price.ok) return price;
      if (input.questionSetIds.length === 0)
        return err(validationFailed({ questionSetIds: ['errors.catalog.questionSetsRequired'] }));
      const sets = checkDistinctIds(input.questionSetIds, 'questionSetIds');
      if (!sets.ok) return sets;
      const fields = { ...titles.value, listPricePoisha: price.value, questionSetIds: sets.value };
      const at = kernel.now();

      if (!input.practicePackId) {
        const row = await repo.insertPack(exec, {
          courseId: input.courseId,
          ...fields,
          createdBy: actor.userId,
          createdAt: at,
          updatedAt: at,
        });
        await deps.audit.record(tx, {
          actorId: actor.userId,
          action: 'catalog.practicePack.created',
          subjectType: 'practice_pack',
          subjectId: row.practicePackId,
          after: {
            courseId: row.courseId,
            listPricePoisha: row.listPricePoisha,
            questionSetCount: row.questionSetIds.length,
          },
          correlationId,
        });
        return ok({ practicePackId: row.practicePackId, version: row.version, status: row.status });
      }

      const row = await repo.getPackForUpdate(exec, input.practicePackId);
      if (!row || row.courseId !== input.courseId) return err(notFound());
      if (row.version !== input.expectedVersion) return err(staleVersion(row.version));
      const editable = checkProductEditable(row.status);
      if (!editable.ok) return editable;
      const updated = await repo.updatePack(exec, row.practicePackId, row.version, fields, at);
      if (updated.kind !== 'applied') return err(staleVersion(row.version));
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.practicePack.edited',
        subjectType: 'practice_pack',
        subjectId: row.practicePackId,
        before: {
          listPricePoisha: row.listPricePoisha,
          questionSetCount: row.questionSetIds.length,
        },
        after: { listPricePoisha: price.value, questionSetCount: sets.value.length },
        correlationId,
      });
      return ok({
        practicePackId: row.practicePackId,
        version: updated.row.version,
        status: updated.row.status,
      });
    });
  }

  async function publishPracticePack(
    actor: Actor,
    raw: PracticePackTransitionInput,
    correlationId: string,
  ) {
    const input = PracticePackTransitionInput.parse(raw);
    const context = { actor, operation: 'publishPracticePack' };
    return kernel.write(context, correlationId, async (tx, exec) => {
      const peek = await repo.getPack(exec, input.practicePackId);
      if (!peek) return err(notFound());
      // Lock order: the course first (share), then the pack (PD-209).
      const course = await loadPackCourse(exec, actor, peek.courseId);
      if (!course.ok) return course;
      const row = await repo.getPackForUpdate(exec, input.practicePackId);
      if (!row) return err(notFound());
      if (row.version !== input.expectedVersion) return err(staleVersion(row.version));
      const next = transitionProduct(row.status, 'publish');
      if (!next.ok) return next;
      const max = await ceiling('practice_pack');
      if (!max.ok) return max;
      const price = recheckPublishPrice(row.listPricePoisha, max.value);
      if (!price.ok) return price;
      const checked = decideQuestionCheck(
        await runQuestionReferenceCheck({
          questionSetIds: row.questionSetIds,
          courseId: row.courseId,
        }),
        'questionSetIds',
      );
      if (!checked.ok) return checked;
      const at = kernel.now();
      const updated = await repo.updatePack(
        exec,
        row.practicePackId,
        row.version,
        { status: 'published', firstPublishedAt: row.firstPublishedAt ?? at },
        at,
      );
      if (updated.kind !== 'applied') return err(staleVersion(row.version));
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.practicePack.published',
        subjectType: 'practice_pack',
        subjectId: row.practicePackId,
        before: { status: row.status },
        after: { status: 'published', listPricePoisha: price.value },
        correlationId,
      });
      await emit(
        tx,
        {
          productType: 'practice_pack',
          productId: row.practicePackId,
          goalId: course.value.goalId,
          action: publishAction(row.firstPublishedAt),
          versionNumber: null,
          actorId: actor.userId,
        },
        at,
        correlationId,
      );
      return ok({
        practicePackId: row.practicePackId,
        status: 'published' as const,
        version: updated.row.version,
      });
    });
  }

  /** I1: the course's packs, for its Lead (a Co-instructor gets notLead, BR10.9). */
  async function listPracticePacks(actor: Actor, raw: CoursePacksInput) {
    const input = CoursePacksInput.parse(raw);
    const loaded = await kernel.load(deps.db, input.courseId, kernel.courseActor(actor), 'none');
    if (!loaded.ok) return loaded;
    const decided = decidePackAuthoring(loaded.value.role, 'published');
    if (!decided.ok) return decided;
    const rows = await repo.listPacksForCourse(deps.db, input.courseId);
    return ok({
      courseStatus: loaded.value.course.status,
      rows: rows.map(packView),
    });
  }

  // ------------------------------------------------------------ CR-5 fallback gates

  async function gated<T>(
    actor: Actor,
    run: () => Promise<Result<T, Failure>>,
  ): Promise<Result<T, Failure | AppError<'FEATURE_DISABLED'>>> {
    if (!(await deps.isFlagEnabled(CATALOG_FLAGS.unpublish, actor.userId)))
      return err(appError('FEATURE_DISABLED'));
    return run();
  }

  return {
    saveExamPackage,
    publishExamPackage,
    unpublishExamPackage: (actor: Actor, raw: ExamPackageTransitionInput, cid: string) =>
      gated(actor, () => changeExamStatus('unpublish', actor, raw, cid)),
    retireExamPackage: (actor: Actor, raw: ExamPackageTransitionInput, cid: string) =>
      changeExamStatus('retire', actor, raw, cid),
    listExamPackagesAdmin,
    savePlan,
    publishPlan,
    unpublishPlan: (actor: Actor, raw: PlanTransitionInput, cid: string) =>
      gated(actor, () => changePlanStatus('unpublish', actor, raw, cid)),
    retirePlan: (actor: Actor, raw: PlanTransitionInput, cid: string) =>
      changePlanStatus('retire', actor, raw, cid),
    listPlansAdmin,
    listPlanItemCandidates,
    savePracticePack,
    publishPracticePack,
    listPracticePacks,
  };
}

export type ProductService = ReturnType<typeof createProductService>;
