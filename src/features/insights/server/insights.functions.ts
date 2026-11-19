// Statistics and finance server functions. Course statistics and earnings need an instructor or
// Admin with two-step sign-in (roleFn); platform finance is Admin-only.
import { createServerFn } from '@tanstack/react-start';
import { roleFn, typedInput } from '#src/server/fn.ts';
import {
  CourseInsightsInput,
  NoInput,
  PlatformFinanceInput,
  StatementInput,
} from './insights.schema.ts';
import {
  getCourseInsights,
  getMyEarnings,
  getMyStatement,
  getMyStatementMonths,
  getPlatformFinance,
  getTeachingDashboard,
} from './insights.server.ts';

const STAFF = ['instructor', 'admin'] as const;

export const getCourseStats = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof CourseInsightsInput>())
  .handler(
    roleFn(STAFF, CourseInsightsInput, async ({ actor, input }) => getCourseInsights(actor, input)),
  );

export const getMyInstructorEarnings = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(STAFF, NoInput, async ({ actor }) => getMyEarnings(actor)));

/** I3 Teaching dashboard (US7.17): the caller's own courses. */
export const getMyTeachingDashboard = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(STAFF, NoInput, async ({ actor }) => getTeachingDashboard(actor)));

/** US7.8 (monthly): the months with a statement, and one month's statement with its CSV. */
export const getMyEarningStatementMonths = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(STAFF, NoInput, async ({ actor }) => getMyStatementMonths(actor)));

export const getMyEarningStatement = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof StatementInput>())
  .handler(roleFn(STAFF, StatementInput, async ({ actor, input }) => getMyStatement(actor, input)));

export const getPlatformBooks = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof PlatformFinanceInput>())
  .handler(roleFn(['admin'], PlatformFinanceInput, async ({ input }) => getPlatformFinance(input)));
