// Notification types Catalog sends (BR12.4: IDs and enums only; the text is rendered in the
// recipient's language by Notifications). Declared next to the producer and registered with
// Notifications at start-up (contract 4).
import { defineNotificationType } from '#src/features/notifications/domain/notification-types.ts';

/** UC10 step 2: the assignee of a section is told which course and section are now theirs. */
export const SECTION_ASSIGNED_TYPE = 'notify.catalog.sectionAssigned';

/** UC13 / BR8.3: the Lead is told a section waits for review. */
export const SECTION_SUBMITTED_TYPE = 'notify.catalog.sectionSubmitted';
/** UC14 / BR8.4: the owner is told their section was approved. */
export const SECTION_APPROVED_TYPE = 'notify.catalog.sectionApproved';
/** UC14 / BR8.5: the owner is told their section was returned; the comment is read in I1 only. */
export const SECTION_RETURNED_TYPE = 'notify.catalog.sectionReturned';

/**
 * BR9.6 / NFR6.217: every Admin except the actor is told a course was published, republished,
 * unpublished or retired. Params carry the course ID and the action only (BR12.4).
 */
export const COURSE_PUBLISHED_TYPE = 'notify.catalog.coursePublished';

/**
 * OD-207: a ticket-class moderation signal to every Admin (publish burst, link refusals, course
 * creation limit). Params carry the signal kind and the instructor ID only.
 */
export const MODERATION_SIGNAL_TYPE = 'notify.catalog.moderationSignal';

type InstructorTypeInput = Pick<
  Parameters<typeof defineNotificationType>[0],
  'typeKey' | 'titleKey' | 'bodyKey'
>;
const instructorType = (input: InstructorTypeInput) =>
  defineNotificationType({ ...input, category: 'instructor', defaultChannels: ['in_app'] });

export const CATALOG_NOTIFICATION_TYPES = [
  instructorType({
    typeKey: SECTION_ASSIGNED_TYPE,
    titleKey: 'notify.catalog.sectionAssigned.title',
    bodyKey: 'notify.catalog.sectionAssigned.body',
  }),
  instructorType({
    typeKey: SECTION_SUBMITTED_TYPE,
    titleKey: 'notify.catalog.sectionSubmitted.title',
    bodyKey: 'notify.catalog.sectionSubmitted.body',
  }),
  instructorType({
    typeKey: SECTION_APPROVED_TYPE,
    titleKey: 'notify.catalog.sectionApproved.title',
    bodyKey: 'notify.catalog.sectionApproved.body',
  }),
  instructorType({
    typeKey: SECTION_RETURNED_TYPE,
    titleKey: 'notify.catalog.sectionReturned.title',
    bodyKey: 'notify.catalog.sectionReturned.body',
  }),
  defineNotificationType({
    typeKey: COURSE_PUBLISHED_TYPE,
    category: 'account',
    defaultChannels: ['in_app'],
    titleKey: 'notify.catalog.coursePublished.title',
    bodyKey: 'notify.catalog.coursePublished.body',
  }),
  defineNotificationType({
    typeKey: MODERATION_SIGNAL_TYPE,
    category: 'account',
    defaultChannels: ['in_app'],
    titleKey: 'notify.catalog.moderationSignal.title',
    bodyKey: 'notify.catalog.moderationSignal.body',
  }),
] as const;
