// [LT] Step 8: the Goals service with the real U1 ports (audit, outbox, notify) on a per-file schema
// and a fixed clock: refused writes log exactly one IDs-only line and leave no row (NFR6.203,
// NFR9.204, NFR5.203); the "no active Goals" notice goes out at most once per Dhaka day (BR2.3).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { U1_NOTIFICATION_TYPES } from '#src/features/notifications/domain/notification-types.ts';
import { createRecordingEmailSender } from '#src/features/notifications/server/email-sender.server.ts';
import { createNotifications } from '#src/features/notifications/server/notifications.server.ts';
import { U1_SETTINGS } from '#src/features/platform/domain/u1-settings.ts';
import { createAudit } from '#src/features/platform/index.ts';
import { createOutbox } from '#src/features/platform/server/outbox.server.ts';
import { createSettings } from '#src/features/platform/server/settings.server.ts';
import { createLogger } from '#src/lib/logger.ts';
import { createMetrics } from '#src/lib/metrics.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { GOALS_NOTIFICATION_TYPES } from '../domain/goals-notifications.ts';
import { createGoals, type Goals } from './goals.server.ts';

let t: TestDatabase;
let goals: Goals;
const lines: Array<Record<string, unknown>> = [];
const clock = fixedClock('2026-11-16T05:00:00.000Z');
const admins = [randomUUID(), randomUUID()];
const admin = {
  userId: randomUUID(),
  roles: ['student', 'admin'] as const,
  locale: 'en' as const,
  hasStepUp: true,
};
const actor = { ...admin, roles: [...admin.roles] };

beforeAll(async () => {
  t = await createTestDatabase();
  const outbox = createOutbox({ clock });
  const notifications = createNotifications({
    db: t.db,
    clock,
    outbox,
    settings: createSettings({ db: t.db, clock, definitions: Object.values(U1_SETTINGS) }),
    emailSender: createRecordingEmailSender(),
    types: [...U1_NOTIFICATION_TYPES, ...GOALS_NOTIFICATION_TYPES],
    metrics: createMetrics(),
  });
  goals = createGoals({
    db: t.db,
    clock,
    audit: createAudit({ clock }),
    outbox,
    notify: (tx, request, correlationId) => notifications.notify(tx, request, correlationId),
    listAdminUserIds: async () => admins,
    log: createLogger({
      level: 'info',
      destination: { write: (line: string) => void lines.push(JSON.parse(line)) },
    }),
  });
});
afterAll(async () => {
  await t.drop();
});

async function rowCounts() {
  const { rows } = await t.pool.query<{
    goals: number;
    segments: number;
    audit: number;
    outbox: number;
  }>(
    `SELECT (SELECT count(*)::int FROM goal) AS goals, (SELECT count(*)::int FROM goal_segment) AS segments,
            (SELECT count(*)::int FROM audit_log_entry) AS audit, (SELECT count(*)::int FROM outbox_event) AS outbox`,
  );
  return rows[0];
}

async function noticeRows() {
  const { rows } = await t.pool.query<{ aggregate_key: string; payload: Record<string, unknown> }>(
    `SELECT aggregate_key, payload FROM outbox_event WHERE event_type = 'notifications.NotificationRequested'`,
  );
  return rows;
}

describe('BR2.3 no active Goals', () => {
  it('lists no groups and notifies every Admin once per Dhaka day, IDs only', async () => {
    expect(await goals.listActiveGoals('c-1')).toEqual({ ok: true, value: { segments: [] } });
    await goals.listActiveGoals('c-2');
    let rows = await noticeRows();
    expect(rows.map((r) => r.aggregate_key).sort()).toEqual([...admins].sort());
    expect(rows[0]?.payload).toMatchObject({
      templateKey: 'notify.goals.noActiveGoals',
      dedupeKey: 'goals.noActiveGoals:2026-11-16',
      params: {},
    });
    // The next Dhaka day (UTC 18:00 is midnight in Dhaka) sends one more per Admin.
    clock.set('2026-11-16T18:00:00.000Z');
    await goals.listActiveGoals('c-3');
    rows = await noticeRows();
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.payload.dedupeKey))).toEqual(
      new Set(['goals.noActiveGoals:2026-11-16', 'goals.noActiveGoals:2026-11-17']),
    );
  });

  it('sends nothing once a Goal is active', async () => {
    const segment = await goals.saveSegment(actor, buildSegmentInput(), 'c-4');
    if (!segment.ok) throw new Error('seed failed');
    await goals.saveGoal(
      actor,
      buildGoalInput(segment.value.segmentId, { status: 'active' }),
      'c-5',
    );
    const before = (await noticeRows()).length;
    clock.set('2026-11-18T06:00:00.000Z');
    const listed = await goals.listActiveGoals('c-6');
    expect(listed.ok && listed.value.segments).toHaveLength(1);
    expect(await noticeRows()).toHaveLength(before);
  });
});

describe('refused writes (NFR6.203)', () => {
  it('writes no business row, audit entry or outbox event, and logs exactly one IDs-only line', async () => {
    const segment = await goals.saveSegment(actor, buildSegmentInput(), 'c-7');
    if (!segment.ok) throw new Error('seed failed');
    await goals.saveGoal(actor, buildGoalInput(segment.value.segmentId), 'c-8');
    const before = await rowCounts();
    lines.length = 0;
    const refused = await goals.deleteSegment(
      actor,
      { segmentId: segment.value.segmentId, expectedVersion: 1 },
      'c-9',
    );
    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: 'CONFLICT',
        i18nKey: 'errors.goals.segmentHasGoals',
        details: { linkedGoalCount: 1 },
      },
    });
    expect(await rowCounts()).toEqual(before);
    const refusals = lines.filter((l) => l.msg === 'goals write refused');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      code: 'CONFLICT',
      reason: 'errors.goals.segmentHasGoals',
      actorId: actor.userId,
      action: 'goals.segment.delete',
    });
    // No names or other free text in the log line.
    const serialised = JSON.stringify(refusals[0]);
    const seg = await t.pool.query<{ name_en: string; name_bn: string }>(
      'SELECT name_en, name_bn FROM goal_segment WHERE segment_id = $1',
      [segment.value.segmentId],
    );
    expect(serialised).not.toContain(seg.rows[0]?.name_en);
    expect(serialised).not.toContain(seg.rows[0]?.name_bn);
  });

  it('rolls back a validation refusal of a Goal save and logs it once', async () => {
    const before = await rowCounts();
    lines.length = 0;
    const refused = await goals.saveGoal(
      actor,
      { ...buildGoalInput(randomUUID()), nameEn: '' },
      'c-10',
    );
    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: {
          nameEn: ['errors.goals.nameRequired'],
          segmentId: ['errors.goals.segmentNotFound'],
        },
      },
    });
    expect(await rowCounts()).toEqual(before);
    expect(lines.filter((l) => l.msg === 'goals write refused')).toHaveLength(1);
  });
});

describe('contract 5 reads', () => {
  it('answers NOT_FOUND for an unknown or malformed ID instead of failing', async () => {
    expect(await goals.getSegment(randomUUID())).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await goals.getSegment('not-a-uuid')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await goals.getCurrentGoal('not-a-uuid')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await goals.listGoalsInSegments(['not-a-uuid'])).toEqual([]);
  });
});
