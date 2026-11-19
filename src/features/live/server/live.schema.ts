// Inputs of the live class server functions.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const ScheduleLiveInput = z.object({
  liveClassId: Id.optional(),
  courseId: Id,
  titleBn: z.string().trim().min(1).max(150),
  titleEn: z.string().trim().min(1).max(150),
  youtubeUrl: z.string().trim().min(5).max(300),
  /** Asia/Dhaka local start, "YYYY-MM-DDTHH:mm". */
  startsAtLocal: z.string().max(16),
  durationMinutes: z.number().int().min(10).max(300),
  keepsRecording: z.boolean().default(false),
});
export type ScheduleLiveInput = z.input<typeof ScheduleLiveInput>;

export const LiveRef = z.object({ liveClassId: Id });
export type LiveRef = z.input<typeof LiveRef>;

export const HeartbeatInput = z.object({ liveClassId: Id, isVisible: z.boolean() });
export type HeartbeatInput = z.input<typeof HeartbeatInput>;

export const FireQuizInput = z.object({
  liveClassId: Id,
  topicId: Id.optional(),
  count: z.number().int().min(1).max(10).default(10),
});
export type FireQuizInput = z.input<typeof FireQuizInput>;

export const LiveAnswerInput = z.object({
  quizId: Id,
  questionId: Id,
  chosenIndex: z.number().int().min(0).max(3),
});
export type LiveAnswerInput = z.input<typeof LiveAnswerInput>;

export const NoInput = z.object({});
