// Course lifecycle server functions (I1 publish dialog; NFR6.201). Every one uses
// roleFn(['instructor', 'admin']) with the staff two-step check; Lead-or-Admin (BR9.1, BR4.3) and the
// takedown lock (NFR6.219) are decided in the service under the row locks. No Catalog function is
// public.
import { createServerFn } from '@tanstack/react-start';
import { roleFn, typedInput } from '#src/server/fn.ts';
import { getCatalog } from './catalog-instance.server.ts';
import {
  CourseLifecycleRefInput,
  CourseTransitionInput,
  PublishCourseInput,
  SetCourseDescriptionInput,
} from './catalog-publish.schema.ts';

const AUTHORING = ['instructor', 'admin'] as const;

export const getPublishReadiness = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof CourseLifecycleRefInput>())
  .handler(
    roleFn(AUTHORING, CourseLifecycleRefInput, async ({ actor, input }) =>
      getCatalog().getPublishReadiness(actor, input),
    ),
  );

export const publishCourse = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof PublishCourseInput>())
  .handler(
    roleFn(AUTHORING, PublishCourseInput, async ({ actor, input, correlationId }) =>
      getCatalog().publishCourse(actor, input, correlationId),
    ),
  );

export const unpublishCourse = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof CourseTransitionInput>())
  .handler(
    roleFn(AUTHORING, CourseTransitionInput, async ({ actor, input, correlationId }) =>
      getCatalog().unpublishCourse(actor, input, correlationId),
    ),
  );

export const retireCourse = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof CourseTransitionInput>())
  .handler(
    roleFn(AUTHORING, CourseTransitionInput, async ({ actor, input, correlationId }) =>
      getCatalog().retireCourse(actor, input, correlationId),
    ),
  );

export const setCourseDescription = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SetCourseDescriptionInput>())
  .handler(
    roleFn(AUTHORING, SetCourseDescriptionInput, async ({ actor, input, correlationId }) =>
      getCatalog().setCourseDescription(actor, input, correlationId),
    ),
  );
