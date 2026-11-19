// [LT] US7.2 with salary lines (behind payouts.payrollAndAttribution): conservation to the poisha,
// non-negative payouts, determinism, order independence, and exactly the old cycle when nobody has a
// salary (so the approved golden set and committed cycles are unaffected).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assembleCycle, cycleInputHash } from './cycle.ts';
import { assemblePayCycle, payCycleInputHash } from './pay-cycle.ts';

const one = (earned: number, salary: number, carryIn = 0, isVerified = true) => ({
  month: '2027-04',
  instructors: [{ instructorId: 'a', earned, salary, carryIn, isVerified }],
});

describe('assemblePayCycle', () => {
  it('pays salary plus revenue share', () => {
    expect(assemblePayCycle(one(10_000, 3_000_000)).lines).toEqual([
      {
        instructorId: 'a',
        earned: 10_000,
        salary: 3_000_000,
        adjustment: 0,
        carryIn: 0,
        payout: 3_010_000,
        carryOut: 0,
        state: 'pending',
      },
    ]);
  });

  it('a refund owed back is set against the salary first', () => {
    expect(assemblePayCycle(one(-20_000, 1_500_000)).lines[0]).toMatchObject({
      payout: 1_480_000,
      carryOut: 0,
    });
    expect(assemblePayCycle(one(0, 10_000, 50_000)).lines[0]).toMatchObject({
      payout: 0,
      carryOut: 40_000,
    });
  });

  it('holds an unverified salaried instructor', () => {
    expect(assemblePayCycle(one(0, 1_000, 0, false)).lines[0]).toMatchObject({ state: 'held' });
  });

  it('refuses a salary that is not whole, non-negative poisha', () => {
    expect(() => assemblePayCycle(one(0, -1))).toThrow();
    expect(() => assemblePayCycle(one(0, 0.5))).toThrow();
  });

  it('totals salary separately', () => {
    expect(assemblePayCycle(one(5_000, 7_000)).totals).toEqual({
      earned: 5_000,
      salary: 7_000,
      adjustment: 0,
      payout: 12_000,
      carryIn: 0,
      carryOut: 0,
    });
  });
});

const arbInstructors = fc.uniqueArray(
  fc.record({
    instructorId: fc.uuid(),
    earned: fc.integer({ min: -50_000_000, max: 50_000_000 }),
    salary: fc.integer({ min: 0, max: 50_000_000 }),
    carryIn: fc.integer({ min: 0, max: 50_000_000 }),
    isVerified: fc.boolean(),
  }),
  { selector: (x) => x.instructorId, maxLength: 20 },
);

describe('assemblePayCycle properties', () => {
  it('conserves money per line and in total, and never pays a negative amount', () => {
    fc.assert(
      fc.property(arbInstructors, (instructors) => {
        const c = assemblePayCycle({ month: '2027-04', instructors });
        for (const l of c.lines) {
          expect(l.payout).toBeGreaterThanOrEqual(0);
          expect(l.carryOut).toBeGreaterThanOrEqual(0);
          expect(l.payout - l.carryOut).toBe(l.earned + l.salary - l.carryIn);
        }
        expect(c.totals.payout - c.totals.carryOut).toBe(
          c.totals.earned + c.totals.salary - c.totals.carryIn,
        );
      }),
    );
  });

  it('AC7.2.3/7.2.4: collected = payouts − carry + carry-in + platform share (which may be negative)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { maxLength: 30 }),
        fc.array(fc.integer({ min: 0, max: 20_000_000 }), { minLength: 1, maxLength: 5 }),
        (sales, salaries) => {
          // Each sale: 70% (floored) to instructor i (round robin), the rest to the platform.
          const earned = salaries.map(() => 0);
          let platform = 0;
          sales.forEach((amount, i) => {
            const pool = Number((BigInt(amount) * 7000n) / 10_000n);
            earned[i % salaries.length] = (earned[i % salaries.length] ?? 0) + pool;
            platform += amount - pool;
          });
          const salaryTotal = salaries.reduce((s, x) => s + x, 0);
          const platformShare = platform - salaryTotal;
          const c = assemblePayCycle({
            month: '2027-04',
            instructors: salaries.map((salary, i) => ({
              instructorId: `i${i}`,
              earned: earned[i] ?? 0,
              salary,
              carryIn: 0,
              isVerified: true,
            })),
          });
          const collected = sales.reduce((s, x) => s + x, 0);
          expect(collected).toBe(c.totals.payout - c.totals.carryOut + platformShare);
        },
      ),
    );
  });

  it('is deterministic and order-independent, hash included', () => {
    fc.assert(
      fc.property(arbInstructors, (instructors) => {
        const a = { month: '2027-04', instructors };
        const b = { month: '2027-04', instructors: [...instructors].reverse() };
        expect(assemblePayCycle(a)).toEqual(assemblePayCycle(b));
        expect(payCycleInputHash(a)).toBe(payCycleInputHash(b));
      }),
    );
  });

  it('with no salary it is exactly the old cycle, hash included', () => {
    fc.assert(
      fc.property(arbInstructors, (instructors) => {
        const base = { month: '2027-04', instructors };
        const zero = {
          month: '2027-04',
          instructors: instructors.map((x) => ({ ...x, salary: 0 })),
        };
        const old = assembleCycle(base);
        const now = assemblePayCycle(zero);
        expect(now.lines.map(({ salary: _s, adjustment: _a, ...l }) => l)).toEqual(old.lines);
        expect(payCycleInputHash(zero)).toBe(cycleInputHash(base));
      }),
    );
  });

  it('a different salary or adjustment changes the hash', () => {
    expect(payCycleInputHash(one(0, 1))).not.toBe(payCycleInputHash(one(0, 2)));
    expect(payCycleInputHash(one(0, 1))).not.toBe(payCycleInputHash(one(0, 0)));
    const adj = (adjustment: number) => ({
      month: '2027-04',
      instructors: [{ ...one(0, 1).instructors[0], adjustment } as never],
    });
    expect(payCycleInputHash(adj(-5))).not.toBe(payCycleInputHash(adj(0)));
    expect(payCycleInputHash(adj(0))).toBe(payCycleInputHash(one(0, 1)));
  });

  it('an adjustment is added to the line and totalled (a hybrid share replacing the credit)', () => {
    const c = assemblePayCycle({
      month: '2027-04',
      instructors: [
        {
          instructorId: 'h',
          earned: 700_000,
          salary: 2_000_000,
          adjustment: -550_000,
          carryIn: 0,
          isVerified: true,
        },
      ],
    });
    expect(c.lines[0]).toMatchObject({ earned: 700_000, adjustment: -550_000, payout: 2_150_000 });
    expect(c.totals.adjustment).toBe(-550_000);
    expect(() =>
      assemblePayCycle({
        month: '2027-04',
        instructors: [
          {
            instructorId: 'h',
            earned: 0,
            salary: 0,
            adjustment: 0.5,
            carryIn: 0,
            isVerified: true,
          },
        ],
      }),
    ).toThrow();
  });
});
