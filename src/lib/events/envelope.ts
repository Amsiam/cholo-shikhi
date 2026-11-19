// Contract 1: event envelope. Payloads carry IDs, poisha amounts, enums and timestamps only.
import { z } from 'zod';
import { Id, UtcInstant } from '../ids.ts';

export function EventEnvelope<P extends z.ZodType>(type: string, version: number, payload: P) {
  return z.object({
    id: Id,
    type: z.literal(type),
    version: z.literal(version),
    aggregateKey: z.string().min(1).max(200),
    occurredAt: UtcInstant,
    recordedAt: UtcInstant,
    producer: z.string(),
    correlationId: z.string(),
    payload,
  });
}

export type Envelope<P> = {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly aggregateKey: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly producer: string;
  readonly correlationId: string;
  readonly payload: P;
};
