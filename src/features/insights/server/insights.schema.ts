// Inputs for the statistics and finance server functions.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const CourseInsightsInput = z.object({
  courseId: Id,
  q: z.string().trim().max(100).default(''),
  page: z.number().int().min(1).max(10_000).default(1),
});
export type CourseInsightsInput = z.input<typeof CourseInsightsInput>;

export const PlatformFinanceInput = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
});
export type PlatformFinanceInput = z.input<typeof PlatformFinanceInput>;

export const NoInput = z.object({});

/** URL search params of the course statistics page; anything malformed is dropped. */
export const CourseStatsSearch = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});

/** URL search params of the platform books page. */
export const BooksSearch = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});

/** One month's statement: YYYY-MM (Asia/Dhaka). */
export const StatementInput = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
export type StatementInput = z.input<typeof StatementInput>;
