// [LT] room core: NOT_FOUND for closed rooms, validation, close notice, snapshot for fresh joins.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { fixedClock } from '#src/lib/time.ts';
import { createValkey } from '#src/server/valkey.server.ts';
import { createRooms, dedicatedSubscription } from './rooms.server.ts';

const clock = fixedClock('2026-11-13T15:00:00.000Z');
const publisher = createValkey(process.env.VALKEY_URL as string);
const subs = [
  createValkey(process.env.VALKEY_URL as string),
  createValkey(process.env.VALKEY_URL as string),
];
const rooms = createRooms({
  valkey: publisher,
  joinTokenSecret: 'lt-secret-0123456789abcdef0123',
  clock,
  keyPrefix: `lt:${randomUUID()}`,
});
const actor = {
  userId: randomUUID(),
  roles: ['student' as const],
  locale: 'en' as const,
  hasStepUp: false,
};
afterAll(() => {
  for (const c of [publisher, ...subs]) c.disconnect();
});

describe('rooms', () => {
  it('refuses publishing to a room that was never opened, and invalid keys or messages', async () => {
    expect(
      await rooms.publish(`live:${randomUUID()}`, {
        kind: 'x',
        seq: 0,
        sentAt: clock.now(),
        body: {},
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(
      await rooms.publish('live:not-a-uuid', { kind: 'x', seq: 0, sentAt: clock.now(), body: {} }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(await rooms.authorizeJoin('chat:abc', actor)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('refuses a body carrying personal-data fields (BR16.4)', async () => {
    const roomKey = `battle:${randomUUID()}`;
    await rooms.authorizeJoin(roomKey, actor);
    expect(
      await rooms.publish(roomKey, {
        kind: 'scores',
        seq: 0,
        sentAt: clock.now(),
        body: { displayName: 'x' },
      }),
    ).toMatchObject({ ok: false });
  });

  it('starts a fresh join from the current snapshot and announces a close', async () => {
    const roomKey = `live:${randomUUID()}`;
    const token = await rooms.authorizeJoin(roomKey, actor);
    if (!token.ok) throw new Error('refused');
    await rooms.publish(roomKey, {
      kind: 'state',
      seq: 0,
      sentAt: clock.now(),
      body: { slide: 7 },
    });
    const seen: string[] = [];
    const joined = await rooms.join({
      roomKey,
      joinToken: token.value.joinToken,
      actor,
      subscription: dedicatedSubscription(subs[0] as never),
      onMessage: (m) => seen.push(m.kind),
    });
    if (!joined.ok) throw new Error('join failed');
    expect(joined.value.snapshot).toMatchObject({ seq: 1, body: { slide: 7 } });
    await rooms.close(roomKey);
    const started = Date.now();
    while (!seen.includes('room.closed') && Date.now() - started < 2000)
      await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(['room.closed']);
    expect(
      await rooms.join({
        roomKey,
        joinToken: token.value.joinToken,
        actor,
        subscription: dedicatedSubscription(subs[1] as never),
        onMessage: () => undefined,
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});
