// [LT] US3.12: the viewer badge identifies the account without personal data, and jumps.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BADGE_SPOTS, nextBadgeSpot, viewerBadge } from './viewer-badge.ts';

describe('viewerBadge', () => {
  it('is a short code from the account ID only', () => {
    expect(viewerBadge('0f9a5b2e-6d1c-4b8e-9a7f-000000000001')).toBe('CS-0F9A5B2E');
  });
});

describe('nextBadgeSpot', () => {
  it('always moves to a different spot, and every spot stays clear of the caption area', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: BADGE_SPOTS.length - 1 }),
        fc.double({ min: 0, max: 0.999999, noNaN: true }),
        (current, r) => {
          const next = nextBadgeSpot(current, () => r);
          expect(next).not.toBe(current);
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThan(BADGE_SPOTS.length);
        },
      ),
    );
    for (const spot of BADGE_SPOTS) expect(spot.top).toBeLessThanOrEqual(60);
  });
});
