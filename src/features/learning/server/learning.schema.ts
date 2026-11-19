// One Zod schema per learning read and write, shared by the screens and the server functions.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const NoInput = z.object({}).default({});

export const CourseRefInput = z.object({ courseId: Id });
export type CourseRefInput = z.input<typeof CourseRefInput>;

export const LessonRefInput = z.object({ courseId: Id, lessonId: Id });
export type LessonRefInput = z.input<typeof LessonRefInput>;

export const SubmitQuizInput = z.object({
  courseId: Id,
  lessonId: Id,
  answers: z
    .array(
      z.object({
        questionId: Id,
        chosenIndex: z.number().int().min(0).max(3).nullable(),
      }),
    )
    .max(200),
});
export type SubmitQuizInput = z.input<typeof SubmitQuizInput>;

export const VaultAnswerInput = z.object({
  questionId: Id,
  chosenIndex: z.number().int().min(0).max(3),
});
export type VaultAnswerInput = z.input<typeof VaultAnswerInput>;

export const StartPracticeInput = z.object({
  topicId: Id,
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  count: z.number().int().min(5).max(30).default(10),
});
export type StartPracticeInput = z.input<typeof StartPracticeInput>;

export const PracticeAnswerInput = z.object({
  questionId: Id,
  chosenIndex: z.number().int().min(0).max(3),
});
export type PracticeAnswerInput = z.input<typeof PracticeAnswerInput>;

/** A study buddy invite code as typed (spaces, dashes and lower case are normalised). */
export const BuddyCodeInput = z.object({
  code: z.string().trim().min(6).max(12),
});
export type BuddyCodeInput = z.input<typeof BuddyCodeInput>;

/** The course NPS answer: a 0–10 score, or null to skip (asked once, US7.18). */
export const CourseNpsInput = z.object({
  courseId: Id,
  score: z.number().int().min(0).max(10).nullable(),
});
export type CourseNpsInput = z.input<typeof CourseNpsInput>;
