// One Zod schema per S3 / S4 read and per pin write, shared by the route search params, the screens
// and the server functions (team.md Validation). The cursor is bounded here and verified by the
// signed-cursor module (SD-205).
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';
import { CURSOR_MAX_LENGTH } from '../domain/cursor.ts';

/** The S3 tabs in screen order (functional-spec §6). Bundles renders only with catalog.bundlesTab. */
export const CATALOG_TABS = ['courses', 'exam_packages', 'bundles', 'free_trial'] as const;
export const CatalogTab = z.enum(CATALOG_TABS);
export type CatalogTab = z.infer<typeof CatalogTab>;

/** The tabs Catalog itself serves; Bundles is Marketing's read, composed in the route (BR11.3). */
export const CATALOG_SERVED_TABS = ['courses', 'exam_packages', 'free_trial'] as const;
export const CatalogServedTab = z.enum(CATALOG_SERVED_TABS);
export type CatalogServedTab = z.infer<typeof CatalogServedTab>;

const Cursor = z.string().min(1).max(CURSOR_MAX_LENGTH);

/** S3 page address (BR11.7): the selected tab and, for "Load more", the next-page cursor. */
export const CatalogSearch = z.object({
  tab: CatalogTab.catch('courses').default('courses'),
});
export type CatalogSearch = z.infer<typeof CatalogSearch>;

export const ListCatalogInput = z.object({ tab: CatalogServedTab, cursor: Cursor.optional() });
export type ListCatalogInput = z.input<typeof ListCatalogInput>;

/** Catalog course finder: the search text, shared by the search form and the server read. */
export const CourseSearchQuery = z.string().trim().max(100);

/** Courses per finder page, and the highest page number the finder serves (SC-209 bound). */
export const COURSE_SEARCH_PAGE_SIZE = 12;
export const COURSE_SEARCH_MAX_PAGE = 500;

/** The finder read: a Goal, an optional title search and a 1-based page number. */
export const SearchCoursesInput = z.object({
  goalId: Id,
  query: CourseSearchQuery.optional(),
  page: z.number().int().min(1).max(COURSE_SEARCH_MAX_PAGE).default(1),
});
export type SearchCoursesInput = z.input<typeof SearchCoursesInput>;

/**
 * The catalog page address: the picked Goal, the search text and the page. `choose` reopens the
 * exam picker. Bad values fall back instead of failing the page.
 */
export const CatalogPageSearch = z.object({
  goal: Id.optional().catch(undefined),
  q: CourseSearchQuery.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(COURSE_SEARCH_MAX_PAGE).optional().catch(undefined),
  choose: z.coerce.boolean().optional().catch(undefined),
});
export type CatalogPageSearch = z.infer<typeof CatalogPageSearch>;

export const CoursePageInput = z.object({ courseId: Id });
export type CoursePageInput = z.input<typeof CoursePageInput>;

/** BR11.11: the products an Admin can pin: courses, exam packages and plans. */
export const PinTarget = z.object({
  type: z.enum(['course', 'exam_package', 'subscription_plan']),
  id: Id,
});
export type PinTarget = z.infer<typeof PinTarget>;

export const SetPinRankInput = z.object({
  target: PinTarget,
  pinRank: z.number().int().min(1).max(1000),
  expectedVersion: z.number().int().min(1),
});
export type SetPinRankInput = z.input<typeof SetPinRankInput>;

export const ClearPinRankInput = z.object({
  target: PinTarget,
  expectedVersion: z.number().int().min(1),
});
export type ClearPinRankInput = z.input<typeof ClearPinRankInput>;
