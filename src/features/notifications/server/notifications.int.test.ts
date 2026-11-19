// [LT] Notifications service: preferences and locked types, suppression, permanent failure,
// inactive recipients and notify() validation.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { U1_SETTINGS } from '#src/features/platform/domain/u1-settings.ts';
import { createOutbox } from '#src/features/platform/server/outbox.server.ts';
import { createSettings } from '#src/features/platform/server/settings.server.ts';
import { createMetrics } from '#src/lib/metrics.ts';
import { fixedClock } from '#src/lib/time.ts';
import { withTransaction } from '#src/server/db.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createRelay } from '#src/worker/relay.ts';
import { U1_NOTIFICATION_TYPES } from '../domain/notification-types.ts';
import { EmailSendError } from './email-sender.server.ts';
import { createNotifications } from './notifications.server.ts';

const [welcome, passwordChanged] = U1_NOTIFICATION_TYPES;
let t: TestDatabase;
const clock = fixedClock('2026-11-13T13:00:00.000Z');
const emailSender = { send: vi.fn(async () => ({ providerMessageId: 'ok' })) };
let notifications: ReturnType<typeof createNotifications>;
let relay: ReturnType<typeof createRelay>;

async function user(status = 'active') {
  const { rows } = await t.pool.query<{ user_id: string }>(
    "INSERT INTO user_account (email_normalised, email_verified, status, locale) VALUES ($1, true, $2, 'en') RETURNING user_id",
    [`lt.${Math.random().toString(36).slice(2)}@example.test`, status],
  );
  return (rows[0] as { user_id: string }).user_id;
}
const actorOf = (userId: string): Actor => ({
  userId,
  roles: ['student'],
  locale: 'en',
  hasStepUp: false,
});
async function send(
  recipientUserId: string,
  typeKey: string,
  channels: Array<'in_app' | 'email'>,
  dedupeKey = `k-${Math.random().toString(36).slice(2, 10)}`,
) {
  await withTransaction(t.db, (tx) =>
    notifications.notify(
      tx,
      {
        recipientUserId,
        templateKey: typeKey,
        dedupeKey,
        params: {},
        channels,
        priority: 'normal',
      },
      'c',
    ),
  );
  await relay.runOnce();
  await notifications.dispatchDue();
}

beforeAll(async () => {
  t = await createTestDatabase();
  const outbox = createOutbox({ clock });
  notifications = createNotifications({
    db: t.db,
    clock,
    outbox,
    settings: createSettings({ db: t.db, clock, definitions: Object.values(U1_SETTINGS) }),
    emailSender,
    types: U1_NOTIFICATION_TYPES,
    metrics: createMetrics(),
    random: () => 0.5,
  });
  notifications.registerInboxConsumer();
  relay = createRelay({
    db: t.db,
    outbox,
    clock,
    workerId: 'lt-notify',
    metrics: createMetrics(),
    onAlert: vi.fn(),
  });
});
afterAll(async () => {
  await t.drop();
});

describe('preferences', () => {
  it('refuses switching off a locked security type (BR12.8)', async () => {
    const id = await user();
    expect(
      await notifications.setPreference(actorOf(id), {
        typeKey: passwordChanged.typeKey,
        channel: 'email',
        isEnabled: false,
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOTIFICATION_LOCKED' } });
    expect(
      await notifications.setPreference(actorOf(id), {
        typeKey: 'notify.unknown',
        channel: 'email',
        isEnabled: false,
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('records a notice with every channel switched off as suppressed, with no deliveries and no bell entry (BR12.19)', async () => {
    const id = await user();
    expect(
      (
        await notifications.setPreference(actorOf(id), {
          typeKey: welcome.typeKey,
          channel: 'in_app',
          isEnabled: false,
        })
      ).ok,
    ).toBe(true);
    await send(id, welcome.typeKey, ['in_app']);
    const { rows } = await t.pool.query(
      'SELECT status, resolved_channels FROM notification WHERE recipient_user_id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ status: 'suppressed', resolved_channels: [] });
    expect((await notifications.list(actorOf(id), { page: 1, pageSize: 5 })).rows).toEqual([]);
  });

  it('locked types still arrive on every channel despite preferences', async () => {
    const id = await user();
    await t.pool.query(
      "INSERT INTO notification_preference (user_id, type_key, channel, is_enabled) VALUES ($1, 'notify.security.passwordChanged', 'email', false)",
      [id],
    );
    await send(id, passwordChanged.typeKey, ['in_app', 'email']);
    const { rows } = await t.pool.query(
      'SELECT resolved_channels FROM notification WHERE recipient_user_id = $1',
      [id],
    );
    expect(rows[0]?.resolved_channels).toEqual(['in_app', 'email']);
  });
});

describe('delivery', () => {
  it('marks a permanent provider refusal as failed at once', async () => {
    const id = await user();
    emailSender.send.mockRejectedValueOnce(new EmailSendError('address_rejected', false));
    await send(id, passwordChanged.typeKey, ['email']);
    const { rows } = await t.pool.query(
      "SELECT d.status FROM notification_delivery d JOIN notification n USING (notification_id) WHERE n.recipient_user_id = $1 AND d.channel = 'email'",
      [id],
    );
    expect(rows[0]?.status).toBe('failed');
  });

  it('delivers only in-app for a recipient who is not active', async () => {
    const id = await user('disabled');
    await send(id, passwordChanged.typeKey, ['in_app', 'email']);
    const { rows } = await t.pool.query(
      'SELECT resolved_channels FROM notification WHERE recipient_user_id = $1',
      [id],
    );
    expect(rows[0]?.resolved_channels).toEqual(['in_app']);
  });

  it('refuses an undeclared type and malformed requests at notify()', async () => {
    const id = await user();
    await expect(
      withTransaction(t.db, (tx) =>
        notifications.notify(
          tx,
          {
            recipientUserId: id,
            templateKey: 'notify.nope',
            dedupeKey: 'abcdefgh',
            params: {},
            channels: ['in_app'],
            priority: 'normal',
          },
          'c',
        ),
      ),
    ).rejects.toThrow(/undeclared/);
    await expect(
      withTransaction(t.db, (tx) =>
        notifications.notify(
          tx,
          {
            recipientUserId: id,
            templateKey: welcome.typeKey,
            dedupeKey: 'short',
            params: {},
            channels: ['in_app'],
            priority: 'normal',
          },
          'c',
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('welcome consumer (AccountCreated -> notification)', () => {
  it('welcomes a new account in-app through the relay, once', async () => {
    const outbox = createOutbox({ clock });
    const local = createNotifications({
      db: t.db,
      clock,
      outbox,
      settings: createSettings({ db: t.db, clock, definitions: Object.values(U1_SETTINGS) }),
      emailSender,
      types: U1_NOTIFICATION_TYPES,
      metrics: createMetrics(),
    });
    local.registerInboxConsumer();
    local.registerWelcomeConsumer();
    await t.pool.query('UPDATE partition_lease SET worker_id = NULL, lease_expires_at = NULL');
    const id = await user();
    const r = createRelay({
      db: t.db,
      outbox,
      clock,
      workerId: 'lt-welcome',
      metrics: createMetrics(),
      onAlert: vi.fn(),
    });
    await r.runOnce();
    await r.runOnce();
    const page = await local.list(actorOf(id), { page: 1, pageSize: 5 });
    expect(page.rows.map((n) => n.typeKey)).toEqual(['notify.account.welcome']);
  });
});
