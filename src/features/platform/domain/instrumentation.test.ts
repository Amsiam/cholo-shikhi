// [AT] US11.8 Emit instrumentation events with dashboard tiles (written before the implementation).
import { describe, expect, it } from 'vitest';
import { createMetrics } from '#src/lib/metrics.ts';
import {
  createInstrument,
  INSTRUMENTATION_CATALOGUE,
  type InstrumentationSink,
  isPersonalDataKey,
  looksLikePersonalValue,
  missingFromCatalogue,
} from './instrumentation.ts';

function recordingSink() {
  const events: Array<{ eventName: string; properties: Record<string, unknown> }> = [];
  const sink: InstrumentationSink = {
    write: async (event) => {
      events.push({ eventName: event.eventName, properties: event.properties ?? {} });
    },
  };
  return { sink, events };
}

describe('US11.8 instrumentation events', () => {
  it('AC11.8.1 Given emit("enrolment_confirmed", props), When called, Then it reaches central logging and increments its tile', async () => {
    const { sink, events } = recordingSink();
    const metrics = createMetrics();
    const instrument = createInstrument({ sink, metrics, now: () => '2026-11-13T00:00:00.000Z' });
    instrument.emit({
      eventName: 'enrolment_confirmed',
      featureArea: 'commerce',
      correlationId: 'corr-1',
      properties: { courseId: 'c-1', amountPoisha: 150000 },
    });
    await instrument.flush();
    expect(events).toEqual([
      { eventName: 'enrolment_confirmed', properties: { courseId: 'c-1', amountPoisha: 150000 } },
    ]);
    expect(
      metrics.counterValue('instrumentation_events_total', { event: 'enrolment_confirmed' }),
    ).toBe(1);
  });

  it('AC11.8.2 Given props containing a phone number, email or KYC field, Then the schema rejects them before sending', async () => {
    const { sink, events } = recordingSink();
    const metrics = createMetrics();
    const instrument = createInstrument({ sink, metrics, now: () => '2026-11-13T00:00:00.000Z' });
    const personalProps: Array<Record<string, string>> = [
      { phone: '01700000000' },
      { email: 'someone@example.test' },
      { nidNumber: '1234' },
      { note: 'call me at +8801711111111' },
      { contact: 'learner@example.test' },
    ];
    for (const properties of personalProps) {
      instrument.emit({
        eventName: 'enrolment_confirmed',
        featureArea: 'commerce',
        correlationId: 'c',
        properties,
      });
    }
    await instrument.flush();
    expect(events).toHaveLength(0);
    expect(
      metrics.counterValue('instrumentation_rejected_total', { event: 'enrolment_confirmed' }),
    ).toBe(5);
  });

  it('AC11.8.3 Given a story event missing from the catalogue, When the catalogue check runs, Then it fails', () => {
    expect(missingFromCatalogue(['account_created', 'not_a_real_event'])).toEqual([
      'not_a_real_event',
    ]);
    expect(missingFromCatalogue([...INSTRUMENTATION_CATALOGUE.keys()])).toEqual([]);
  });

  it('BR13.4 a sink failure never fails or slows the business operation', async () => {
    const metrics = createMetrics();
    const instrument = createInstrument({
      sink: { write: async () => Promise.reject(new Error('logging down')) },
      metrics,
      now: () => '2026-11-13T00:00:00.000Z',
    });
    expect(() =>
      instrument.emit({
        eventName: 'account_created',
        featureArea: 'identity',
        correlationId: 'c',
      }),
    ).not.toThrow();
    await instrument.flush();
    expect(
      metrics.counterValue('instrumentation_emit_failures_total', { event: 'account_created' }),
    ).toBe(1);
  });

  it('drops an uncatalogued event name at runtime and counts it', async () => {
    const { sink, events } = recordingSink();
    const metrics = createMetrics();
    const instrument = createInstrument({ sink, metrics, now: () => '2026-11-13T00:00:00.000Z' });
    instrument.emit({ eventName: 'made_up_event', featureArea: 'x', correlationId: 'c' });
    await instrument.flush();
    expect(events).toHaveLength(0);
    expect(metrics.counterValue('instrumentation_rejected_total', { event: 'made_up_event' })).toBe(
      1,
    );
  });
});

describe('personal-data detection [LT]', () => {
  it.each([
    'phone',
    'phoneNumber',
    'email',
    'userEmail',
    'name',
    'displayName',
    'otp',
    'nid_number',
    'cardLast4',
    'kycStatus',
  ])('treats %s as personal data', (key) => {
    expect(isPersonalDataKey(key)).toBe(true);
  });

  it.each([
    'jobName',
    'consumerName',
    'courseId',
    'amountPoisha',
    'locale',
    'eventName',
    'attempt',
  ])('allows technical key %s', (key) => {
    expect(isPersonalDataKey(key)).toBe(false);
  });

  it('detects Bangladeshi and international phone numbers and emails in values', () => {
    expect(looksLikePersonalValue('01712345678')).toBe(true);
    expect(looksLikePersonalValue('+8801712345678')).toBe(true);
    expect(looksLikePersonalValue('+447700900123')).toBe(true);
    expect(looksLikePersonalValue('a.b@example.test')).toBe(true);
  });

  it('does not flag UUIDs, counts or enum values', () => {
    expect(looksLikePersonalValue('20261113-0000-4000-8000-000000000001')).toBe(false);
    expect(looksLikePersonalValue('12345678901')).toBe(false);
    expect(looksLikePersonalValue(42)).toBe(false);
    expect(looksLikePersonalValue('student')).toBe(false);
  });
});
