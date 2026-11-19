// One Zod schema per section-content and review mutation, shared by the I1 lesson editor and the
// server functions (team.md Validation). Shape and bounds live here; the rules that need data
// (titles in one language, the document allowlist, blocked links, completeness, who may act) are the
// domain's, with field-specific i18n keys.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';
import { LESSON_KINDS, MAX_LESSONS_PER_SECTION } from '../domain/lessons.ts';
import { RETURN_COMMENT_MAX } from '../domain/review.ts';

const Title = z.string().max(300);
const Version = z.number().int().min(1);

export const SectionRefInput = z.object({ courseId: Id, sectionId: Id });
export type SectionRefInput = z.input<typeof SectionRefInput>;

/** UC12 / BR7.1, BR7.2: a new lesson goes last; the token is the working copy's version. */
export const AddLessonInput = z.object({
  courseId: Id,
  sectionId: Id,
  expectedVersion: Version,
  kind: z.enum(LESSON_KINDS),
  titleBn: Title,
  titleEn: Title,
});
export type AddLessonInput = z.input<typeof AddLessonInput>;

/** UC12 / BR3.2: the token is that lesson's LessonVersion.version (BR12.1). */
export const EditLessonInput = z.object({
  courseId: Id,
  sectionId: Id,
  lessonId: Id,
  expectedVersion: Version,
  titleBn: Title,
  titleEn: Title,
});
export type EditLessonInput = z.input<typeof EditLessonInput>;

/**
 * UC12 / BR3.4: exactly one language body per call (INF-214), so the request stays under the
 * unchanged 100 KB server-function limit. `null` clears that language's body. The document itself is
 * validated by the domain allowlist, which refuses rather than drops anything unknown.
 */
export const SaveTextLessonBodyInput = z.object({
  courseId: Id,
  sectionId: Id,
  lessonId: Id,
  expectedVersion: Version,
  language: z.enum(['bn', 'en']),
  body: z.custom<unknown>((value) => value !== undefined),
});
export type SaveTextLessonBodyInput = z.input<typeof SaveTextLessonBodyInput>;

/** UC12 / BR7.2: the full new order in one write. */
export const ReorderLessonsInput = z.object({
  courseId: Id,
  sectionId: Id,
  expectedVersion: Version,
  lessonIds: z.array(Id).min(1).max(MAX_LESSONS_PER_SECTION),
});
export type ReorderLessonsInput = z.input<typeof ReorderLessonsInput>;

/** UC12 / BR7.4. */
export const RemoveLessonInput = z.object({
  courseId: Id,
  sectionId: Id,
  expectedVersion: Version,
  lessonId: Id,
});
export type RemoveLessonInput = z.input<typeof RemoveLessonInput>;

/** UC13, UC14 / BR8.3–BR8.8: every review transition carries the working copy's version. */
export const ReviewTransitionInput = z.object({
  courseId: Id,
  sectionId: Id,
  expectedVersion: Version,
});
export type ReviewTransitionInput = z.input<typeof ReviewTransitionInput>;

/** UC14 / BR8.5: the comment is required; the domain trims it and names the field. */
export const ReturnSectionInput = ReviewTransitionInput.extend({
  comment: z.string().max(RETURN_COMMENT_MAX * 2),
});
export type ReturnSectionInput = z.input<typeof ReturnSectionInput>;

/**
 * A video lesson's YouTube video, set on the working copy. The instructor pastes a link or an ID;
 * the domain parses it. null clears the video.
 */
export const SetLessonVideoInput = z.object({
  courseId: Id,
  sectionId: Id,
  lessonId: Id,
  expectedVersion: Version,
  youtube: z.string().trim().max(300).nullable(),
});
export type SetLessonVideoInput = z.input<typeof SetLessonVideoInput>;

/** One quiz lesson, for reading its questions in the editor. */
export const LessonRefInput = z.object({ courseId: Id, sectionId: Id, lessonId: Id });
export type LessonRefInput = z.input<typeof LessonRefInput>;

const QuizText = z.string().max(2000);
/** One MCQ as the editor sends it; the domain trims and checks it (lesson-media.ts). */
export const QuizQuestionDraftInput = z.object({
  promptBn: QuizText,
  promptEn: QuizText,
  optionsBn: z.array(QuizText).length(4),
  optionsEn: z.array(QuizText).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanationBn: QuizText.nullable(),
  explanationEn: QuizText.nullable(),
});
export type QuizQuestionDraftInput = z.input<typeof QuizQuestionDraftInput>;

/** Replaces a quiz lesson's questions on the working copy, against the lesson version's token. */
export const SaveQuizQuestionsInput = z.object({
  courseId: Id,
  sectionId: Id,
  lessonId: Id,
  expectedVersion: Version,
  questions: z.array(QuizQuestionDraftInput).max(60),
  /**
   * US4.13: a streak-only bonus quiz opens only while the Student's streak is at least this many
   * days (1–365); null makes it an ordinary quiz; left out keeps the current setting.
   */
  streakBonusDays: z.number().int().min(1).max(365).nullable().optional(),
});
export type SaveQuizQuestionsInput = z.input<typeof SaveQuizQuestionsInput>;
