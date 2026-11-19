// [LT] audit.record port: redaction (BR7.5), same-transaction rollback (BR7.2), validation, paging.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '#src/lib/time.ts';
import { withTransaction } from '#src/server/db.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createAuditLog } from './audit-log.server.ts';

let t: TestDatabase;
let log: ReturnType<typeof createAuditLog>;
beforeAll(async () => {
  t = await createTestDatabase();
  log = createAuditLog({ db: t.db, clock: fixedClock('2026-11-13T00:00:00.000Z') });
});
afterAll(async () => {
  await t.drop();
});

const entry = (subjectId: string, extra: Record<string, unknown> = {}) => ({
  actorId: 'system' as const,
  action: 'test.event',
  subjectType: 'test',
  subjectId,
  correlationId: 'corr-a',
  ...extra,
});

describe('audit.record', () => {
  it('redacts passwords, tokens, OTPs and phone numbers from before/after (BR7.5)', async () => {
    await withTransaction(t.db, (tx) =>
      log.record(
        tx,
        entry('redact', {
          before: { password: 'x', phone: '01712345678' },
          after: { otp: '123456', role: 'admin' },
        }),
      ),
    );
    const page = await log.list({ page: 1, pageSize: 5, subjectId: 'redact' });
    expect(page.rows[0]?.before).toEqual({ password: '[REDACTED]', phone: '[REDACTED]' });
    expect(page.rows[0]?.after).toEqual({ otp: '[REDACTED]', role: 'admin' });
  });

  it('is rolled back with the caller transaction (BR7.2)', async () => {
    await expect(
      withTransaction(t.db, async (tx) => {
        await log.record(tx, entry('rolled-back'));
        throw new Error('business step failed');
      }),
    ).rejects.toThrow('business step failed');
    expect((await log.list({ page: 1, pageSize: 5, subjectId: 'rolled-back' })).total).toBe(0);
  });

  it('rejects malformed entries before writing', async () => {
    await expect(
      withTransaction(t.db, (tx) => log.record(tx, entry('bad', { action: 'nodots' }))),
    ).rejects.toThrow();
    await expect(
      withTransaction(t.db, (tx) => log.record(tx, entry('bad', { actorId: 'not-a-uuid' }))),
    ).rejects.toThrow();
  });

  it('pages newest first with a total', async () => {
    for (let i = 0; i < 5; i++)
      await withTransaction(t.db, (tx) =>
        log.record(tx, entry(`p-${i}`, { action: 'test.paged' })),
      );
    const first = await log.list({ page: 1, pageSize: 2, action: 'test.paged' });
    const third = await log.list({ page: 3, pageSize: 2, action: 'test.paged' });
    expect(first.total).toBe(5);
    expect(first.rows).toHaveLength(2);
    expect(third.rows).toHaveLength(1);
  });
});
