// [TF] Step 50: OD-207 moderation signals, written before the module. Each signal fires at
// threshold + 1 and not at the threshold, once per instructor per window.
import { describe, expect, it } from 'vitest';
import {
  hourWindowStart,
  isLinkRefusal,
  MODERATION_THRESHOLDS,
  publishBursts,
  shouldRaiseLinkSignal,
  signalDedupeKey,
} from './moderation.ts';

describe('OD-207 thresholds', () => {
  it('uses the design values: more than 20 publishes a Dhaka day, more than 10 link refusals an hour', () => {
    expect(MODERATION_THRESHOLDS).toEqual({ publishesPerDhakaDay: 20, linkRefusalsPerHour: 10 });
  });
});

describe('publishBursts', () => {
  it('flags an instructor at 21 publishes and not at 20', () => {
    expect(
      publishBursts([
        { actorId: 'a', publishes: 21 },
        { actorId: 'b', publishes: 20 },
        { actorId: 'c', publishes: 3 },
      ]),
    ).toEqual(['a']);
  });

  it('ignores system actors and an empty day', () => {
    expect(publishBursts([{ actorId: 'system', publishes: 99 }])).toEqual([]);
    expect(publishBursts([])).toEqual([]);
  });
});

describe('shouldRaiseLinkSignal', () => {
  it('raises exactly when the hourly count crosses 10 (the 11th refusal), never again that hour', () => {
    expect(shouldRaiseLinkSignal(10)).toBe(false);
    expect(shouldRaiseLinkSignal(11)).toBe(true);
    expect(shouldRaiseLinkSignal(12)).toBe(false);
  });
});

describe('isLinkRefusal', () => {
  it('recognises invalid and blocked link refusals only', () => {
    const refusal = (keys: string[]) => ({
      code: 'VALIDATION_FAILED',
      i18nKey: 'errors.common.VALIDATION_FAILED' as const,
      fieldErrors: { 'bodyBn.links.0': keys },
    });
    expect(isLinkRefusal(refusal(['errors.catalog.blockedLink']))).toBe(true);
    expect(isLinkRefusal(refusal(['errors.catalog.linkInvalid']))).toBe(true);
    expect(isLinkRefusal(refusal(['errors.catalog.lessonBodyTooLarge']))).toBe(false);
    expect(isLinkRefusal({ code: 'FORBIDDEN', i18nKey: 'errors.common.FORBIDDEN' })).toBe(false);
  });
});

describe('windows and de-duplication', () => {
  it('starts the hour window on the hour and keys a signal by instructor and window', () => {
    expect(hourWindowStart(new Date('2026-11-17T10:42:13.500Z')).toISOString()).toBe(
      '2026-11-17T10:00:00.000Z',
    );
    expect(signalDedupeKey('publishBurst', 'i-1', new Date('2026-11-16T18:00:00.000Z'))).toBe(
      'signal:publishBurst:i-1:2026-11-16T18:00:00.000Z',
    );
  });
});
