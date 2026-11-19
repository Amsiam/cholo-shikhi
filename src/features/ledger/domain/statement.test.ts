// [LT] Monthly instructor statement arithmetic (money module: integer poisha, conservation).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildStatement,
  dhakaMonthRange,
  STATEMENT_LINE_KINDS,
  type StatementLineKind,
} from './statement.ts';

describe('dhakaMonthRange', () => {
  it('starts and ends at midnight in Dhaka (UTC+6), across a year end', () => {
    expect(dhakaMonthRange('2026-11')).toEqual({
      from: new Date('2026-10-31T18:00:00Z'),
      to: new Date('2026-11-30T18:00:00Z'),
    });
    expect(dhakaMonthRange('2026-12')?.to).toEqual(new Date('2026-12-31T18:00:00Z'));
  });
  it('refuses anything that is not YYYY-MM', () => {
    for (const bad of ['2026-13', '2026-1', '26-11', '2026-00', 'x'])
      expect(dhakaMonthRange(bad)).toBeNull();
  });
});

describe('buildStatement', () => {
  const line = (amount: number, at: string, kind: StatementLineKind = 'course_sale') => ({
    occurredAt: new Date(at),
    kind,
    courseId: 'c1',
    amount,
  });
  it('totals sales and refunds and carries the balance forward, oldest line first', () => {
    const s = buildStatement(10_000, [
      line(-3_000, '2026-11-20T00:00:00Z', 'course_refund'),
      line(105_000, '2026-11-02T00:00:00Z'),
    ]);
    expect(s).toMatchObject({
      opening: 10_000,
      earned: 105_000,
      refunded: 3_000,
      net: 102_000,
      closing: 112_000,
    });
    expect(s.lines.map((l) => l.amount)).toEqual([105_000, -3_000]);
  });
  it('subtracts payouts from what is owed, without counting them as refunds', () => {
    const s = buildStatement(50_000, [
      line(105_000, '2026-11-02T00:00:00Z'),
      line(-50_000, '2026-11-05T00:00:00Z', 'instructor_payout'),
    ]);
    expect(s).toMatchObject({
      earned: 105_000,
      refunded: 0,
      paidOut: 50_000,
      net: 105_000,
      closing: 105_000,
    });
  });
  it('is empty-safe', () => {
    expect(buildStatement(0, [])).toMatchObject({
      earned: 0,
      refunded: 0,
      net: 0,
      closing: 0,
      lines: [],
    });
  });
  it('conserves money: closing = opening + sum of lines, all integers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(
          fc.integer({ min: -500_000, max: 500_000 }).filter((n) => n !== 0),
          { maxLength: 40 },
        ),
        (opening, amounts) => {
          // Positive lines are sales; negative ones alternate between refunds and payouts.
          const s = buildStatement(
            opening,
            amounts.map((a, i) =>
              line(
                a,
                new Date(Date.UTC(2026, 10, 1 + (i % 28))).toISOString(),
                a > 0 ? 'course_sale' : i % 2 ? 'course_refund' : 'instructor_payout',
              ),
            ),
          );
          expect(s.closing).toBe(opening + amounts.reduce((x, y) => x + y, 0));
          expect(s.earned - s.refunded).toBe(s.net);
          expect(s.net - s.paidOut).toBe(s.closing - s.opening);
          expect(s.earned).toBeGreaterThanOrEqual(0);
          expect(s.refunded).toBeGreaterThanOrEqual(0);
          expect(s.paidOut).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(s.closing)).toBe(true);
        },
      ),
    );
  });
});

describe('buildStatement: salary, policy adjustments and reassignments (US7.13, US7.16, US7.27)', () => {
  const at = (day: number) => new Date(Date.UTC(2026, 3, day));
  it('keeps each kind on its own total, never counted as a sale', () => {
    const s = buildStatement(1_000, [
      { occurredAt: at(2), kind: 'course_sale', courseId: 'c1', amount: 105_000 },
      { occurredAt: at(3), kind: 'attribution_reassignment', courseId: 'c1', amount: 35_000 },
      { occurredAt: at(30), kind: 'salary_accrual', courseId: null, amount: 2_000_000 },
      { occurredAt: at(30), kind: 'pay_policy_adjustment', courseId: null, amount: -82_500 },
      { occurredAt: at(30), kind: 'instructor_payout', courseId: null, amount: -500_000 },
    ]);
    expect(s).toMatchObject({
      earned: 105_000,
      refunded: 0,
      reassigned: 35_000,
      salary: 2_000_000,
      policyAdjustment: -82_500,
      paidOut: 500_000,
      net: 105_000 + 35_000 + 2_000_000 - 82_500,
      closing: 1_000 + 105_000 + 35_000 + 2_000_000 - 82_500 - 500_000,
    });
  });
  it('conservation: closing = opening + every line, to the poisha, for any mix of kinds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e12, max: 1e12 }),
        fc.array(
          fc.record({
            day: fc.integer({ min: 1, max: 28 }),
            kind: fc.constantFrom(...STATEMENT_LINE_KINDS),
            amount: fc.integer({ min: -1e10, max: 1e10 }),
          }),
          { maxLength: 40 },
        ),
        (opening, raw) => {
          const lines = raw.map((l) => ({
            occurredAt: at(l.day),
            kind: l.kind,
            courseId: null,
            amount: l.amount,
          }));
          const s = buildStatement(opening, lines);
          const sum = lines.reduce((x, l) => x + l.amount, 0);
          expect(s.closing).toBe(opening + sum);
          expect(s.earned - s.refunded + s.reassigned + s.salary + s.policyAdjustment).toBe(s.net);
          expect(s.lines).toHaveLength(lines.length);
        },
      ),
    );
  });
});
