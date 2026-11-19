// S3 and S4 server functions (UC5, UC6; NFR6.201). Browsing needs a signed-in user (authedFn); the
// Goal and visibility checks run in the read module. Signed-in responses are no-store through the U1
// response headers (NFR6.220). Pins are Admin-only with step-up (BR11.11). The public catalog
// (searchCatalogCourses, getPublicCoursePage) is explicitly public and read-only: it serves only
// published courses of an active Goal, through the same visibility predicate.
import { createServerFn } from '@tanstack/react-start';
import { authedFn, publicFn, roleFn, typedInput } from '#src/server/fn.ts';
import {
  ClearPinRankInput,
  CoursePageInput,
  ListCatalogInput,
  SearchCoursesInput,
  SetPinRankInput,
} from './catalog-browse.schema.ts';
import { getCatalog } from './catalog-instance.server.ts';

export const listCatalog = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof ListCatalogInput>())
  .handler(
    authedFn(ListCatalogInput, async ({ actor, input }) => getCatalog().listCatalog(actor, input)),
  );

export const getCoursePage = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof CoursePageInput>())
  .handler(
    authedFn(CoursePageInput, async ({ actor, input }) => getCatalog().getCoursePage(actor, input)),
  );

export const searchCatalogCourses = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof SearchCoursesInput>())
  .handler(publicFn(SearchCoursesInput, async ({ input }) => getCatalog().searchCourses(input)));

export const getPublicCoursePage = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof CoursePageInput>())
  .handler(publicFn(CoursePageInput, async ({ input }) => getCatalog().getCoursePage(null, input)));

export const setPinRank = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SetPinRankInput>())
  .handler(
    roleFn('admin', SetPinRankInput, async ({ actor, input, correlationId }) =>
      getCatalog().setPinRank(actor, input, correlationId),
    ),
  );

export const clearPinRank = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ClearPinRankInput>())
  .handler(
    roleFn('admin', ClearPinRankInput, async ({ actor, input, correlationId }) =>
      getCatalog().clearPinRank(actor, input, correlationId),
    ),
  );
