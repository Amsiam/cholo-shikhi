import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EventEnvelope } from './envelope.ts';

const Schema = EventEnvelope('identity.AccountCreated', 1, z.object({ userId: z.uuid() }));
const valid = {
  id: '6f1d1c1e-0d4f-4f7e-9a0e-2b1c3d4e5f60',
  type: 'identity.AccountCreated',
  version: 1,
  aggregateKey: 'u-1',
  occurredAt: '2026-11-13T10:00:00.000Z',
  recordedAt: '2026-11-13T10:00:00.100Z',
  producer: 'identity-access',
  correlationId: 'c-1',
  payload: { userId: '6f1d1c1e-0d4f-4f7e-9a0e-2b1c3d4e5f61' },
};

describe('EventEnvelope', () => {
  it('accepts a valid envelope', () => {
    expect(Schema.parse(valid).type).toBe('identity.AccountCreated');
  });
  it('rejects the wrong version or type', () => {
    expect(Schema.safeParse({ ...valid, version: 2 }).success).toBe(false);
    expect(Schema.safeParse({ ...valid, type: 'x.Y' }).success).toBe(false);
  });
  it('strips unknown payload fields instead of rejecting them (contract 1 events rule)', () => {
    const parsed = Schema.parse({ ...valid, payload: { ...valid.payload, extra: 1 } });
    expect(parsed.payload).toEqual({ userId: valid.payload.userId });
  });
  it('rejects a non-UTC timestamp', () => {
    expect(Schema.safeParse({ ...valid, occurredAt: '2026-11-13T16:00:00+06:00' }).success).toBe(
      false,
    );
  });
});
