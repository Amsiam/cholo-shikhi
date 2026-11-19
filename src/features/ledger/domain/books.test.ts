// [LT] The Admin books by entry type: every kind and account of the ledger schema is listed, each
// entry type is its own line, and the account balances reconcile to the poisha (money module).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LEDGER_ACCOUNT_NAMES, LEDGER_TRANSACTION_KINDS } from '#src/server/schema/ledger.ts';
import {
  type KindAccountTotal,
  LEDGER_ACCOUNTS,
  LEDGER_KINDS,
  ledgerBook,
  reconciles,
} from './books.ts';

describe('ledgerBook', () => {
  it('knows every kind and account the ledger schema allows', () => {
    expect([...LEDGER_KINDS].sort()).toEqual([...LEDGER_TRANSACTION_KINDS].sort());
    expect([...LEDGER_ACCOUNTS].sort()).toEqual([...LEDGER_ACCOUNT_NAMES].sort());
  });

  it('lists salary, policy adjustment, reassignment and referral entries on their own lines', () => {
    const totals: KindAccountTotal[] = [
      { kind: 'course_sale', account: 'gateway_clearing', credit: -150_000 },
      { kind: 'course_sale', account: 'platform_revenue', credit: 45_000 },
      { kind: 'course_sale', account: 'instructor_payable', credit: 105_000 },
      { kind: 'salary_accrual', account: 'salary_expense', credit: -2_000_000 },
      { kind: 'salary_accrual', account: 'instructor_payable', credit: 2_000_000 },
      { kind: 'pay_policy_adjustment', account: 'instructor_payable', credit: -82_500 },
      { kind: 'pay_policy_adjustment', account: 'platform_revenue', credit: 82_500 },
      { kind: 'referral_accrual', account: 'referral_expense', credit: -15_000 },
      { kind: 'referral_accrual', account: 'referral_payable', credit: 15_000 },
    ];
    const book = ledgerBook(
      totals,
      new Map([
        ['course_sale', 1],
        ['salary_accrual', 1],
        ['pay_policy_adjustment', 1],
        ['referral_accrual', 1],
      ]),
    );
    expect(book.entries.map((e) => e.kind)).toEqual([
      'course_sale',
      'salary_accrual',
      'pay_policy_adjustment',
      'referral_accrual',
    ]);
    expect(book.entries.find((e) => e.kind === 'pay_policy_adjustment')?.accounts).toEqual([
      { account: 'platform_revenue', amount: 82_500 },
      { account: 'instructor_payable', amount: -82_500 },
    ]);
    expect(Object.fromEntries(book.balances.map((b) => [b.account, b.amount]))).toEqual({
      gateway_clearing: -150_000,
      platform_revenue: 127_500,
      instructor_payable: 2_022_500,
      salary_expense: -2_000_000,
      referral_expense: -15_000,
      referral_payable: 15_000,
    });
    expect(book.imbalance).toBe(0);
    expect(reconciles(book, book.balances)).toBe(true);
    expect(
      reconciles(book, [...book.balances.slice(1), { account: 'gateway_clearing', amount: 1 }]),
    ).toBe(false);
  });

  it('balanced transactions always give balances that sum to zero and equal the lines', () => {
    const posting = fc.record({
      account: fc.constantFrom(...LEDGER_ACCOUNTS),
      amount: fc.integer({ min: -1e9, max: 1e9 }),
    });
    const tx = fc.record({
      kind: fc.constantFrom(...LEDGER_KINDS),
      postings: fc.array(posting, { minLength: 1, maxLength: 4 }),
      to: fc.constantFrom(...LEDGER_ACCOUNTS),
    });
    fc.assert(
      fc.property(fc.array(tx, { maxLength: 30 }), (txs) => {
        // Each transaction balances: a closing posting takes the rest.
        const postings = txs.flatMap((t) => {
          const rest = t.postings.reduce((s, p) => s + p.amount, 0);
          return [...t.postings, { account: t.to, amount: -rest }].map((p) => ({
            kind: t.kind,
            ...p,
          }));
        });
        const grouped = new Map<string, KindAccountTotal>();
        for (const p of postings) {
          const key = `${p.kind}:${p.account}`;
          const row = grouped.get(key) ?? { kind: p.kind, account: p.account, credit: 0 };
          row.credit -= p.amount;
          grouped.set(key, row);
        }
        const counts = new Map<(typeof LEDGER_KINDS)[number], number>();
        for (const t of txs) counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1);
        const book = ledgerBook([...grouped.values()], counts);
        expect(book.imbalance).toBe(0);
        for (const b of book.balances) {
          const lines = book.entries
            .flatMap((e) => e.accounts)
            .filter((a) => a.account === b.account)
            .reduce((s, a) => s + a.amount, 0);
          expect(lines).toBe(b.amount);
          const raw = postings
            .filter((p) => p.account === b.account)
            .reduce((s, p) => s - p.amount, 0);
          expect(b.amount).toBe(raw);
        }
        expect(book.entries.reduce((s, e) => s + e.transactions, 0)).toBe(txs.length);
      }),
    );
  });
});
