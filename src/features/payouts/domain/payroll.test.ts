// [LT] US7.16 monthly payroll (salary lines), AC7.10.3: proration for joiners and leavers to the
// poisha, absence without leave flagged and never deducted, a missing salary refused by name.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { daysInMonth, payroll, salaryLine, toPayrollEmployees } from './payroll.ts';

const employee = (over: Partial<Parameters<typeof salaryLine>[1]> = {}) => ({
  instructorId: 'shirin',
  salaryPoisha: 3_000_000,
  joinedOn: null,
  exitOn: null,
  absences: [],
  ...over,
});

describe('daysInMonth', () => {
  it('knows month lengths and leap years', () => {
    expect(daysInMonth('2027-04')).toBe(30);
    expect(daysInMonth('2027-01')).toBe(31);
    expect(daysInMonth('2027-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(() => daysInMonth('2027-13')).toThrow();
  });
});

describe('salaryLine', () => {
  it('AC7.16.1: a full month pays the whole salary', () => {
    expect(salaryLine('2027-04', employee())).toEqual({
      ok: true,
      value: {
        instructorId: 'shirin',
        salary: 3_000_000,
        daysPaid: 30,
        daysInMonth: 30,
        absenceWithoutLeaveDays: 0,
      },
    });
  });

  it('AC7.16.2: an exit on 15 Apr pays 3000000 × 15 / 30 = 1500000', () => {
    const r = salaryLine('2027-04', employee({ exitOn: '2027-04-15' }));
    expect(r.ok && r.value).toMatchObject({ salary: 1_500_000, daysPaid: 15 });
  });

  it('AC7.16.2: an exit on 10 Jan pays floor(3000000 × 10 / 31) = 967741', () => {
    const r = salaryLine('2027-01', employee({ exitOn: '2027-01-10' }));
    expect(r.ok && r.value).toMatchObject({ salary: 967_741, daysPaid: 10, daysInMonth: 31 });
  });

  it('a joiner on 20 Apr is paid from that day: floor(3000000 × 11 / 30) = 1100000', () => {
    const r = salaryLine('2027-04', employee({ joinedOn: '2027-04-20' }));
    expect(r.ok && r.value).toMatchObject({ salary: 1_100_000, daysPaid: 11 });
  });

  it('AC7.10.3: an exit on 15 Apr gives no May line; nor does a joiner after the month', () => {
    expect(salaryLine('2027-05', employee({ exitOn: '2027-04-15' }))).toEqual({
      ok: true,
      value: null,
    });
    expect(salaryLine('2027-03', employee({ joinedOn: '2027-04-01' }))).toEqual({
      ok: true,
      value: null,
    });
  });

  it('AC7.16.3: absence without leave is flagged for review, never deducted', () => {
    const r = salaryLine(
      '2027-04',
      employee({
        absences: [
          { startsOn: '2027-03-30', endsOn: '2027-04-02', isWithoutLeave: true },
          { startsOn: '2027-04-10', endsOn: '2027-04-10', isWithoutLeave: true },
          { startsOn: '2027-04-12', endsOn: '2027-04-14', isWithoutLeave: false },
        ],
      }),
    );
    expect(r.ok && r.value).toMatchObject({ salary: 3_000_000, absenceWithoutLeaveDays: 3 });
  });

  it('absence after the exit date is not flagged', () => {
    const r = salaryLine(
      '2027-04',
      employee({
        exitOn: '2027-04-15',
        absences: [{ startsOn: '2027-04-20', endsOn: '2027-04-22', isWithoutLeave: true }],
      }),
    );
    expect(r.ok && r.value).toMatchObject({ absenceWithoutLeaveDays: 0 });
  });

  it('AC7.16.4: an Employee with no salary set is refused, by name', () => {
    expect(salaryLine('2027-04', employee({ salaryPoisha: null }))).toEqual({
      ok: false,
      error: { code: 'NO_SALARY', instructorId: 'shirin' },
    });
  });

  it('refuses a salary that is not whole, non-negative poisha', () => {
    expect(() => salaryLine('2027-04', employee({ salaryPoisha: 1.5 }))).toThrow();
    expect(() => salaryLine('2027-04', employee({ salaryPoisha: -1 }))).toThrow();
  });

  it('a salary of 0 gives a 0 line (not a refusal)', () => {
    const r = salaryLine('2027-04', employee({ salaryPoisha: 0 }));
    expect(r.ok && r.value).toMatchObject({ salary: 0 });
  });
});

describe('payroll', () => {
  it('collects the lines and names every Employee without a salary', () => {
    const run = payroll('2027-04', [
      employee({ instructorId: 'b', salaryPoisha: null }),
      employee({ instructorId: 'a' }),
      employee({ instructorId: 'c', exitOn: '2027-03-31', salaryPoisha: null }),
    ]);
    expect(run.lines.map((l) => l.instructorId)).toEqual(['a']);
    expect(run.missingSalary).toEqual(['b']);
  });
});

const arbDay = (month: string) =>
  fc
    .integer({ min: 1, max: daysInMonth(month) })
    .map((d) => `${month}-${String(d).padStart(2, '0')}`);

describe('payroll properties', () => {
  const month = '2027-01';
  it('never pays more than the salary or less than 0, and a full month pays it exactly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000_000 }),
        fc.option(arbDay(month)),
        fc.option(arbDay(month)),
        (salary, joinedOn, exitOn) => {
          fc.pre(!joinedOn || !exitOn || exitOn >= joinedOn);
          const r = salaryLine(month, employee({ salaryPoisha: salary, joinedOn, exitOn }));
          if (!r.ok || !r.value) throw new Error('expected a line');
          expect(r.value.salary).toBeGreaterThanOrEqual(0);
          expect(r.value.salary).toBeLessThanOrEqual(salary);
          expect(Number.isSafeInteger(r.value.salary)).toBe(true);
          // floor: what is paid is within one poisha of the exact proration, never above it.
          const exact = (BigInt(salary) * BigInt(r.value.daysPaid)) / 31n;
          expect(BigInt(r.value.salary)).toBe(exact);
          if (!joinedOn && !exitOn) expect(r.value.salary).toBe(salary);
        },
      ),
    );
  });

  it('is deterministic and does not depend on the order of employees or absences', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            instructorId: fc.uuid(),
            salaryPoisha: fc.option(fc.integer({ min: 0, max: 100_000_000 })),
            joinedOn: fc.constant(null),
            exitOn: fc.option(arbDay(month)),
            absences: fc.array(
              arbDay(month).map((d) => ({ startsOn: d, endsOn: d, isWithoutLeave: true })),
              { maxLength: 4 },
            ),
          }),
          { selector: (e) => e.instructorId, maxLength: 10 },
        ),
        (staff) => {
          const once = payroll(month, staff);
          expect(payroll(month, [...staff].reverse())).toEqual(once);
          expect(
            payroll(
              month,
              staff.map((s) => ({ ...s, absences: [...s.absences].reverse() })),
            ),
          ).toEqual(once);
        },
      ),
    );
  });
});

describe('toPayrollEmployees', () => {
  const src = (over: Partial<Parameters<typeof toPayrollEmployees>[0][number]>) => ({
    instructorId: 'x',
    instructorType: null,
    policy: null,
    record: null,
    absences: [],
    ...over,
  });

  it('puts Employees on payroll with their HR salary and dates', () => {
    expect(
      toPayrollEmployees([
        src({
          instructorType: 'employee',
          record: { salaryPoisha: 3_000_000, joinedOn: '2027-01-05', exitOn: null },
        }),
      ]),
    ).toEqual([
      {
        instructorId: 'x',
        salaryPoisha: 3_000_000,
        joinedOn: '2027-01-05',
        exitOn: null,
        absences: [],
      },
    ]);
  });

  it('a salary or hybrid policy decides the salary, for anyone', () => {
    const [a, b] = toPayrollEmployees([
      src({
        instructorId: 'a',
        instructorType: 'contractor',
        policy: { kind: 'hybrid', salaryPoisha: 2_000_000 },
      }),
      src({
        instructorId: 'b',
        instructorType: 'employee',
        policy: { kind: 'salary', salaryPoisha: 4_000_000 },
        record: { salaryPoisha: 1, joinedOn: null, exitOn: '2027-04-15' },
      }),
    ]);
    expect(a).toMatchObject({ instructorId: 'a', salaryPoisha: 2_000_000 });
    expect(b).toMatchObject({ instructorId: 'b', salaryPoisha: 4_000_000, exitOn: '2027-04-15' });
  });

  it('leaves out contractors on revenue share or per-piece, and keeps an Employee with no salary', () => {
    expect(
      toPayrollEmployees([
        src({
          instructorType: 'contractor',
          policy: { kind: 'revenue_share', salaryPoisha: null },
        }),
        src({ instructorType: null, policy: { kind: 'per_piece', salaryPoisha: null } }),
      ]),
    ).toEqual([]);
    expect(toPayrollEmployees([src({ instructorType: 'employee' })])).toMatchObject([
      { salaryPoisha: null },
    ]);
  });
});
