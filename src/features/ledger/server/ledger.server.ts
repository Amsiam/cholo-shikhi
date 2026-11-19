// The ledger service. recordCourseSale posts one sale inside the caller's transaction (Commerce's
// settlement), so a sale and its enrolment commit together or not at all. The split comes from the
// course's section ownership at the moment of sale (catalog contract 5, BR6.7) and the one rounding
// rule in ../domain/revenue-split.ts. Posting is idempotent per payment.
import { getOwnershipSnapshot } from '#src/features/catalog/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createLedgerRepository } from '../data/ledger.repository.ts';
import {
  type AccountAmount,
  type LedgerAccount,
  type LedgerBook,
  type LedgerKind,
  ledgerBook,
  reconciles,
} from '../domain/books.ts';
import { type ReferralKind, referralPostings } from '../domain/referral-postings.ts';
import { refundPostings } from '../domain/refund-split.ts';
import { DEFAULT_INSTRUCTOR_SHARE_BPS, salePostings, splitSale } from '../domain/revenue-split.ts';
import { buildStatement, dhakaMonthRange, type Statement } from '../domain/statement.ts';

const repo = createLedgerRepository();

export type CourseSale = {
  paymentId: string;
  courseId: string;
  amountPoisha: number;
  occurredAt: Date;
};

/** Posts a course sale. Returns false when this payment was already posted. */
export async function recordCourseSale(
  tx: TxHandle,
  sale: CourseSale,
): Promise<Result<boolean, AppError<'VALIDATION_FAILED' | 'NOT_FOUND'>>> {
  const exec = unwrapTx(tx);
  if (await repo.hasSale(exec, sale.paymentId)) return ok(false);
  const snapshot = await getOwnershipSnapshot(sale.courseId, sale.occurredAt.toISOString());
  if (!snapshot.ok) return snapshot;
  const split = splitSale(sale.amountPoisha, snapshot.value.sections, DEFAULT_INSTRUCTOR_SHARE_BPS);
  if (!split.ok) return split;
  const inserted = await repo.insertSale(
    exec,
    {
      paymentId: sale.paymentId,
      courseId: sale.courseId,
      amount: sale.amountPoisha,
      shareBps: split.value.shareBps,
      occurredAt: sale.occurredAt,
    },
    salePostings(split.value),
  );
  return ok(inserted);
}

export type CourseRefund = {
  paymentId: string;
  amountPoisha: number;
  occurredAt: Date;
};

/**
 * Posts a refund inside the caller's transaction: the sale's lines given back in proportion
 * (../domain/refund-split.ts). Returns false when this payment was already refunded.
 */
export async function recordCourseRefund(
  tx: TxHandle,
  refund: CourseRefund,
): Promise<Result<boolean, AppError<'VALIDATION_FAILED' | 'NOT_FOUND'>>> {
  const exec = unwrapTx(tx);
  const found = await repo.saleOf(exec, refund.paymentId);
  if (!found) return err(appError('NOT_FOUND'));
  const postings = refundPostings(found.postings, refund.amountPoisha);
  if (!postings.ok) return postings;
  return ok(
    await repo.insertRefund(
      exec,
      {
        paymentId: refund.paymentId,
        // A refund only ever reverses a course sale, which always has a course.
        courseId: found.sale.courseId as string,
        amount: refund.amountPoisha,
        shareBps: found.sale.instructorShareBps,
        occurredAt: refund.occurredAt,
      },
      postings.value,
    ),
  );
}

/**
 * Posts a sale with no course (an exam package or a subscription) inside the caller's transaction:
 * all platform revenue for now. Returns false when this payment was already posted.
 */
export async function recordPlatformSale(
  tx: TxHandle,
  sale: { paymentId: string; amountPoisha: number; occurredAt: Date },
): Promise<Result<boolean, AppError<'VALIDATION_FAILED'>>> {
  if (!Number.isSafeInteger(sale.amountPoisha) || sale.amountPoisha < 1)
    return err(appError('VALIDATION_FAILED'));
  return ok(
    await repo.insertPlatformSale(unwrapTx(tx), {
      paymentId: sale.paymentId,
      amount: sale.amountPoisha,
      occurredAt: sale.occurredAt,
    }),
  );
}

/** Posts every sale not yet in the ledger (sales made before the ledger existed). */
export async function backfillCourseSales(
  sales: readonly CourseSale[],
): Promise<{ posted: number; skipped: number; failed: number }> {
  let posted = 0;
  let skipped = 0;
  let failed = 0;
  for (const sale of sales) {
    // A refusal happens before anything is written, so the empty transaction just commits.
    const result = await withTransaction(getDb(), (tx) => recordCourseSale(tx, sale));
    if (!result.ok) failed += 1;
    else if (result.value) posted += 1;
    else skipped += 1;
  }
  return { posted, skipped, failed };
}

const monthsAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d;
};

/**
 * One instructor's earnings: per course (sales, refunds and attribution reassignments of that
 * course), their salary and pay-policy adjustments (no course) each on its own total, and the last
 * 12 months. total = courseEarnings + salary + policyAdjustment: everything credited to their
 * payable except payouts, to the poisha.
 */
export async function instructorEarnings(instructorId: string) {
  const db = getDb();
  const [byCourse, byMonth, other, reassigned] = await Promise.all([
    repo.instructorByCourse(db, instructorId),
    repo.instructorByMonth(db, instructorId, monthsAgo(11)),
    repo.instructorNonCourseTotals(db, instructorId),
    repo.instructorReassigned(db, instructorId),
  ]);
  const courseEarnings = byCourse.reduce((s, c) => s + c.earned, 0);
  return {
    total: courseEarnings + other.salary + other.policyAdjustment,
    courseEarnings,
    /** Already inside courseEarnings (per course); shown on its own line. */
    reassigned,
    salary: other.salary,
    policyAdjustment: other.policyAdjustment,
    sales: byCourse.reduce((s, c) => s + c.sales, 0),
    byCourse,
    byMonth,
  };
}

/** A course's money: account totals and sales over the last 12 months. */
export async function courseFinance(courseId: string) {
  const db = getDb();
  const [totals, byMonth] = await Promise.all([
    repo.accountTotals(db, [courseId]),
    repo.courseByMonth(db, courseId, monthsAgo(11)),
  ]);
  return { totals, byMonth };
}

export type PlatformLedger = LedgerBook & {
  /** Each account's balance read straight from the postings. */
  ledgerBalances: AccountAmount[];
  /** The entry lines add up to the ledger's own balances, to the poisha. */
  isReconciled: boolean;
};

/**
 * The platform's books: sales totals, per course, per instructor, by month, the whole ledger by
 * entry type (every kind its own line, reconciled to the account balances) and the journal of every
 * entry.
 */
export async function platformFinance(journalPage: number, pageSize: number) {
  const db = getDb();
  const [totals, byMonth, byCourse, byInstructor, journal, byKind, balances, sales] =
    await Promise.all([
      repo.accountTotals(db),
      repo.platformByMonth(db, monthsAgo(11)),
      repo.byCourse(db),
      repo.byInstructor(db),
      repo.recentSales(db, journalPage, pageSize),
      repo.totalsByKind(db),
      repo.accountBalances(db),
      repo.salesCount(db),
    ]);
  const book = ledgerBook(
    byKind.totals.map((t) => ({
      kind: t.kind as LedgerKind,
      account: t.account as LedgerAccount,
      credit: t.credit,
    })),
    byKind.transactions as Map<LedgerKind, number>,
  );
  const ledgerBalances = balances.map((b) => ({
    account: b.account as LedgerAccount,
    amount: b.amount,
  }));
  const ledger: PlatformLedger = {
    ...book,
    ledgerBalances,
    isReconciled: book.imbalance === 0 && reconciles(book, ledgerBalances),
  };
  return { totals, byMonth, byCourse, byInstructor, journal, ledger, sales };
}

/** The Dhaka months in which an instructor earned or lost money, newest first (US7.8). */
export function instructorStatementMonths(instructorId: string): Promise<string[]> {
  return repo.instructorMonths(getDb(), instructorId);
}

/** An instructor's monthly statement, straight from the immutable ledger; null for a bad month. */
export async function instructorStatement(
  instructorId: string,
  month: string,
): Promise<Statement | null> {
  const range = dhakaMonthRange(month);
  if (!range) return null;
  const db = getDb();
  const [opening, lines] = await Promise.all([
    repo.instructorBalanceBefore(db, instructorId, range.from),
    repo.instructorLines(db, instructorId, range.from, range.to),
  ]);
  return buildStatement(opening, lines);
}

/** Payout cycles (US7.2): what each instructor became owed in a cycle (see the repository). */
export function payableForCycle(
  cutoff: Date,
  previous: { cutoff: Date; committedAt: Date } | null,
) {
  return repo.payableForCycle(getDb(), cutoff, previous);
}

/** An instructor's ledger lines in a committed payout cycle: exactly what it counted for them. */
export function instructorCycleLines(
  instructorId: string,
  cycle: { cutoff: Date; committedAt: Date },
  previous: { cutoff: Date; committedAt: Date } | null,
) {
  return repo.instructorCycleLines(
    getDb(),
    instructorId,
    cycle.cutoff,
    previous,
    cycle.committedAt,
  );
}

/**
 * Posts a payout to an instructor inside the caller's transaction: the payable is debited and the
 * cash credited, once per payout-cycle line (a repeat does nothing). Amount in poisha, above 0.
 */
export async function recordInstructorPayout(
  tx: TxHandle,
  payout: { lineId: string; instructorId: string; amount: number; occurredAt: Date },
): Promise<Result<boolean, AppError<'VALIDATION_FAILED'>>> {
  if (!Number.isSafeInteger(payout.amount) || payout.amount <= 0)
    return err(appError('VALIDATION_FAILED'));
  return ok(await repo.insertPayout(unwrapTx(tx), payout));
}

/** US7.13: per payment of a course, its net unassigned pool and the sale's instant. */
export function unassignedSalesOf(tx: TxHandle, courseId: string) {
  return repo.unassignedSales(unwrapTx(tx), courseId);
}

/**
 * US7.13: posts a resolved attribution case's money inside the caller's transaction: the
 * unassigned pool is debited and the confirmed owner's payable credited (picked up by the next
 * payout cycle). Once per case (a repeat does nothing). Amount in poisha, above 0.
 */
export async function recordAttributionReassignment(
  tx: TxHandle,
  entry: {
    caseId: string;
    courseId: string;
    instructorId: string;
    amount: number;
    occurredAt: Date;
  },
): Promise<Result<boolean, AppError<'VALIDATION_FAILED'>>> {
  if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0)
    return err(appError('VALIDATION_FAILED'));
  return ok(await repo.insertReassignment(unwrapTx(tx), entry));
}

/**
 * US7.16: posts a committed salary line inside the caller's transaction: salary_expense debited and
 * the instructor's payable credited (paid out by the same line). Once per line. Amount above 0.
 */
export async function recordSalaryAccrual(
  tx: TxHandle,
  entry: { lineId: string; instructorId: string; amount: number; occurredAt: Date },
): Promise<Result<boolean, AppError<'VALIDATION_FAILED'>>> {
  if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0)
    return err(appError('VALIDATION_FAILED'));
  return ok(await repo.insertSalaryAccrual(unwrapTx(tx), entry));
}

/**
 * US7.27: posts a hybrid or salary policy's adjustment for a payout-cycle line inside the caller's
 * transaction, between the instructor's payable and platform revenue. Once per line. Non-zero.
 */
export async function recordPolicyAdjustment(
  tx: TxHandle,
  entry: { lineId: string; instructorId: string; amount: number; occurredAt: Date },
): Promise<Result<boolean, AppError<'VALIDATION_FAILED'>>> {
  if (!Number.isSafeInteger(entry.amount) || entry.amount === 0)
    return err(appError('VALIDATION_FAILED'));
  return ok(await repo.insertPolicyAdjustment(unwrapTx(tx), entry));
}

/** US7.27: an instructor's sales and refunds counted by a payout cycle (see the repository). */
export function instructorSalesInCycle(
  instructorId: string,
  cutoff: Date,
  previous: { cutoff: Date; committedAt: Date } | null,
  tx?: TxHandle,
) {
  return repo.instructorSalesInCycle(tx ? unwrapTx(tx) : getDb(), instructorId, cutoff, previous);
}

/**
 * Posts referral money (US8.7/US8.8) inside the caller's transaction: an accrual or a clawback on a
 * referred payment, or a payout on a withdrawal. Once per source and kind (a repeat returns false).
 * Never touches platform revenue or an instructor's payable.
 */
export async function recordReferral(
  tx: TxHandle,
  entry: {
    kind: ReferralKind;
    sourceId: string;
    referrerId: string;
    amountPoisha: number;
    occurredAt: Date;
  },
): Promise<Result<boolean, AppError<'VALIDATION_FAILED'>>> {
  const postings = referralPostings(entry.kind, entry.referrerId, entry.amountPoisha);
  if (!postings.ok) return postings;
  return ok(
    await repo.insertReferral(
      unwrapTx(tx),
      {
        kind: entry.kind,
        sourceId: entry.sourceId,
        amount: entry.amountPoisha,
        occurredAt: entry.occurredAt,
      },
      postings.value,
    ),
  );
}

/** The referral accrual on a payment (referrer and amount), or null; inside a transaction. */
export function referralAccrualOf(tx: TxHandle, paymentId: string) {
  return repo.referralAccrualOf(unwrapTx(tx), paymentId);
}

/** A referrer's balance in poisha; negative after a clawback of money already withdrawn. */
export function referralBalance(referrerId: string, tx?: TxHandle): Promise<number> {
  return repo.referralBalance(tx ? unwrapTx(tx) : getDb(), referrerId);
}

/** A referrer's latest referral lines (newest first). */
export function referralLines(referrerId: string, limit = 50) {
  return repo.referralLines(getDb(), referrerId, limit);
}
