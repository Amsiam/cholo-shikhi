// The platform's whole ledger by entry type (Admin books): for every kind of ledger transaction, how
// many there are and what they moved on each account, and every account's balance. Plain
// TypeScript. Money is integer poisha, credits shown positive (a posting's amount negated).
//
// Reconciliation: each account's balance is exactly the sum of what every entry type moved on it,
// and the balances of a double-entry ledger add up to zero.

/** Mirrors the ledger schema's kinds (checked by a test), in the order the books list them. */
export const LEDGER_KINDS = [
  'course_sale',
  'course_refund',
  'platform_sale',
  'attribution_reassignment',
  'salary_accrual',
  'pay_policy_adjustment',
  'instructor_payout',
  'referral_accrual',
  'referral_clawback',
  'referral_payout',
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** Mirrors the ledger schema's accounts (checked by a test). */
export const LEDGER_ACCOUNTS = [
  'gateway_clearing',
  'platform_revenue',
  'instructor_payable',
  'unassigned_instructor_pool',
  'salary_expense',
  'referral_expense',
  'referral_payable',
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

export type KindAccountTotal = { kind: LedgerKind; account: LedgerAccount; credit: number };
export type AccountAmount = { account: LedgerAccount; amount: number };

export type LedgerBook = {
  /** One line per entry type present in the ledger, with its non-zero effect on each account. */
  entries: Array<{ kind: LedgerKind; transactions: number; accounts: AccountAmount[] }>;
  /** Every account's balance (credit positive), the sum of the entry lines. */
  balances: AccountAmount[];
  /** The sum of every balance: 0 for a balanced ledger. */
  imbalance: number;
};

const accountOrder = (a: AccountAmount, b: AccountAmount) =>
  LEDGER_ACCOUNTS.indexOf(a.account) - LEDGER_ACCOUNTS.indexOf(b.account);

export function ledgerBook(
  totals: readonly KindAccountTotal[],
  transactions: ReadonlyMap<LedgerKind, number>,
): LedgerBook {
  const kinds = LEDGER_KINDS.filter(
    (k) => (transactions.get(k) ?? 0) > 0 || totals.some((t) => t.kind === k),
  );
  const entries = kinds.map((kind) => ({
    kind,
    transactions: transactions.get(kind) ?? 0,
    accounts: totals
      .filter((t) => t.kind === kind && t.credit !== 0)
      .map((t) => ({ account: t.account, amount: t.credit }))
      .sort(accountOrder),
  }));
  const balance = new Map<LedgerAccount, number>();
  for (const t of totals) balance.set(t.account, (balance.get(t.account) ?? 0) + t.credit);
  const balances = LEDGER_ACCOUNTS.filter((a) => balance.has(a)).map((account) => ({
    account,
    amount: balance.get(account) ?? 0,
  }));
  return {
    entries,
    balances,
    imbalance: balances.reduce((s, b) => s + b.amount, 0),
  };
}

/** True when the book's balances equal the ledger's own account balances, to the poisha. */
export function reconciles(book: LedgerBook, ledgerBalances: readonly AccountAmount[]): boolean {
  const own = new Map(book.balances.map((b) => [b.account, b.amount]));
  const theirs = new Map(ledgerBalances.map((b) => [b.account, b.amount]));
  const accounts = new Set([...own.keys(), ...theirs.keys()]);
  return [...accounts].every((a) => (own.get(a) ?? 0) === (theirs.get(a) ?? 0));
}
