// Goals server functions (A4 Admin, S1 and S12 Student; NFR6.201). Admin functions use
// roleFn('admin'), which requires the two-step check for staff (U1 BR1.6); Student functions use
// authedFn and act only on the caller's own selection. The only public function is the read-only
// goal list behind the public catalog (listPublicGoals).
import { createServerFn } from '@tanstack/react-start';
import { authedFn, publicFn, roleFn, typedInput } from '#src/server/fn.ts';
import {
  ChangeGoalInput,
  ChooseGoalInput,
  GoalRetireInput,
  GoalSaveInput,
  GoalsAdminListInput,
  NoInput,
  PageInput,
  SegmentDeleteInput,
  SegmentSaveInput,
} from './goals.schema.ts';
import { getGoals } from './goals-instance.server.ts';

// ------------------------------------------------------------------ A4 Admin (UC3, UC4)

export const listSegments = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof PageInput>())
  .handler(roleFn('admin', PageInput, async ({ input }) => getGoals().listSegments(input)));

export const saveSegment = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SegmentSaveInput>())
  .handler(
    roleFn('admin', SegmentSaveInput, async ({ actor, input, correlationId }) =>
      getGoals().saveSegment(actor, input, correlationId),
    ),
  );

export const deleteSegment = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SegmentDeleteInput>())
  .handler(
    roleFn('admin', SegmentDeleteInput, async ({ actor, input, correlationId }) =>
      getGoals().deleteSegment(actor, input, correlationId),
    ),
  );

export const listGoalsAdmin = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof GoalsAdminListInput>())
  .handler(
    roleFn('admin', GoalsAdminListInput, async ({ input }) => getGoals().listGoalsAdmin(input)),
  );

export const saveGoal = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof GoalSaveInput>())
  .handler(
    roleFn('admin', GoalSaveInput, async ({ actor, input, correlationId }) =>
      getGoals().saveGoal(actor, input, correlationId),
    ),
  );

export const retireGoal = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof GoalRetireInput>())
  .handler(
    roleFn('admin', GoalRetireInput, async ({ actor, input, correlationId }) =>
      getGoals().retireGoal(actor, input, correlationId),
    ),
  );

// ------------------------------------------------------------------ S1 / S12 Student (UC1, UC2)

/** The caller's own current Goal; NOT_FOUND when none is chosen (the BR2.1 guard redirects). */
export const getCurrentGoal = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => getGoals().currentGoalView(actor.userId)));

/** Explicitly public (BR1.1): the public catalog's goal picker. Read-only, no notice side effect. */
export const listPublicGoals = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(publicFn(NoInput, async () => getGoals().listPublicGoals()));

export const listActiveGoals = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    authedFn(NoInput, async ({ correlationId }) => getGoals().listActiveGoals(correlationId)),
  );

export const chooseGoal = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ChooseGoalInput>())
  .handler(
    authedFn(ChooseGoalInput, async ({ actor, input, correlationId }) =>
      getGoals().chooseGoal(actor, input, correlationId),
    ),
  );

export const changeGoal = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ChangeGoalInput>())
  .handler(
    authedFn(ChangeGoalInput, async ({ actor, input, correlationId }) =>
      getGoals().changeGoal(actor, input, correlationId),
    ),
  );
