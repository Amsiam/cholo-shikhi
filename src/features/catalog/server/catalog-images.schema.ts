// POST /api/catalog/images query (SD-214 step 3). One image per request; the body is the raw bytes.
// `kind` cover → targetId is the course (Lead or Admin); inline → targetId is the section (its
// current owner or an Admin; contract 5 assertSectionOwner). The I1 upload control shares this schema.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const ImageUploadQuery = z.strictObject({
  kind: z.enum(['cover', 'inline']),
  targetId: Id,
});
export type ImageUploadQuery = z.infer<typeof ImageUploadQuery>;
