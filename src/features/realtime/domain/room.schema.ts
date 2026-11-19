// Contract 3 realtime types.
import { z } from 'zod';
import { UtcInstant } from '#src/lib/ids.ts';

export const RoomKey = z.string().regex(/^(battle|live):[0-9a-f-]{36}$/);
export type RoomKey = z.infer<typeof RoomKey>;

/** `body` never carries an answer key before its release time or another student's data (BR16.4). */
export const RoomMessage = z.object({
  kind: z.string().min(1).max(60),
  seq: z.number().int().nonnegative(),
  sentAt: UtcInstant,
  body: z.unknown(),
});
export type RoomMessage = z.infer<typeof RoomMessage>;
