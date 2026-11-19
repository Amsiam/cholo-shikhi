// [LT] Course NPS (US7.17): % promoters − % detractors, hidden below 5 responses.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { npsOf } from './nps.ts';

describe('npsOf', () => {
  it('AC7.17.1: 12 promoters, 5 passives, 3 detractors of 20 give 45', () => {
    const scores = [...Array(12).fill(10), ...Array(5).fill(7), ...Array(3).fill(3)];
    expect(npsOf(scores)).toEqual({
      responses: 20,
      promoters: 12,
      passives: 5,
      detractors: 3,
      nps: 45,
    });
  });
  it('AC7.17.2: fewer than 5 responses is "not enough responses"', () => {
    expect(npsOf([10, 10, 10, 10]).nps).toBeNull();
    expect(npsOf([]).nps).toBeNull();
    expect(npsOf([9, 9, 9, 9, 0]).nps).toBe(60);
  });
  it('stays within −100..100 and the groups add up', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 5, maxLength: 60 }),
        (s) => {
          const r = npsOf(s);
          expect(r.promoters + r.passives + r.detractors).toBe(s.length);
          expect(r.nps).toBeGreaterThanOrEqual(-100);
          expect(r.nps).toBeLessThanOrEqual(100);
        },
      ),
    );
  });
});
