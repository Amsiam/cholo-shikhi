// Inputs of the battle server functions.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const QuickMatchInput = z.object({
  topicId: Id.optional(),
  source: z.enum(['bank', 'vault']).default('bank'),
});
export type QuickMatchInput = z.input<typeof QuickMatchInput>;

export const CreateRoomInput = z.object({
  topicId: Id.optional(),
  source: z.enum(['bank', 'vault']).default('bank'),
  questionCount: z.number().int().min(5).max(30).default(10),
});
export type CreateRoomInput = z.input<typeof CreateRoomInput>;

export const JoinByCodeInput = z.object({ code: z.string().trim().min(4).max(12) });
export type JoinByCodeInput = z.input<typeof JoinByCodeInput>;

export const BattleRef = z.object({ battleId: Id });
export type BattleRef = z.input<typeof BattleRef>;

export const BattleAnswerInput = z.object({
  battleId: Id,
  questionId: Id,
  chosenIndex: z.number().int().min(0).max(3),
});
export type BattleAnswerInput = z.input<typeof BattleAnswerInput>;

export const ScheduleBattleInput = z.object({
  goalId: Id,
  titleBn: z.string().trim().min(1).max(150),
  titleEn: z.string().trim().min(1).max(150),
  topicId: Id.optional(),
  questionCount: z.number().int().min(5).max(50),
  startsAtLocal: z.string().max(16),
});
export type ScheduleBattleInput = z.input<typeof ScheduleBattleInput>;

export const NoInput = z.object({});
