// [LT] Step 17: the fixed windows of the authoring rate limits (NFR6.216, SD-218).
import { describe, expect, it } from 'vitest';
import {
  AUTHORING_WRITES_PER_MINUTE,
  COURSE_CREATIONS_PER_DHAKA_DAY,
  dhakaDayStart,
  limitWindow,
} from './limits.ts';

describe('authoring rate limits', () => {
  it('keeps the design values (changing them needs the human)', () => {
    expect(AUTHORING_WRITES_PER_MINUTE).toBe(60);
    expect(COURSE_CREATIONS_PER_DHAKA_DAY).toBe(10);
  });

  it('starts the Dhaka day at 18:00 UTC of the previous UTC day', () => {
    expect(dhakaDayStart(new Date('2026-11-16T10:00:00Z')).toISOString()).toBe(
      '2026-11-15T18:00:00.000Z',
    );
    expect(dhakaDayStart(new Date('2026-11-16T18:00:00Z')).toISOString()).toBe(
      '2026-11-16T18:00:00.000Z',
    );
    expect(dhakaDayStart(new Date('2026-11-16T17:59:59.999Z')).toISOString()).toBe(
      '2026-11-15T18:00:00.000Z',
    );
  });

  it('gives the authoring window 60 s from the first attempt', () => {
    const now = new Date('2026-11-16T10:00:30Z');
    const w = limitWindow('authoring', now);
    expect(w).toMatchObject({ action: 'catalog_authoring', limit: 60, windowStart: now });
    expect(w.expiredAtOrBefore.toISOString()).toBe('2026-11-16T09:59:30.000Z');
    expect(w.endsAt(now).toISOString()).toBe('2026-11-16T10:01:30.000Z');
  });

  it('gives course creation the Dhaka calendar day', () => {
    const w = limitWindow('courseCreate', new Date('2026-11-16T10:00:00Z'));
    expect(w).toMatchObject({ action: 'catalog_course_create', limit: 10 });
    expect(w.windowStart.toISOString()).toBe('2026-11-15T18:00:00.000Z');
    expect(w.expiredAtOrBefore.toISOString()).toBe('2026-11-15T17:59:59.999Z');
    expect(w.endsAt(w.windowStart).toISOString()).toBe('2026-11-16T18:00:00.000Z');
  });
});
