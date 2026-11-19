// [LT] UC21: instrumentation events reach the Bangladesh-hosted store; PII never does.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetrics } from '#src/lib/metrics.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createInstrument } from '../domain/instrumentation.ts';
import { createInstrumentationRepository } from './instrumentation.repository.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe('instrumentation sink', () => {
  it('stores catalogued events with their properties', async () => {
    const metrics = createMetrics();
    const instrument = createInstrument({
      sink: createInstrumentationRepository(t.db),
      metrics,
      now: () => '2026-11-13T05:00:00.000Z',
    });
    instrument.emit({
      eventName: 'account_created',
      featureArea: 'identity',
      correlationId: 'corr-x',
      properties: { locale: 'bn' },
    });
    instrument.emit({
      eventName: 'account_created',
      featureArea: 'identity',
      correlationId: 'corr-y',
      properties: { email: 'a@b.test' },
    });
    await instrument.flush();
    const { rows } = await t.pool.query<{
      event_name: string;
      properties: unknown;
      occurred_at: Date;
    }>('SELECT event_name, properties, occurred_at FROM instrumentation_event');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_name: 'account_created', properties: { locale: 'bn' } });
    expect(rows[0]?.occurred_at.toISOString()).toBe('2026-11-13T05:00:00.000Z');
    expect(metrics.counterValue('instrumentation_events_total', { event: 'account_created' })).toBe(
      1,
    );
  });
});
