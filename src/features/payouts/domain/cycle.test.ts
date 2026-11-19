// [LT] Payout cycle rules (US7.2, US7.3, US7.5; revenue share only): what each instructor is paid
// from what the ledger says they are owed, with carry-forward of anything owed back. Money module:
// integer poisha, conservation, determinism and order independence.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  assembleCycle,
  type CycleInput,
  cycleCutoff,
  cycleInputHash,
  endedMonths,
  nextLineState,
} from './cycle.ts';

const input = (instructors: CycleInput['instructors']): CycleInput => ({
  month: '2026-11',
  instructors,
});

describe('assembleCycle', () => {
  it('pays what was earned when nothing is carried in', () => {
    expect(
      assembleCycle(input([{ instructorId: 'a', earned: 105_000, carryIn: 0, isVerified: true }]))
        .lines,
    ).toEqual([
      {
        instructorId: 'a',
        earned: 105_000,
        carryIn: 0,
        payout: 105_000,
        carryOut: 0,
        state: 'pending',
      },
    ]);
  });
  it('a negative cycle (a refund of an already-paid sale) pays 0 and carries the rest forward', () => {
    expect(
      assembleCycle(input([{ instructorId: 'a', earned: -20_000, carryIn: 0, isVerified: true }]))
        .lines[0],
    ).toMatchObject({ payout: 0, carryOut: 20_000 });
  });
  it('AC7.11.2-style carry-forward: 5000 against 20000 owed pays 0; 30000 next pays 15000', () => {
    const first = assembleCycle(
      input([{ instructorId: 'a', earned: 5_000, carryIn: 20_000, isVerified: true }]),
    ).lines[0];
    expect(first).toMatchObject({ payout: 0, carryOut: 15_000 });
    const second = assembleCycle(
      input([
        { instructorId: 'a', earned: 30_000, carryIn: first?.carryOut ?? 0, isVerified: true },
      ]),
    ).lines[0];
    expect(second).toMatchObject({ payout: 15_000, carryOut: 0 });
  });
  it('holds the line of an instructor whose KYC or payout account is not verified', () => {
    expect(
      assembleCycle(input([{ instructorId: 'a', earned: 10_000, carryIn: 0, isVerified: false }]))
        .lines[0],
    ).toMatchObject({ payout: 10_000, state: 'held', holdReason: 'kyc' });
  });
  it('a zero-revenue cycle gives no line', () => {
    expect(
      assembleCycle(input([{ instructorId: 'a', earned: 0, carryIn: 0, isVerified: true }])).lines,
    ).toEqual([]);
  });
  it('totals the cycle', () => {
    const c = assembleCycle(
      input([
        { instructorId: 'a', earned: 100_000, carryIn: 0, isVerified: true },
        { instructorId: 'b', earned: -5_000, carryIn: 0, isVerified: true },
      ]),
    );
    expect(c.totals).toEqual({ earned: 95_000, payout: 100_000, carryIn: 0, carryOut: 5_000 });
  });
  it('refuses the same instructor twice in one cycle', () => {
    const x = { instructorId: 'a', earned: 1, carryIn: 0, isVerified: true };
    expect(() => assembleCycle(input([x, x]))).toThrow();
  });
  it('refuses non-integer or unsafe money, and a negative carry-in', () => {
    expect(() =>
      assembleCycle(input([{ instructorId: 'a', earned: 10.5, carryIn: 0, isVerified: true }])),
    ).toThrow();
    expect(() =>
      assembleCycle(input([{ instructorId: 'a', earned: 1, carryIn: -1, isVerified: true }])),
    ).toThrow();
  });

  const instructorArb = fc.record({
    instructorId: fc.uuid(),
    earned: fc.integer({ min: -5_000_000, max: 5_000_000 }),
    carryIn: fc.integer({ min: 0, max: 5_000_000 }),
    isVerified: fc.boolean(),
  });
  it('conserves money for every instructor: payout − carryOut = earned − carryIn, never negative', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(instructorArb, { selector: (x) => x.instructorId, maxLength: 30 }),
        (xs) => {
          for (const line of assembleCycle(input(xs)).lines) {
            expect(line.payout - line.carryOut).toBe(line.earned - line.carryIn);
            expect(line.payout).toBeGreaterThanOrEqual(0);
            expect(line.carryOut).toBeGreaterThanOrEqual(0);
            expect(line.payout === 0 || line.carryOut === 0).toBe(true);
          }
        },
      ),
    );
  });
  it('is deterministic and independent of input order (results and hash)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(instructorArb, { selector: (x) => x.instructorId, maxLength: 20 }),
        (xs) => {
          const a = input(xs);
          const b = input([...xs].reverse());
          expect(assembleCycle(a)).toEqual(assembleCycle(b));
          expect(cycleInputHash(a)).toBe(cycleInputHash(b));
        },
      ),
    );
  });
  it('the input hash changes when any input changes', () => {
    const base = input([{ instructorId: 'a', earned: 100, carryIn: 0, isVerified: true }]);
    const changed = input([{ instructorId: 'a', earned: 101, carryIn: 0, isVerified: true }]);
    expect(cycleInputHash(base)).not.toBe(cycleInputHash(changed));
    expect(cycleInputHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('nextLineState (US7.4, US7.5)', () => {
  it('pending → disbursed or held; held → pending again only by release; disbursed is final', () => {
    expect(nextLineState('pending', 'disbursed')).toBe('disbursed');
    expect(nextLineState('pending', 'failed')).toBe('held');
    expect(nextLineState('held', 'release')).toBe('pending');
    expect(nextLineState('held', 'disbursed')).toBeNull();
    expect(nextLineState('disbursed', 'failed')).toBeNull();
    expect(nextLineState('disbursed', 'disbursed')).toBeNull();
    expect(nextLineState('pending', 'release')).toBeNull();
  });
});

describe('cycle months', () => {
  it('a month ends at midnight on the 1st of the next month, Dhaka time', () => {
    expect(cycleCutoff('2026-11')).toEqual(new Date('2026-11-30T18:00:00Z'));
    expect(cycleCutoff('2026-12')).toEqual(new Date('2026-12-31T18:00:00Z'));
    expect(cycleCutoff('2026-13')).toBeNull();
  });
  it('lists the months that have fully ended, newest first, across a year end', () => {
    // 2027-01-01T00:30 in Dhaka is still 2026-12-31 in UTC.
    expect(endedMonths(new Date('2026-12-31T18:30:00Z'), 3)).toEqual([
      '2026-12',
      '2026-11',
      '2026-10',
    ]);
  });
});
