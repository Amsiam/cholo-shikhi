// [AT] US11.9 Build the real-time channel (written before the room core exists). The WebSocket
// transport itself waits for the human's approval of the spike record (BR16.5), so "clients" here are
// two independent Valkey subscribers using the room core a transport will sit on.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createValkey, type ValkeyClient } from '#src/server/valkey.server.ts';
import { createRooms, dedicatedSubscription } from './rooms.server.ts';

const secret = 'test-join-token-secret-0123456789abcdef';
const clock = fixedClock('2026-11-13T14:00:00.000Z');
const prefix = `t:${randomUUID()}`;
const student = (userId = randomUUID()): Actor => ({
  userId,
  roles: ['student'],
  locale: 'bn',
  hasStepUp: false,
});
let publisher: ValkeyClient;
const subscribers: ValkeyClient[] = [];
let rooms: ReturnType<typeof createRooms>;

function subscriberClient(): ValkeyClient {
  const client = createValkey(process.env.VALKEY_URL as string);
  subscribers.push(client);
  return client;
}

beforeAll(() => {
  publisher = createValkey(process.env.VALKEY_URL as string);
  rooms = createRooms({ valkey: publisher, joinTokenSecret: secret, clock, keyPrefix: prefix });
});
afterAll(async () => {
  for (const s of subscribers) s.disconnect();
  publisher.disconnect();
});

async function waitFor(predicate: () => boolean, ms = 3000) {
  const started = Date.now();
  while (!predicate() && Date.now() - started < ms) await new Promise((r) => setTimeout(r, 10));
}

describe('US11.9 Real-time rooms', () => {
  it('AC11.9.1 Given two subscribed clients, When the server broadcasts, Then both receive the messages in order', async () => {
    const roomKey = `live:${randomUUID()}`;
    const a = student();
    const b = student();
    const tokenA = await rooms.authorizeJoin(roomKey, a);
    const tokenB = await rooms.authorizeJoin(roomKey, b);
    if (!tokenA.ok || !tokenB.ok) throw new Error('join refused');
    const seenA: number[] = [];
    const seenB: number[] = [];
    const subA = await rooms.join({
      roomKey,
      joinToken: tokenA.value.joinToken,
      actor: a,
      subscription: dedicatedSubscription(subscriberClient()),
      onMessage: (m) => seenA.push(m.seq),
    });
    const subB = await rooms.join({
      roomKey,
      joinToken: tokenB.value.joinToken,
      actor: b,
      subscription: dedicatedSubscription(subscriberClient()),
      onMessage: (m) => seenB.push(m.seq),
    });
    expect(subA.ok && subB.ok).toBe(true);
    for (let i = 0; i < 5; i++)
      await rooms.publish(roomKey, {
        kind: 'poll.tally',
        seq: 0,
        sentAt: clock.now(),
        body: { i },
      });
    await waitFor(() => seenA.length === 5 && seenB.length === 5);
    expect(seenA).toEqual([1, 2, 3, 4, 5]);
    expect(seenB).toEqual([1, 2, 3, 4, 5]);
  });

  it('AC11.9.2 Given a client that is not authenticated for the room, When it subscribes, Then it is refused', async () => {
    const roomKey = `battle:${randomUUID()}`;
    const owner = student();
    const token = await rooms.authorizeJoin(roomKey, owner);
    if (!token.ok) throw new Error('join refused');
    const intruder = student();
    expect(
      await rooms.join({
        roomKey,
        joinToken: token.value.joinToken,
        actor: intruder,
        subscription: dedicatedSubscription(subscriberClient()),
        onMessage: () => undefined,
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await rooms.join({
        roomKey,
        joinToken: 'forged.token',
        actor: owner,
        subscription: dedicatedSubscription(subscriberClient()),
        onMessage: () => undefined,
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await rooms.join({
        roomKey: `battle:${randomUUID()}`,
        joinToken: token.value.joinToken,
        actor: owner,
        subscription: dedicatedSubscription(subscriberClient()),
        onMessage: () => undefined,
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('AC11.9.3 Given a client reconnects mid-session, When it resubscribes, Then it gets the current state and no duplicate messages', async () => {
    const roomKey = `live:${randomUUID()}`;
    const viewer = student();
    const token = await rooms.authorizeJoin(roomKey, viewer);
    if (!token.ok) throw new Error('join refused');
    const first: number[] = [];
    const sub = await rooms.join({
      roomKey,
      joinToken: token.value.joinToken,
      actor: viewer,
      subscription: dedicatedSubscription(subscriberClient()),
      onMessage: (m) => first.push(m.seq),
    });
    if (!sub.ok) throw new Error('join failed');
    await rooms.publish(roomKey, {
      kind: 'state',
      seq: 0,
      sentAt: clock.now(),
      body: { slide: 1 },
    });
    await rooms.publish(roomKey, {
      kind: 'state',
      seq: 0,
      sentAt: clock.now(),
      body: { slide: 2 },
    });
    await waitFor(() => first.length === 2);
    await sub.value.leave();
    // While disconnected, two more messages go out.
    await rooms.publish(roomKey, {
      kind: 'state',
      seq: 0,
      sentAt: clock.now(),
      body: { slide: 3 },
    });
    await rooms.publish(roomKey, {
      kind: 'state',
      seq: 0,
      sentAt: clock.now(),
      body: { slide: 4 },
    });
    const resumed: number[] = [];
    const again = await rooms.join({
      roomKey,
      joinToken: token.value.joinToken,
      actor: viewer,
      subscription: dedicatedSubscription(subscriberClient()),
      fromSeq: 2,
      onMessage: (m) => resumed.push(m.seq),
    });
    if (!again.ok) throw new Error('rejoin failed');
    expect(again.value.snapshot).toMatchObject({ seq: 4, body: { slide: 4 } });
    await rooms.publish(roomKey, {
      kind: 'state',
      seq: 0,
      sentAt: clock.now(),
      body: { slide: 5 },
    });
    await waitFor(() => resumed.includes(5));
    expect(resumed).toEqual([3, 4, 5]);
  });
});
