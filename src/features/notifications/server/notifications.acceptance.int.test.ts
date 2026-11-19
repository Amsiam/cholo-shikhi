// [AT] US10.1–US10.4 and US11.6 (written before the Notifications module exists). Each test runs the
// real path: notify() in the producer's transaction -> outbox -> relay -> inbox consumer -> deliveries.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { U1_SETTINGS } from '#src/features/platform/domain/u1-settings.ts';
import { createOutbox } from '#src/features/platform/server/outbox.server.ts';
import { createSettings } from '#src/features/platform/server/settings.server.ts';
import { createMetrics } from '#src/lib/metrics.ts';
import { fixedClock } from '#src/lib/time.ts';
import { withTransaction } from '#src/server/db.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createRelay } from '#src/worker/relay.ts';
import { defineNotificationType } from '../domain/notification-types.ts';
import { createRecordingEmailSender } from './email-sender.server.ts';
import { createNotifications } from './notifications.server.ts';

const payoutSent = defineNotificationType({
  typeKey: 'notify.payouts.payoutSent',
  category: 'payment',
  defaultChannels: ['in_app', 'email', 'sms'],
  titleKey: 'notify.payouts.payoutSent.title',
  bodyKey: 'notify.payouts.payoutSent.body',
});
const courseReminder = defineNotificationType({
  typeKey: 'notify.learning.reminder',
  category: 'learning',
  defaultChannels: ['in_app', 'push', 'email'],
  titleKey: 'notify.learning.reminder.title',
  bodyKey: 'notify.learning.reminder.body',
});

let t: TestDatabase;
const clock = fixedClock('2026-11-13T12:00:00.000Z');
const mailbox = createRecordingEmailSender();
const pushSender = {
  sent: [] as Array<{ endpoint: string; payload: string }>,
  send: vi.fn(async (endpoint: string, payload: string) => {
    pushSender.sent.push({ endpoint, payload });
  }),
};
const smsSender = { send: vi.fn(async () => ({ providerMessageId: 'sms-1' })) };
let settings: ReturnType<typeof createSettings>;
let notifications: ReturnType<typeof createNotifications>;
let relay: ReturnType<typeof createRelay>;
let admin: Actor;

async function user(locale: 'bn' | 'en') {
  const { rows } = await t.pool.query<{ user_id: string }>(
    "INSERT INTO user_account (email_normalised, email_verified, status, locale) VALUES ($1, true, 'active', $2) RETURNING user_id",
    [`n.${Math.random().toString(36).slice(2)}@example.test`, locale],
  );
  return (rows[0] as { user_id: string }).user_id;
}
const actorOf = (userId: string, locale: 'bn' | 'en' = 'en'): Actor => ({
  userId,
  roles: ['student'],
  locale,
  hasStepUp: false,
});

async function send(
  recipientUserId: string,
  type = courseReminder,
  dedupeKey = `d-${Math.random().toString(36).slice(2, 10)}`,
  channels = type.defaultChannels,
) {
  await withTransaction(t.db, (tx) =>
    notifications.notify(
      tx,
      {
        recipientUserId,
        templateKey: type.typeKey,
        dedupeKey,
        params: { courseId: 'c-1' },
        channels: [...channels],
        priority: 'normal',
      },
      'corr-n',
    ),
  );
  await relay.runOnce();
  await notifications.dispatchDue();
}

async function deliveries(recipientUserId: string) {
  const { rows } = await t.pool.query<{
    channel: string;
    status: string;
    skip_reason: string | null;
  }>(
    `SELECT d.channel, d.status, d.skip_reason FROM notification_delivery d JOIN notification n USING (notification_id)
     WHERE n.recipient_user_id = $1 ORDER BY d.channel`,
    [recipientUserId],
  );
  return rows;
}

beforeAll(async () => {
  t = await createTestDatabase();
  admin = { ...actorOf(await user('en')), roles: ['student', 'admin'], hasStepUp: true };
  settings = createSettings({ db: t.db, clock, definitions: Object.values(U1_SETTINGS) });
  const outbox = createOutbox({ clock });
  notifications = createNotifications({
    db: t.db,
    clock,
    outbox,
    settings,
    emailSender: mailbox,
    pushSender,
    smsSender,
    types: [payoutSent, courseReminder],
    metrics: createMetrics(),
    random: () => 0.5,
  });
  notifications.registerInboxConsumer();
  relay = createRelay({
    db: t.db,
    outbox,
    clock,
    workerId: 'notify-test',
    metrics: createMetrics(),
    onAlert: vi.fn(),
  });
});
afterAll(async () => {
  await t.drop();
});
afterEach(() => {
  mailbox.failNext(0);
});

describe('US11.6 Send notifications through one outbox', () => {
  it('AC11.6.1 Given an event for a Bangla user, When notify is called, Then in-app and email are created in Bangla (push generic, off at launch)', async () => {
    const id = await user('bn');
    await send(id);
    expect(await deliveries(id)).toEqual([
      { channel: 'email', status: 'delivered', skip_reason: null },
      { channel: 'in_app', status: 'delivered', skip_reason: null },
    ]);
    const email = mailbox.sent.find((m) => m.kind === 'notification' && m.locale === 'bn');
    expect(email?.subject).toMatch(/[ঀ-৿]/);
  });

  it('AC11.6.2 Given the same event and dedupe key twice, Then exactly one notification is delivered per channel', async () => {
    const id = await user('en');
    await send(id, courseReminder, 'same-dedupe-key');
    await send(id, courseReminder, 'same-dedupe-key');
    expect(await deliveries(id)).toHaveLength(2);
  });

  it('AC11.6.3 / AC10.3.2 Given the email provider fails, Then it is retried with backoff and the in-app copy is unaffected', async () => {
    const id = await user('en');
    mailbox.failNext(2);
    await send(id);
    expect(await deliveries(id)).toEqual([
      { channel: 'email', status: 'retry_wait', skip_reason: null },
      { channel: 'in_app', status: 'delivered', skip_reason: null },
    ]);
    for (let i = 0; i < 2; i++) {
      clock.advanceMs(60_000);
      await notifications.dispatchDue();
    }
    expect((await deliveries(id))[0]?.status).toBe('delivered');
    const attempts = await t.pool.query(
      'SELECT a.status FROM delivery_attempt a JOIN notification_delivery d USING (notification_delivery_id) JOIN notification n USING (notification_id) WHERE n.recipient_user_id = $1 ORDER BY attempt_number',
      [id],
    );
    expect(attempts.rows.map((r) => r.status)).toEqual([
      'failed_retryable',
      'failed_retryable',
      'succeeded',
    ]);
  });
});

describe('US10.1 See my notifications in the app', () => {
  it('AC10.1.1 Given two unread notifications, When I open the bell, Then both are listed newest first in my language and the unread count drops to 0', async () => {
    const id = await user('bn');
    await send(id);
    clock.advanceMs(1000);
    await send(id);
    expect(await notifications.unreadCount(actorOf(id, 'bn'))).toBe(2);
    const page = await notifications.list(actorOf(id, 'bn'), { page: 1, pageSize: 10 });
    expect(page.rows).toHaveLength(2);
    expect(new Date(page.rows[0]?.createdAt ?? 0).getTime()).toBeGreaterThan(
      new Date(page.rows[1]?.createdAt ?? 0).getTime(),
    );
    expect(page.rows[0]?.title).toMatch(/[ঀ-৿]/);
    await notifications.markAllRead(actorOf(id, 'bn'));
    expect(await notifications.unreadCount(actorOf(id, 'bn'))).toBe(0);
  });

  it("AC10.1.2 Given another user's notification ID, When I request it, Then access is refused", async () => {
    const owner = await user('en');
    const other = await user('en');
    await send(owner);
    const mine = await notifications.list(actorOf(owner), { page: 1, pageSize: 1 });
    const id = mine.rows[0]?.notificationId as string;
    expect(await notifications.get(actorOf(other), id)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect((await notifications.get(actorOf(owner), id)).ok).toBe(true);
  });

  it('AC10.1.3 Given no notifications, When I open the bell, Then the list is empty', async () => {
    expect(
      (await notifications.list(actorOf(await user('en')), { page: 1, pageSize: 10 })).rows,
    ).toEqual([]);
  });
});

describe('US10.2 Push notifications (switched off at launch)', () => {
  it('AC10.2.1 Given push is on and I allowed it, When a notification is sent, Then the push payload holds only generic text in my language', async () => {
    await settings.save(
      admin,
      { settingKey: 'notifications.pushEnabled', value: true, reason: 'test push on' },
      'corr-push',
    );
    const id = await user('bn');
    await t.pool.query(
      "INSERT INTO push_subscription (user_id, endpoint, keys_ciphertext) VALUES ($1, 'https://push.invalid/bn', 'x')",
      [id],
    );
    await send(id);
    const payload =
      pushSender.sent.find((p) => p.endpoint === 'https://push.invalid/bn')?.payload ?? '';
    expect(JSON.parse(payload)).toEqual({ title: 'আপনার একটি নতুন বিজ্ঞপ্তি আছে' });
  });

  it('AC10.2.2/AC10.2.3 Given no active subscription (denied or signed out), Then push is skipped and in-app still arrives', async () => {
    const id = await user('en');
    await t.pool.query(
      "INSERT INTO push_subscription (user_id, endpoint, keys_ciphertext, revoked_at, revoke_reason) VALUES ($1, 'https://push.invalid/old', 'x', now(), 'sign_out')",
      [id],
    );
    await send(id);
    const rows = await deliveries(id);
    expect(rows.find((r) => r.channel === 'push')).toEqual({
      channel: 'push',
      status: 'skipped',
      skip_reason: 'no_active_push_subscription',
    });
    expect(rows.find((r) => r.channel === 'in_app')?.status).toBe('delivered');
    expect(pushSender.sent.some((p) => p.endpoint === 'https://push.invalid/old')).toBe(false);
    const current = await settings.get(U1_SETTINGS.pushEnabled);
    expect(current.ok && current.value.value).toBe(true);
  });
});

describe('US10.3 Get email notifications', () => {
  it('AC10.3.1/AC10.3.3 Given a payout notice, Then the email is in my language and carries no KYC data, account number, password or OTP', async () => {
    const id = await user('en');
    await withTransaction(t.db, (tx) =>
      notifications.notify(
        tx,
        {
          recipientUserId: id,
          templateKey: payoutSent.typeKey,
          dedupeKey: 'payout-1',
          params: { amountPoisha: 150000, accountLast4: '6789' },
          channels: ['in_app', 'email'],
          priority: 'high',
        },
        'c',
      ),
    );
    await relay.runOnce();
    await notifications.dispatchDue();
    const email = [...mailbox.sent]
      .reverse()
      .find((m) => m.kind === 'notification' && m.locale === 'en');
    expect(email?.text).toContain('৳1,500.00');
    expect(email?.text).toContain('••••6789');
    expect(email?.text).not.toMatch(/password|otp|nid/i);
  });

  it('refuses parameters that look like personal data at the notify() boundary', async () => {
    const id = await user('en');
    await expect(
      withTransaction(t.db, (tx) =>
        notifications.notify(
          tx,
          {
            recipientUserId: id,
            templateKey: payoutSent.typeKey,
            dedupeKey: 'payout-pii',
            params: { accountNumber: '01712345678' },
            channels: ['email'],
            priority: 'normal',
          },
          'c',
        ),
      ),
    ).rejects.toThrow(/personal data/);
  });
});

describe('US10.4 Keep SMS off with automatic fallback', () => {
  it('AC10.4.1 Given SMS is off, When an SMS-bound notice is sent, Then it goes in-app, by push and by email instead, and no SMS request is made', async () => {
    await settings.save(
      admin,
      { settingKey: 'notifications.pushEnabled', value: false, reason: 'push back off' },
      'corr-push-off',
    );
    const id = await user('en');
    await send(id, payoutSent, 'sms-off-1', ['sms']);
    const channels = (await deliveries(id)).map((r) => r.channel);
    expect(channels).toEqual(['email', 'in_app']);
    expect(smsSender.send).not.toHaveBeenCalled();
  });

  it('AC10.4.2 Given an Admin turns SMS on, When the next SMS-bound notice is sent, Then it also goes by SMS and the switch is audit-logged', async () => {
    expect(
      (
        await settings.save(
          admin,
          { settingKey: 'notifications.smsEnabled', value: true, reason: 'SMS provider ready' },
          'corr-sms-on',
        )
      ).ok,
    ).toBe(true);
    const id = await user('en');
    await send(id, payoutSent, 'sms-on-1', ['sms']);
    expect((await deliveries(id)).map((r) => r.channel)).toContain('sms');
    expect(smsSender.send).toHaveBeenCalledOnce();
    const audit = await t.pool.query(
      "SELECT after FROM audit_log_entry WHERE correlation_id = 'corr-sms-on'",
    );
    expect(audit.rows[0]?.after).toMatchObject({ value: true });
  });
});
