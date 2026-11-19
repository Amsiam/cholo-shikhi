// [LT] Refunds: closed until an Admin sets the window; a Student asks for their own purchase only,
// once; an Admin rejects with a note or approves (full, unused share, partial up to the paid); an
// approval ends access and reverses the sale in the ledger, balanced, never more than was paid.
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import { ledgerPosting, ledgerTransaction } from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';

type Caller = Awaited<ReturnType<ServerFnHarness['newStudent']>>;
let s: ServerFnHarness;
let course: PublishedCourse;

beforeAll(async () => {
  s = await createServerFnHarness();
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
  ] as const)
    value(
      await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'LT bounds' }),
    );
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'commerce.fakeGateway',
      description: 'LT: fake gateway',
      state: 'on',
    }),
  );
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  course = await createPublishHelper(s).published(goalId, { sections: 2, months: 6 });
}, 180_000);
afterAll(async () => {
  await s?.close();
});

async function buy(student: Caller): Promise<{ paymentId: string; amountPoisha: number }> {
  const checkout = value<{ paymentId: string; amountPoisha: number }>(
    await s.call('startCourseCheckout', student.request, { courseId: course.courseId }),
  );
  value(
    await s.call('settleMyFakePayment', student.request, {
      paymentId: checkout.paymentId,
      outcome: 'succeed',
    }),
  );
  return checkout;
}

type Queue = {
  rows: Array<{
    refundId: string;
    status: string;
    paidPoisha: number;
    options: { full: number; unused: number };
  }>;
};

describe('refunds', () => {
  it('stay closed until an Admin sets the refund window', async () => {
    const student = await s.newStudent();
    const { paymentId } = await buy(student);
    expect(
      await s.call('requestMyRefund', student.request, {
        paymentId,
        reason: 'Wrong course bought',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.refund.windowUnset' } });
  });

  it('a Student asks once; an Admin decides; access ends and the ledger reverses', async () => {
    value(
      await s.call('saveSetting', s.admin.request, {
        settingKey: 'commerce.refund.windowDays',
        value: 7,
        reason: 'LT refund window',
      }),
    );
    const student = await s.newStudent();
    const { paymentId, amountPoisha } = await buy(student);

    // Someone else's payment is not found.
    const other = await s.newStudent();
    expect(
      await s.call('requestMyRefund', other.request, { paymentId, reason: 'Not mine at all' }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    const { refundId } = value<{ refundId: string }>(
      await s.call('requestMyRefund', student.request, {
        paymentId,
        reason: 'I bought the wrong level.',
      }),
    );
    expect(
      await s.call('requestMyRefund', student.request, {
        paymentId,
        reason: 'Asking a second time',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.refund.alreadyRequested' } });
    const purchases = value<Array<{ paymentId: string; refund: { request: { status: string } } }>>(
      await s.call('getMyPurchases', student.request, {}),
    );
    expect(purchases.find((p) => p.paymentId === paymentId)?.refund.request.status).toBe('pending');

    // Only Admins decide.
    expect(
      await s.call('decideRefundRequest', s.instructor.request, { refundId, decision: 'approve' }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const queue = value<Queue>(
      await s.call('listRefundRequests', s.admin.request, { status: 'pending' }),
    );
    const row = queue.rows.find((r) => r.refundId === refundId);
    expect(row?.options.full).toBe(amountPoisha);
    expect(row?.options.unused).toBeLessThanOrEqual(amountPoisha);

    expect(
      await s.call('decideRefundRequest', s.admin.request, {
        refundId,
        decision: 'approve',
        policy: 'partial',
        partialPoisha: amountPoisha + 1,
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const half = Math.floor(amountPoisha / 2);
    expect(
      value<{ status: string; refundPoisha: number }>(
        await s.call('decideRefundRequest', s.admin.request, {
          refundId,
          decision: 'approve',
          policy: 'partial',
          partialPoisha: half,
        }),
      ),
    ).toMatchObject({ status: 'approved', refundPoisha: half });
    expect(
      await s.call('decideRefundRequest', s.admin.request, { refundId, decision: 'approve' }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.refund.decided' } });

    // Access has ended.
    expect(
      await s.call('getMyLearningCourse', student.request, { courseId: course.courseId }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    // The ledger: a refund transaction, balanced, reversing exactly the refunded amount.
    const db = getDb();
    const txs = await db
      .select({
        kind: ledgerTransaction.kind,
        amount: ledgerTransaction.amountPoisha,
        id: ledgerTransaction.transactionId,
      })
      .from(ledgerTransaction)
      .where(eq(ledgerTransaction.sourcePaymentId, paymentId));
    expect(txs.map((t) => [t.kind, t.amount]).sort()).toEqual(
      [
        ['course_refund', half],
        ['course_sale', amountPoisha],
      ].sort(),
    );
    for (const t of txs) {
      const [bal] = await db
        .select({ n: sql<string>`coalesce(sum(${ledgerPosting.amountPoisha}), 0)` })
        .from(ledgerPosting)
        .where(eq(ledgerPosting.transactionId, t.id));
      expect(Number(bal?.n)).toBe(0);
    }
  });

  it('a rejection needs a note, and the Student may ask again after one', async () => {
    const student = await s.newStudent();
    const { paymentId } = await buy(student);
    const { refundId } = value<{ refundId: string }>(
      await s.call('requestMyRefund', student.request, {
        paymentId,
        reason: 'Changed my mind today',
      }),
    );
    expect(
      await s.call('decideRefundRequest', s.admin.request, { refundId, decision: 'reject' }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    value(
      await s.call('decideRefundRequest', s.admin.request, {
        refundId,
        decision: 'reject',
        note: 'The course has been fully watched.',
      }),
    );
    value(
      await s.call('requestMyRefund', student.request, {
        paymentId,
        reason: 'Please look again kindly',
      }),
    );
  });
});
