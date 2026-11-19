// U2 Catalog outbox events (SD-219, SD-220, LC-207). IDs, enums and instants only (NFR5.203,
// SD-226): strict objects, so a free-text field can never ride along.
// The U1 outbox accepts only `<producer>.<PascalCaseName>` types, so the plan's
// `catalog.coursePublished` / `catalog.contentVisibilityChanged` are spelled in PascalCase here.
import { z } from 'zod';
import { Id, UtcInstant } from '#src/lib/ids.ts';

export const COURSE_PUBLISHED = { type: 'catalog.CoursePublished', version: 1 } as const;

/** Publish, republish, unpublish and retire of a course; aggregate key = courseId. */
export const CoursePublishedV1 = z.strictObject({
  courseId: Id,
  goalId: Id,
  action: z.enum(['published', 'republished', 'unpublished', 'retired']),
  actorId: Id,
  occurredAt: UtcInstant,
});
export type CoursePublishedV1 = z.infer<typeof CoursePublishedV1>;

/** U2-internal: a takedown hide or restore; partition (aggregate) key = courseId. */
export const CONTENT_VISIBILITY_CHANGED = {
  type: 'catalog.ContentVisibilityChanged',
  version: 1,
} as const;

export const ContentVisibilityChangedV1 = z.strictObject({
  courseId: Id,
  contentRef: z.strictObject({ type: z.enum(['course', 'section', 'lesson']), id: Id }),
  takedownNoticeId: Id,
  action: z.enum(['hide', 'restore']),
  occurredAt: UtcInstant,
});
export type ContentVisibilityChangedV1 = z.infer<typeof ContentVisibilityChangedV1>;

/**
 * Publish, republish, unpublish and retire of an exam package, plan or Practice Pack (BR10.7);
 * aggregate key = productId. versionNumber is the current version after a publish (null otherwise).
 */
export const PRODUCT_CHANGED = { type: 'catalog.ProductChanged', version: 1 } as const;

export const ProductChangedV1 = z.strictObject({
  productType: z.enum(['exam_package', 'subscription_plan', 'practice_pack']),
  productId: Id,
  goalId: Id,
  action: z.enum(['published', 'republished', 'unpublished', 'retired']),
  versionNumber: z.number().int().min(1).nullable(),
  actorId: Id,
  occurredAt: UtcInstant,
});
export type ProductChangedV1 = z.infer<typeof ProductChangedV1>;

export const CATALOG_EVENTS = [
  { ...COURSE_PUBLISHED, schema: CoursePublishedV1, aggregateKey: 'courseId' },
  { ...CONTENT_VISIBILITY_CHANGED, schema: ContentVisibilityChangedV1, aggregateKey: 'courseId' },
  { ...PRODUCT_CHANGED, schema: ProductChangedV1, aggregateKey: 'productId' },
] as const;
