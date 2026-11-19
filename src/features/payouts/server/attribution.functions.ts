// A7 attribution queue server functions: Finance or Admin with two-step sign-in (re-checked in the
// service).
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { roleFn, typedInput } from '#src/server/fn.ts';
import { CaseCourseInput, OpenCaseInput, ResolveCaseInput } from './attribution.schema.ts';
import {
  attributionQueue,
  caseCourse,
  openCase,
  postPendingReassignments,
  resolveCase,
} from './attribution.server.ts';

const NoInput = z.object({}).default({});
const FINANCE = ['admin', 'finance'] as const;

export const listAttributionCases = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(FINANCE, NoInput, async ({ actor }) => attributionQueue(actor)));

export const getAttributionCourse = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof CaseCourseInput>())
  .handler(roleFn(FINANCE, CaseCourseInput, async ({ actor, input }) => caseCourse(actor, input)));

export const openAttributionCase = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof OpenCaseInput>())
  .handler(
    roleFn(FINANCE, OpenCaseInput, async ({ actor, input, correlationId }) =>
      openCase(actor, input, correlationId),
    ),
  );

export const resolveAttributionCase = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ResolveCaseInput>())
  .handler(
    roleFn(FINANCE, ResolveCaseInput, async ({ actor, input, correlationId }) =>
      resolveCase(actor, input, correlationId),
    ),
  );

export const postAttributionReassignments = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    roleFn(FINANCE, NoInput, async ({ actor, correlationId }) =>
      postPendingReassignments(actor, correlationId),
    ),
  );
