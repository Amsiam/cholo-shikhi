// [UT] US7.1 pay-policy versions (validation, effective date, version in effect), US7.10 record
// dates, US7.24 the leave ledger. Records only: no payroll amount is computed here.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyLeave,
  daysInclusive,
  nextCycleStart,
  policyInEffect,
  validateEmployeeRecord,
  validatePolicy,
} from './hr.ts';

describe('validatePolicy (AC7.1.1, AC7.1.2, AC7.1.4)', () => {
  it('accepts revenue share 3500 bp, per-piece 50000 poisha and hybrid salary + share', () => {
    expect(validatePolicy({ kind: 'revenue_share', shareBps: 3500 })).toEqual({
      ok: true,
      value: { kind: 'revenue_share', shareBps: 3500, salaryPoisha: null, perPiecePoisha: null },
    });
    expect(validatePolicy({ kind: 'per_piece', perPiecePoisha: 50_000 }).ok).toBe(true);
    expect(validatePolicy({ kind: 'salary', salaryPoisha: 3_000_000 }).ok).toBe(true);
    expect(
      validatePolicy({ kind: 'hybrid', salaryPoisha: 2_000_000, shareBps: 1500 }),
    ).toMatchObject({ ok: true, value: { salaryPoisha: 2_000_000, shareBps: 1500 } });
  });
  it('accepts 0 to 10000 bp and refuses 10001, negatives, fractions and missing parts', () => {
    expect(validatePolicy({ kind: 'revenue_share', shareBps: 0 }).ok).toBe(true);
    expect(validatePolicy({ kind: 'revenue_share', shareBps: 10_000 }).ok).toBe(true);
    for (const bad of [
      { kind: 'revenue_share', shareBps: 10_001 },
      { kind: 'revenue_share', shareBps: -1 },
      { kind: 'salary', salaryPoisha: -5 },
      { kind: 'salary', salaryPoisha: 100.5 },
      { kind: 'per_piece', perPiecePoisha: -1 },
      { kind: 'hybrid', salaryPoisha: 2_000_000 },
      { kind: 'salary' },
    ] as const)
      expect(validatePolicy(bad).ok).toBe(false);
  });
  it('property: any whole bp in 0..10000 is accepted, anything else is refused', () => {
    fc.assert(
      fc.property(fc.integer({ min: -20_000, max: 20_000 }), (bps) => {
        expect(validatePolicy({ kind: 'revenue_share', shareBps: bps }).ok).toBe(
          bps >= 0 && bps <= 10_000,
        );
      }),
    );
  });
});

describe('nextCycleStart and policyInEffect (AC7.1.1, AC7.1.3)', () => {
  it('a version saved mid-month takes effect at 00:00 Asia/Dhaka on the 1st of the next month', () => {
    expect(nextCycleStart(new Date('2027-03-15T08:00:00.000Z')).toISOString()).toBe(
      '2027-03-31T18:00:00.000Z',
    );
    // 31 Dec 20:00 UTC is already 1 Jan in Dhaka: the next cycle is February.
    expect(nextCycleStart(new Date('2027-12-31T20:00:00.000Z')).toISOString()).toBe(
      '2028-01-31T18:00:00.000Z',
    );
  });
  it('mid-cycle the current version applies; the new one only from the next cycle', () => {
    const v1 = { version: 1, effectiveFrom: new Date('2027-02-28T18:00:00.000Z') };
    const v2 = { version: 2, effectiveFrom: new Date('2027-03-31T18:00:00.000Z') };
    expect(policyInEffect([v1, v2], new Date('2027-03-20T00:00:00.000Z'))?.version).toBe(1);
    expect(policyInEffect([v2, v1], new Date('2027-04-01T00:00:00.000Z'))?.version).toBe(2);
    expect(policyInEffect([v2], new Date('2027-03-20T00:00:00.000Z'))).toBeNull();
  });
});

describe('employee records (US7.10)', () => {
  it('refuses an exit before joining, a negative or fractional salary; accepts blanks', () => {
    expect(validateEmployeeRecord({ joinedOn: '2027-01-10', exitOn: '2027-04-15' }).ok).toBe(true);
    expect(validateEmployeeRecord({ joinedOn: '2027-04-16', exitOn: '2027-04-15' }).ok).toBe(false);
    expect(validateEmployeeRecord({ salaryPoisha: -1 }).ok).toBe(false);
    expect(validateEmployeeRecord({ salaryPoisha: 1.5 }).ok).toBe(false);
    expect(validateEmployeeRecord({}).ok).toBe(true);
  });
});

describe('leave ledger (US7.24)', () => {
  it('counts calendar days inclusively, and refuses an end before the start', () => {
    expect(daysInclusive('2027-02-01', '2027-02-03')).toBe(3);
    expect(daysInclusive('2027-02-28', '2027-03-01')).toBe(2);
    expect(daysInclusive('2027-02-03', '2027-02-02')).toBeNull();
  });
  it('AC7.24.1: 3 days of leave from 10 leaves 7', () => {
    expect(applyLeave(10, 'leave', 3)).toEqual({
      ok: true,
      value: { balance: 7, isWithoutLeave: false },
    });
  });
  it('AC7.24.2: an absence beyond the balance is marked without leave and takes nothing', () => {
    expect(applyLeave(0, 'absence', 1)).toEqual({
      ok: true,
      value: { balance: 0, isWithoutLeave: true },
    });
    expect(applyLeave(2, 'absence', 1)).toEqual({
      ok: true,
      value: { balance: 1, isWithoutLeave: false },
    });
  });
  it('leave beyond the balance is refused', () => {
    expect(applyLeave(2, 'leave', 3).ok).toBe(false);
  });
  it('property: the balance never goes negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 366 }),
        fc.constantFrom('leave' as const, 'absence' as const),
        fc.integer({ min: 1, max: 400 }),
        (balance, kind, days) => {
          const r = applyLeave(balance, kind, days);
          if (r.ok) expect(r.value.balance).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
