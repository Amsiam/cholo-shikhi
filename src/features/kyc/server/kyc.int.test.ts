// [LT] KYC and payout accounts (US7.19–US7.21): submit with NID photos, Finance approves or
// rejects with a reason (audit-logged), payout account only after KYC, a change waits for Finance;
// numbers are stored encrypted and masked, and only Finance sees the queue and the photos.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFileObjectStore } from '#src/features/platform/index.ts';
import { getDb } from '#src/server/db.ts';
import { auditLogEntry, kycSubmission, payoutAccount } from '#src/server/schema/index.ts';
import {
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
} from '#src/test/server-fn-harness.ts';
import { value } from '../../catalog/test-fixtures/publish-helper.ts';
import { setKycStoreForTests } from './kyc.server.ts';

let s: ServerFnHarness;
let finance: Caller;
let dir: string;

/** A JPEG-looking photo: the right first bytes and a realistic size. */
const jpeg = (seed: number) => {
  const b = Buffer.alloc(8192, seed);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b.toString('base64');
};
const pdf = () => {
  const b = Buffer.alloc(8192, 1);
  b.set([0x25, 0x50, 0x44, 0x46]);
  return b.toString('base64');
};
const NID = '1990123456789';
const kycInput = (seed = 1) => ({
  legalName: 'Tasnim Rahman',
  nidNumber: NID,
  front: jpeg(seed),
  back: jpeg(seed + 1),
});
type Status = {
  status: string;
  kyc: { status: string; nidMasked: string; reason: string | null } | null;
};
const status = async (c: Caller) => value<Status>(await s.call('getMyKycStatus', c.request, {}));
type QueueItem = {
  kind: 'kyc' | 'account';
  id: string;
  userId: string;
  details: Record<string, string>;
};
const queueItem = async (userId: string, kind: 'kyc' | 'account') =>
  value<QueueItem[]>(await s.call('listKycQueue', finance.request, {})).find(
    (i) => i.userId === userId && i.kind === kind,
  );

beforeAll(async () => {
  s = await createServerFnHarness();
  finance = await s.newFinance();
  dir = mkdtempSync(join(tmpdir(), 'kyc-'));
  setKycStoreForTests(createFileObjectStore(pathToFileURL(`${dir}/`)));
}, 180_000);
afterAll(async () => {
  await s?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('KYC', () => {
  it('AC7.19.1/7.19.2: submits with NID photos; bad input is refused with a reason', async () => {
    const tasnim = await s.newInstructor();
    expect((await status(tasnim)).status).toBe('none');
    expect(
      await s.call('submitMyKyc', tasnim.request, { ...kycInput(), nidNumber: '12345' }),
    ).toMatchObject({ ok: false, error: { fieldErrors: { nidNumber: ['errors.kyc.nid'] } } });
    expect(
      await s.call('submitMyKyc', tasnim.request, { ...kycInput(), back: pdf() }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { back: ['errors.kyc.photo.unsupported'] } },
    });
    value(await s.call('submitMyKyc', tasnim.request, kycInput()));
    expect(await status(tasnim)).toMatchObject({
      status: 'pending',
      kyc: { status: 'submitted', nidMasked: '•••• 789' },
    });
    // Waiting for Finance: no second submission.
    expect(await s.call('submitMyKyc', tasnim.request, kycInput())).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.kyc.alreadySubmitted' },
    });
    // The NID is stored encrypted only.
    const [row] = await getDb()
      .select()
      .from(kycSubmission)
      .where(eq(kycSubmission.userId, tasnim.userId));
    expect(row?.nidNumberSealed).not.toContain(NID);
    expect(row?.nidNumberSealed.startsWith('v1.')).toBe(true);
  });

  it('AC7.21.1–7.21.3: Finance reviews with the photos; rejections need a reason; others are refused', async () => {
    const tasnim = await s.newInstructor();
    value(await s.call('submitMyKyc', tasnim.request, kycInput(5)));
    // Only Finance and Admins open the queue or the photos.
    expect((await s.call('listKycQueue', tasnim.request, {})).ok).toBe(false);
    const item = await queueItem(tasnim.userId, 'kyc');
    expect(item?.details).toEqual({
      legalName: 'Tasnim Rahman',
      nid: '•••• 789',
      party: 'instructor',
    });
    const photo = value<{ dataUrl: string }>(
      await s.call('getKycDocument', finance.request, { submissionId: item?.id, side: 'front' }),
    );
    expect(photo.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(
      (await s.call('getKycDocument', tasnim.request, { submissionId: item?.id, side: 'front' }))
        .ok,
    ).toBe(false);

    expect(
      await s.call('decideKycItem', finance.request, {
        kind: 'kyc',
        id: item?.id,
        decision: 'reject',
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { reason: ['errors.kyc.reasonRequired'] } },
    });
    value(
      await s.call('decideKycItem', finance.request, {
        kind: 'kyc',
        id: item?.id,
        decision: 'reject',
        reason: 'The back photo is blurred.',
      }),
    );
    expect(await status(tasnim)).toMatchObject({
      status: 'rejected',
      kyc: { reason: 'The back photo is blurred.' },
    });
    // Resubmit, then approve: audit-logged.
    value(await s.call('submitMyKyc', tasnim.request, kycInput(7)));
    const again = await queueItem(tasnim.userId, 'kyc');
    value(
      await s.call('decideKycItem', finance.request, {
        kind: 'kyc',
        id: again?.id,
        decision: 'approve',
      }),
    );
    expect((await status(tasnim)).kyc?.status).toBe('verified');
    const audits = await getDb()
      .select()
      .from(auditLogEntry)
      .where(eq(auditLogEntry.subjectId, again?.id as string));
    expect(audits.map((a) => a.action)).toEqual(['kyc.submission.decided']);
    // Deciding twice is refused.
    expect(
      await s.call('decideKycItem', finance.request, {
        kind: 'kyc',
        id: again?.id,
        decision: 'approve',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.kyc.alreadyDecided' } });
  });

  it('AC7.20.1–7.20.3: payout account only after KYC; malformed numbers refused; a change waits', async () => {
    const tasnim = await s.newInstructor();
    const bkash = { rail: 'bkash', accountName: 'Tasnim Rahman', accountNumber: '01712-345678' };
    expect(await s.call('saveMyPayoutAccount', tasnim.request, bkash)).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.kyc.notVerified' },
    });
    value(await s.call('submitMyKyc', tasnim.request, kycInput(9)));
    value(
      await s.call('decideKycItem', finance.request, {
        kind: 'kyc',
        id: (await queueItem(tasnim.userId, 'kyc'))?.id,
        decision: 'approve',
      }),
    );
    expect(
      await s.call('saveMyPayoutAccount', tasnim.request, {
        ...bkash,
        accountNumber: '0121234567',
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { accountNumber: ['errors.kyc.wallet'] } },
    });
    expect(
      await s.call('saveMyPayoutAccount', tasnim.request, {
        rail: 'bank',
        accountName: 'Tasnim Rahman',
        accountNumber: '1234567890',
        bankName: 'Sonali Bank',
        routingNumber: '1234',
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { routingNumber: ['errors.kyc.routing'] } },
    });

    value(await s.call('saveMyPayoutAccount', tasnim.request, bkash));
    expect((await status(tasnim)).status).toBe('reverification_required');
    const account = await queueItem(tasnim.userId, 'account');
    expect(account?.details).toMatchObject({ rail: 'bkash', account: '•••• 678' });
    value(
      await s.call('decideKycItem', finance.request, {
        kind: 'account',
        id: account?.id,
        decision: 'approve',
      }),
    );
    expect((await status(tasnim)).status).toBe('verified');

    // A change holds payouts until Finance re-verifies.
    value(
      await s.call('saveMyPayoutAccount', tasnim.request, {
        rail: 'nagad',
        accountName: 'Tasnim Rahman',
        accountNumber: '01912345678',
      }),
    );
    expect((await status(tasnim)).status).toBe('reverification_required');
    const rows = await getDb()
      .select()
      .from(payoutAccount)
      .where(eq(payoutAccount.userId, tasnim.userId));
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    expect(rows.every((r) => !r.accountSealed.includes('1912345678'))).toBe(true);
  });
});
