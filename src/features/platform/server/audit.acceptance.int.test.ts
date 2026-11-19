// [AT] US11.2 Keep an append-only audit log (written before the retention job and admin query).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '#src/lib/time.ts';
import { withTransaction } from '#src/server/db.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createAuditLog } from './audit-log.server.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe('US11.2 Keep an append-only audit log', () => {
  it('AC11.2.1 Given a setting change, When it is saved, Then one entry records actor, action, UTC time, before/after and correlation ID', async () => {
    const clock = fixedClock('2026-11-13T04:30:00.000Z');
    const log = createAuditLog({ db: t.db, clock });
    const actorId = '66666666-6666-4666-8666-666666666666';
    await withTransaction(t.db, (tx) =>
      log.record(tx, {
        actorId,
        action: 'platform.setting.changed',
        subjectType: 'setting',
        subjectId: 'subscription.refundWindowDays',
        before: null,
        after: { value: 7, version: 1 },
        correlationId: 'corr-setting-1',
      }),
    );
    const page = await log.list({
      page: 1,
      pageSize: 10,
      subjectId: 'subscription.refundWindowDays',
    });
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({
      actorId,
      action: 'platform.setting.changed',
      occurredAt: '2026-11-13T04:30:00.000Z',
      before: null,
      after: { value: 7, version: 1 },
      correlationId: 'corr-setting-1',
    });
  });

  it('AC11.2.2 Given any caller, When it tries to update or delete an entry, Then the database refuses', async () => {
    await expect(t.pool.query("UPDATE audit_log_entry SET action = 'tampered'")).rejects.toThrow(
      /append-only/,
    );
    await expect(t.pool.query('DELETE FROM audit_log_entry')).rejects.toThrow(/append-only/);
  });

  it('AC11.2.3 Given an entry 9 years and 364 days old, When retention runs, Then it is kept; whole years past 10 are dropped', async () => {
    const now = '2037-11-13T00:00:00.000Z';
    const log = createAuditLog({ db: t.db, clock: fixedClock(now) });
    for (const occurredAt of ['2026-06-01T00:00:00.000Z', '2027-11-14T00:00:00.000Z']) {
      await withTransaction(t.db, (tx) =>
        createAuditLog({ db: t.db, clock: fixedClock(occurredAt) }).record(tx, {
          actorId: 'system',
          action: 'test.aged',
          subjectType: 'test',
          subjectId: occurredAt,
          correlationId: 'c',
        }),
      );
    }
    const result = await log.runRetention({ retentionYears: 10 });
    expect(result.dropped).toEqual(['audit_log_entry_y2026']);
    const { rows } = await t.pool.query<{ subject_id: string }>(
      "SELECT subject_id FROM audit_log_entry WHERE action = 'test.aged'",
    );
    expect(rows.map((r) => r.subject_id)).toEqual(['2027-11-14T00:00:00.000Z']);
  });

  it('BR7.4 retention can never be set below 10 years', async () => {
    const log = createAuditLog({ db: t.db, clock: fixedClock('2040-06-01T00:00:00.000Z') });
    const result = await log.runRetention({ retentionYears: 3 });
    expect(result.retentionYears).toBe(10);
    expect(result.dropped).not.toContain('audit_log_entry_y2031');
  });
});
