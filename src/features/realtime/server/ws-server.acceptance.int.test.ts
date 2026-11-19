// [AT] US11.9 over the real WebSocket transport (ADR 0001 Option A, approved 2026-11-13): two real
// `ws` clients signed in with real Better Auth sessions, Valkey fan-out, join tokens and reconnects.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createValkey, type ValkeyClient } from '#src/server/valkey.server.ts';
import { type AuthHarness, createAuthHarness } from '#src/test/auth-harness.ts';
import { TEST_ORIGIN } from '#src/test/browser.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createRooms } from './rooms.server.ts';
import { createRealtimeServer } from './ws-server.server.ts';

type Frame = {
  type: string;
  snapshot?: { seq: number } | null;
  message?: { seq: number; kind: string };
  code?: string;
};

let t: TestDatabase;
let h: AuthHarness;
let publisher: ValkeyClient;
let subscriber: ValkeyClient;
let rooms: ReturnType<typeof createRooms>;
let server: ReturnType<typeof createRealtimeServer>;
let port: number;
const clock = fixedClock(new Date().toISOString());

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createAuthHarness(t);
  publisher = createValkey(process.env.VALKEY_URL as string);
  subscriber = createValkey(process.env.VALKEY_URL as string);
  rooms = createRooms({
    valkey: publisher,
    joinTokenSecret: 'ws-test-secret-0123456789abcdef0123',
    clock,
    keyPrefix: `ws:${randomUUID()}`,
  });
  server = createRealtimeServer({
    getActor: (request) => h.identity.getActor(request),
    rooms,
    subscriber,
    trustedOrigins: [TEST_ORIGIN],
  });
  port = await server.listen(0, '127.0.0.1');
});
afterAll(async () => {
  await server.close();
  publisher.disconnect();
  subscriber.disconnect();
  await t.drop();
});

async function signedIn() {
  const student = await h.verifiedStudent();
  const actor = await h.identity.getActor(student.browser.request('/'));
  if (!actor.ok) throw new Error('not signed in');
  return { cookie: student.browser.cookieHeader(), actor: actor.value };
}

function connect(query: Record<string, string>, headers: Record<string, string>) {
  const url = `ws://127.0.0.1:${port}/rooms?${new URLSearchParams(query)}`;
  const socket = new WebSocket(url, { headers: { origin: TEST_ORIGIN, ...headers } });
  const frames: Frame[] = [];
  socket.on('message', (data) => frames.push(JSON.parse(data.toString()) as Frame));
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  const opened = new Promise<void>((resolve, reject) => {
    socket.on('open', () => resolve());
    socket.on('error', reject);
  });
  return { socket, frames, closed, opened };
}

async function until(predicate: () => boolean, ms = 3000) {
  const started = Date.now();
  while (!predicate() && Date.now() - started < ms) await new Promise((r) => setTimeout(r, 10));
}

const seqs = (frames: Frame[]) =>
  frames.filter((f) => f.type === 'message').map((f) => f.message?.seq);

async function token(roomKey: string, actor: Actor) {
  const r = await rooms.authorizeJoin(roomKey, actor);
  if (!r.ok) throw new Error('refused');
  return r.value.joinToken;
}

describe('US11.9 over WebSockets', () => {
  it('AC11.9.1 Given two signed-in clients in a room, When the server broadcasts, Then both receive the messages in order', async () => {
    const roomKey = `live:${randomUUID()}`;
    const a = await signedIn();
    const b = await signedIn();
    const ca = connect(
      { room: roomKey, token: await token(roomKey, a.actor) },
      { cookie: a.cookie },
    );
    const cb = connect(
      { room: roomKey, token: await token(roomKey, b.actor) },
      { cookie: b.cookie },
    );
    await Promise.all([ca.opened, cb.opened]);
    await until(
      () =>
        ca.frames.some((f) => f.type === 'snapshot') &&
        cb.frames.some((f) => f.type === 'snapshot'),
    );
    for (let i = 0; i < 4; i++)
      await rooms.publish(roomKey, {
        kind: 'poll.tally',
        seq: 0,
        sentAt: clock.now(),
        body: { i },
      });
    await until(() => seqs(ca.frames).length === 4 && seqs(cb.frames).length === 4);
    expect(seqs(ca.frames)).toEqual([1, 2, 3, 4]);
    expect(seqs(cb.frames)).toEqual([1, 2, 3, 4]);
    ca.socket.close();
    cb.socket.close();
  });

  it("AC11.9.2 Given a client without a session, or with another user's join token, When it subscribes, Then it is refused", async () => {
    const roomKey = `battle:${randomUUID()}`;
    const owner = await signedIn();
    const intruder = await signedIn();
    const joinToken = await token(roomKey, owner.actor);
    const anonymous = connect({ room: roomKey, token: joinToken }, {});
    expect(await anonymous.closed).toBe(4401);
    const wrongUser = connect({ room: roomKey, token: joinToken }, { cookie: intruder.cookie });
    expect(await wrongUser.closed).toBe(4403);
    expect(anonymous.frames.concat(wrongUser.frames).some((f) => f.type === 'message')).toBe(false);
  });

  it('refuses an upgrade from an untrusted origin', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/rooms?room=x&token=y`, {
      headers: { origin: 'https://evil.example' },
    });
    const status = await new Promise<number>((resolve) =>
      socket.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0)),
    );
    expect(status).toBe(403);
  });

  it('AC11.9.3 Given a client reconnects mid-session, When it resubscribes, Then it gets the current state and no duplicates', async () => {
    const roomKey = `live:${randomUUID()}`;
    const viewer = await signedIn();
    const joinToken = await token(roomKey, viewer.actor);
    const first = connect({ room: roomKey, token: joinToken }, { cookie: viewer.cookie });
    await first.opened;
    await until(() => first.frames.some((f) => f.type === 'snapshot'));
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
    await until(() => seqs(first.frames).length === 2);
    first.socket.close();
    await first.closed;
    // Leaving unsubscribes the shared channel once the last socket in the room is gone.
    await until(() => server.subscribedChannels() === 0);
    expect(server.subscribedChannels()).toBe(0);
    await rooms.publish(roomKey, {
      kind: 'state',
      seq: 0,
      sentAt: clock.now(),
      body: { slide: 3 },
    });
    const again = connect(
      { room: roomKey, token: joinToken, fromSeq: '2' },
      { cookie: viewer.cookie },
    );
    await again.opened;
    await until(() => again.frames.some((f) => f.type === 'snapshot'));
    await rooms.publish(roomKey, {
      kind: 'state',
      seq: 0,
      sentAt: clock.now(),
      body: { slide: 4 },
    });
    await until(() => seqs(again.frames).includes(4));
    expect(again.frames.find((f) => f.type === 'snapshot')?.snapshot?.seq).toBe(3);
    expect(seqs(again.frames)).toEqual([3, 4]);
    again.socket.close();
  });
});
