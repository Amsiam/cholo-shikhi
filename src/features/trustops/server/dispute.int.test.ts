// [LT] US9.3, US9.4: Finance records a dispute against a paid course; a locked, timestamped
// evidence pack exists with the payment, enrolment, access log and summary (with "no activity" for
// an untouched purchase); the database refuses edits; the pack exports as CSV through the shared
// renderer (PDF answers unavailable until the PDF engine is installed); Students, Instructors,
// unpaid payments and second disputes are refused.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFileObjectStore } from '#src/features/platform/index.ts';
import { getDb } from '#src/server/db.ts';
import { auditLogEntry, disputeEvidencePack } from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';
import { setDisputeClockForTests, setDisputeStoreForTests } from './dispute.server.ts';

let s: ServerFnHarness;
let course: PublishedCourse;
let dir: string;
type Caller = Awaited<ReturnType<ServerFnHarness['newStudent']>>;
const FIXED = new Date('2027-02-05T06:00:00.000Z');

beforeAll(async () => {
  s = await createServerFnHarness();
  dir = mkdtempSync(join(tmpdir(), 'disputes-'));
  setDisputeStoreForTests(createFileObjectStore(pathToFileURL(`${dir}/`)));
  setDisputeClockForTests(() => FIXED);
  const p = createPublishHelper(s);
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
  course = await p.published(goalId, { sections: 1 });
}, 180_000);
afterAll(async () => {
  await s?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function paid(
  outcome: 'succeed' | 'fail' = 'succeed',
): Promise<{ st: Caller; paymentId: string }> {
  const st = await s.newStudent();
  const c = value<{ paymentId: string }>(
    await s.call('startCourseCheckout', st.request, { courseId: course.courseId }),
  );
  value(await s.call('settleMyFakePayment', st.request, { paymentId: c.paymentId, outcome }));
  return { st, paymentId: c.paymentId };
}

type Pack = {
  lockedAt: string;
  pack: {
    payment: { paymentId: string };
    enrolment: { enrolmentId: string } | null;
    accessLog: Array<{ lessonId: string }>;
    quizScores: unknown[];
    summary: { hasActivity: boolean; lessonsCompleted: number };
  };
};

describe('payment disputes', () => {
  it('records a dispute and locks a timestamped evidence pack with the student activity', async () => {
    const finance = await s.newFinance();
    const { st, paymentId } = await paid();
    const lessonId = course.lessonIds[0] as string;
    value(await s.call('completeMyLesson', st.request, { courseId: course.courseId, lessonId }));
    const { disputeId, lockedAt } = value<{ disputeId: string; lockedAt: string }>(
      await s.call('recordPaymentDispute', finance.request, {
        paymentId,
        gatewayCaseRef: 'CB-2027-0001',
        reason: 'Card holder says the purchase was not made by them.',
      }),
    );
    expect(lockedAt).toBe(FIXED.toISOString());
    const view = value<Pack>(
      await s.call('getDisputeEvidencePack', finance.request, { disputeId }),
    );
    expect(view.lockedAt).toBe(FIXED.toISOString());
    expect(view.pack.payment.paymentId).toBe(paymentId);
    expect(view.pack.enrolment?.enrolmentId).toBeTruthy();
    expect(view.pack.accessLog.map((a) => a.lessonId)).toEqual([lessonId]);
    expect(view.pack.summary).toMatchObject({ hasActivity: true, lessonsCompleted: 1 });

    // AC9.3.2: a locked pack cannot be edited, even directly in the database.
    await expect(
      getDb()
        .update(disputeEvidencePack)
        .set({ sha256: 'a'.repeat(64) })
        .where(eq(disputeEvidencePack.disputeId, disputeId)),
    ).rejects.toThrow();

    // A second dispute on the same payment is refused.
    expect(
      await s.call('recordPaymentDispute', s.admin.request, {
        paymentId,
        gatewayCaseRef: 'CB-2027-0002',
        reason: 'Second chargeback on the same payment.',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.dispute.duplicate' } });

    // US9.4: exported through the shared renderer, starting with the lock timestamp.
    const csv = value<{ content: string }>(
      await s.call('exportDisputeEvidencePack', finance.request, {
        disputeId,
        format: 'csv',
        locale: 'en',
      }),
    );
    expect(csv.content).toContain(FIXED.toISOString());
    expect(csv.content).toContain(paymentId);
    expect(
      await s.call('exportDisputeEvidencePack', finance.request, {
        disputeId,
        format: 'pdf',
        locale: 'en',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.dispute.pdfUnavailable' } });

    const audits = await getDb()
      .select()
      .from(auditLogEntry)
      .where(eq(auditLogEntry.subjectId, disputeId));
    expect(audits.map((a) => a.action)).toContain('trustops.dispute.recorded');
  });

  it('AC9.3.3: a payment with no activity still gets a pack saying so', async () => {
    const { paymentId } = await paid();
    const { disputeId } = value<{ disputeId: string }>(
      await s.call('recordPaymentDispute', s.admin.request, {
        paymentId,
        gatewayCaseRef: 'CB-2027-0003',
        reason: 'Customer claims the course was never used.',
      }),
    );
    const view = value<Pack>(
      await s.call('getDisputeEvidencePack', s.admin.request, { disputeId }),
    );
    expect(view.pack.summary).toMatchObject({ hasActivity: false, lessonsCompleted: 0 });
    expect(view.pack.quizScores).toEqual([]);
  });

  it('refuses a failed payment, and Students and Instructors (AC9.4.2)', async () => {
    const { st, paymentId } = await paid('fail');
    expect(
      await s.call('recordPaymentDispute', s.admin.request, {
        paymentId,
        gatewayCaseRef: 'CB-2027-0004',
        reason: 'A dispute on a payment that never succeeded.',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.dispute.notPaid' } });
    expect((await s.call('listPaymentDisputes', st.request, {})).ok).toBe(false);
    expect((await s.call('listPaymentDisputes', s.instructor.request, {})).ok).toBe(false);
    expect(
      (
        await s.call('exportDisputeEvidencePack', st.request, {
          disputeId: paymentId,
          format: 'pdf',
          locale: 'en',
        })
      ).ok,
    ).toBe(false);
  });
});
