// One Zod schema per course lifecycle mutation, shared by the I1 publish dialog and the server
// functions (team.md Validation). The rules that need data (preconditions, captions, blocked links,
// the trial-course guard, who may act) are the domain's.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';
import { MAX_SECTIONS_READ } from '../data/section.repository.ts';

const Version = z.number().int().min(1);

/** Plain-text course description (NFR6.211); the domain enforces the 5,000-character rule. */
export const DESCRIPTION_MAX = 5000;

export const CourseLifecycleRefInput = z.object({ courseId: Id });
export type CourseLifecycleRefInput = z.input<typeof CourseLifecycleRefInput>;

/**
 * UC15 / BR9.1–BR9.5, BR12.1: Course.version, the SectionVersion.version of every working copy the
 * confirmation listed, and the video lessons whose missing captions the publisher confirmed.
 */
export const PublishCourseInput = z.object({
  courseId: Id,
  expectedVersion: Version,
  sectionVersions: z
    .array(z.object({ sectionId: Id, expectedVersion: Version }))
    .max(MAX_SECTIONS_READ)
    .default([]),
  acknowledgedMissingCaptions: z.array(Id).max(5000).default([]),
});
export type PublishCourseInput = z.input<typeof PublishCourseInput>;

/** UC16 / BR4.3: unpublish and retire carry Course.version. */
export const CourseTransitionInput = z.object({ courseId: Id, expectedVersion: Version });
export type CourseTransitionInput = z.input<typeof CourseTransitionInput>;

/** BR9.2 needs a description in at least one language; empty strings clear a language. */
export const SetCourseDescriptionInput = z.object({
  courseId: Id,
  expectedVersion: Version,
  descriptionBn: z.string().max(DESCRIPTION_MAX * 2),
  descriptionEn: z.string().max(DESCRIPTION_MAX * 2),
});
export type SetCourseDescriptionInput = z.input<typeof SetCourseDescriptionInput>;
