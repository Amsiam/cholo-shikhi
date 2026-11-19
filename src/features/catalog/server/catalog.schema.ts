// One Zod schema per Catalog core mutation and read, shared by the I1 forms and the server
// functions (team.md Validation; BR4.2). Shape and bounds live here; the business rules that need
// data (empty-after-trim titles, active Goal, price grammar and bounds, 4/6/12 months, roles) are
// the domain's, with field-specific i18n keys.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

/** Generous shape bound; the domain enforces the 150-character title rule with its own key. */
const Title = z.string().max(300);
const Version = z.number().int().min(1);

export const PageInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageInput = z.input<typeof PageInput>;

export const SectionTitlesInput = z.object({ titleBn: Title, titleEn: Title });

/** UC7 / BR4.1, BR4.2: a course draft with both titles, an active Goal and optional sections. */
export const CreateCourseInput = z.object({
  goalId: Id,
  titleBn: Title,
  titleEn: Title,
  /** Admin only (BR4.1): the Lead, who must hold the Instructor role. */
  leadInstructorId: Id.optional(),
  sections: z.array(SectionTitlesInput).max(50).default([]),
});
export type CreateCourseInput = z.input<typeof CreateCourseInput>;

export const CourseRefInput = z.object({ courseId: Id });
export type CourseRefInput = z.input<typeof CourseRefInput>;

/** UC8 / BR5.1: the price exactly as typed, in Latin or Bangla digits. */
export const SetCoursePriceInput = z.object({
  courseId: Id,
  expectedVersion: Version,
  price: z.string().max(40),
});
export type SetCoursePriceInput = z.input<typeof SetCoursePriceInput>;

/** UC9 / BR5.5: any number arrives here; only 4, 6 or 12 pass the domain check. */
export const SetAccessDurationInput = z.object({
  courseId: Id,
  expectedVersion: Version,
  months: z.number(),
});
export type SetAccessDurationInput = z.input<typeof SetAccessDurationInput>;

/** UC10 / BR6.2–BR6.5: the open SectionOwnership.version is the token (BR12.1). */
export const AssignSectionInput = z.object({
  courseId: Id,
  sectionId: Id,
  assigneeId: Id,
  expectedOwnershipVersion: Version,
});
export type AssignSectionInput = z.input<typeof AssignSectionInput>;

/** BR4.7: an Admin names a course's new Lead; the course version guards against a stale screen. */
export const ChangeLeadInput = z.object({
  courseId: Id,
  newLeadId: Id,
  expectedVersion: Version,
});
export type ChangeLeadInput = z.input<typeof ChangeLeadInput>;

/** UC10 step 4 / BR6.6: every section the Co-instructor owns, each with its ownership version. */
export const RemoveCoInstructorInput = z.object({
  courseId: Id,
  instructorId: Id,
  sections: z
    .array(z.object({ sectionId: Id, expectedOwnershipVersion: Version }))
    .min(1)
    .max(500),
});
export type RemoveCoInstructorInput = z.input<typeof RemoveCoInstructorInput>;

/** UC11 / BR6.8: the working copy's SectionVersion.version is the token (BR12.1). */
export const EditSectionTitleInput = z.object({
  courseId: Id,
  sectionId: Id,
  expectedVersion: Version,
  titleBn: Title,
  titleEn: Title,
});
export type EditSectionTitleInput = z.input<typeof EditSectionTitleInput>;

/** UC24 / BR8.10: Course.version is the token. */
export const AddSectionInput = z.object({
  courseId: Id,
  expectedVersion: Version,
  titleBn: Title,
  titleEn: Title,
});
export type AddSectionInput = z.input<typeof AddSectionInput>;

/** UC24 / BR8.11: the full order of every section that is not removed. */
export const ReorderSectionsInput = z.object({
  courseId: Id,
  expectedVersion: Version,
  sectionIds: z.array(Id).min(1).max(500),
});
export type ReorderSectionsInput = z.input<typeof ReorderSectionsInput>;

/** UC24 / BR8.12: remove, or cancel a pending removal of, one section. */
export const SectionStructureInput = z.object({
  courseId: Id,
  expectedVersion: Version,
  sectionId: Id,
});
export type SectionStructureInput = z.input<typeof SectionStructureInput>;
