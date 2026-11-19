// Product server functions (NFR6.201). Exam packages (A12) and plans (A9) are Admin products:
// roleFn('admin'), which requires the staff two-step check (BR10.11). Practice Packs (I1) are their
// course Lead's: roleFn('instructor') with the staff two-step check; Lead-only and the published-
// course rule are decided in the service under the course lock (BR10.9). No Catalog function is
// public.
import { createServerFn } from '@tanstack/react-start';
import { roleFn, typedInput } from '#src/server/fn.ts';
import { getCatalog } from './catalog-instance.server.ts';
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

// ---------------------------------------------------------------- A12 exam packages (Admin)

export const listExamPackagesAdmin = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof ProductPageInput>())
  .handler(
    roleFn('admin', ProductPageInput, async ({ actor, input }) =>
      getCatalog().listExamPackagesAdmin(actor, input),
    ),
  );

export const saveExamPackage = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SaveExamPackageInput>())
  .handler(
    roleFn('admin', SaveExamPackageInput, async ({ actor, input, correlationId }) =>
      getCatalog().saveExamPackage(actor, input, correlationId),
    ),
  );

export const publishExamPackage = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ExamPackageTransitionInput>())
  .handler(
    roleFn('admin', ExamPackageTransitionInput, async ({ actor, input, correlationId }) =>
      getCatalog().publishExamPackage(actor, input, correlationId),
    ),
  );

export const unpublishExamPackage = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ExamPackageTransitionInput>())
  .handler(
    roleFn('admin', ExamPackageTransitionInput, async ({ actor, input, correlationId }) =>
      getCatalog().unpublishExamPackage(actor, input, correlationId),
    ),
  );

export const retireExamPackage = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ExamPackageTransitionInput>())
  .handler(
    roleFn('admin', ExamPackageTransitionInput, async ({ actor, input, correlationId }) =>
      getCatalog().retireExamPackage(actor, input, correlationId),
    ),
  );

// ---------------------------------------------------------------- A9 subscription plans (Admin)

export const listPlansAdmin = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof ProductPageInput>())
  .handler(
    roleFn('admin', ProductPageInput, async ({ actor, input }) =>
      getCatalog().listPlansAdmin(actor, input),
    ),
  );

export const listPlanItemCandidates = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof PlanCandidatesInput>())
  .handler(
    roleFn('admin', PlanCandidatesInput, async ({ actor, input }) =>
      getCatalog().listPlanItemCandidates(actor, input),
    ),
  );

export const savePlan = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SavePlanInput>())
  .handler(
    roleFn('admin', SavePlanInput, async ({ actor, input, correlationId }) =>
      getCatalog().savePlan(actor, input, correlationId),
    ),
  );

export const publishPlan = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof PlanTransitionInput>())
  .handler(
    roleFn('admin', PlanTransitionInput, async ({ actor, input, correlationId }) =>
      getCatalog().publishPlan(actor, input, correlationId),
    ),
  );

export const unpublishPlan = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof PlanTransitionInput>())
  .handler(
    roleFn('admin', PlanTransitionInput, async ({ actor, input, correlationId }) =>
      getCatalog().unpublishPlan(actor, input, correlationId),
    ),
  );

export const retirePlan = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof PlanTransitionInput>())
  .handler(
    roleFn('admin', PlanTransitionInput, async ({ actor, input, correlationId }) =>
      getCatalog().retirePlan(actor, input, correlationId),
    ),
  );

// ---------------------------------------------------------------- I1 Practice Packs (Lead)

export const listPracticePacks = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof CoursePacksInput>())
  .handler(
    roleFn('instructor', CoursePacksInput, async ({ actor, input }) =>
      getCatalog().listPracticePacks(actor, input),
    ),
  );

export const savePracticePack = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SavePracticePackInput>())
  .handler(
    roleFn('instructor', SavePracticePackInput, async ({ actor, input, correlationId }) =>
      getCatalog().savePracticePack(actor, input, correlationId),
    ),
  );

export const publishPracticePack = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof PracticePackTransitionInput>())
  .handler(
    roleFn('instructor', PracticePackTransitionInput, async ({ actor, input, correlationId }) =>
      getCatalog().publishPracticePack(actor, input, correlationId),
    ),
  );
