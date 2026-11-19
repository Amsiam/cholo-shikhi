// Real-time room core (US11.9, contract 3 rooms.*): join tokens, strictly increasing sequence numbers,
// a current-state snapshot and a capped replay log in Valkey, and pub/sub fan-out. Transport-agnostic:
// the WebSocket endpoint that sits on this waits for the spike record's approval (BR16.5).
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { isPersonalDataKey } from '#src/features/platform/domain/instrumentation.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import type { ValkeyClient } from '#src/server/valkey.server.ts';
import { signJoinToken, verifyJoinToken } from '../domain/join-token.ts';
import { RoomKey, RoomMessage } from '../domain/room.schema.ts';

// Assigns the next sequence number, stores the snapshot, appends to the replay log and publishes,
// atomically, so every subscriber sees one order (BR16.2).
const PUBLISH_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
local seq = redis.call('INCR', KEYS[2])
local message = cjson.decode(ARGV[1])
message['seq'] = seq
local encoded = cjson.encode(message)
redis.call('SET', KEYS[3], encoded)
redis.call('RPUSH', KEYS[4], encoded)
redis.call('LTRIM', KEYS[4], -tonumber(ARGV[2]), -1)
redis.call('PUBLISH', KEYS[5], encoded)
return seq`;

export type RoomsDeps = {
  valkey: ValkeyClient;
  joinTokenSecret: string;
  clock: Clock;
  keyPrefix?: string;
  tokenTtlSeconds?: number;
  replayLogSize?: number;
};

export type JoinedRoom = { snapshot: RoomMessage | null; leave(): Promise<void> };

/** How a join listens to a room channel: one Valkey subscriber per client, or one shared per process. */
export type RoomSubscription = {
  subscribe(channel: string, onRaw: (raw: string) => void): Promise<() => Promise<void>>;
};

/** A dedicated subscriber connection (tests, small tools). */
export function dedicatedSubscription(client: ValkeyClient): RoomSubscription {
  return {
    async subscribe(channel, onRaw) {
      const listener = (ch: string, raw: string) => {
        if (ch === channel) onRaw(raw);
      };
      client.on('message', listener);
      await client.subscribe(channel);
      return async () => {
        client.off('message', listener);
        await client.unsubscribe(channel);
      };
    },
  };
}

/**
 * One Valkey subscriber shared by every socket in a real-time process: a channel is subscribed while at
 * least one socket listens to it (NFR12.2: 25,000 sockets per instance must not mean 25,000 connections).
 */
export function sharedSubscription(
  client: ValkeyClient,
): RoomSubscription & { channelCount(): number } {
  const listeners = new Map<string, Set<(raw: string) => void>>();
  client.on('message', (channel: string, raw: string) => {
    for (const listener of listeners.get(channel) ?? []) listener(raw);
  });
  return {
    channelCount: () => listeners.size,
    async subscribe(channel, onRaw) {
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
        await client.subscribe(channel);
      }
      set.add(onRaw);
      return async () => {
        const current = listeners.get(channel);
        current?.delete(onRaw);
        if (current && current.size === 0) {
          listeners.delete(channel);
          await client.unsubscribe(channel);
        }
      };
    },
  };
}

export function createRooms(deps: RoomsDeps) {
  const prefix = deps.keyPrefix ?? 'rt';
  const keys = (roomKey: string) => ({
    meta: `${prefix}:room:${roomKey}:open`,
    seq: `${prefix}:room:${roomKey}:seq`,
    state: `${prefix}:room:${roomKey}:state`,
    log: `${prefix}:room:${roomKey}:log`,
    channel: `${prefix}:room:${roomKey}`,
  });
  const nowMs = () => new Date(deps.clock.now()).getTime();

  /** Contract 3: the room owner (U7 or U8) checks access before calling. Opens the room if needed. */
  async function authorizeJoin(
    roomKey: string,
    actor: Actor,
  ): Promise<Result<{ joinToken: string }, AppError<'FORBIDDEN' | 'NOT_FOUND'>>> {
    if (!RoomKey.safeParse(roomKey).success) return err(appError('NOT_FOUND'));
    await deps.valkey.set(keys(roomKey).meta, '1');
    const expiresAt = nowMs() + (deps.tokenTtlSeconds ?? 300) * 1000;
    return ok({
      joinToken: signJoinToken(deps.joinTokenSecret, { roomKey, userId: actor.userId, expiresAt }),
    });
  }

  /** Contract 3. The room stamps the authoritative sequence number; the caller's `seq` is ignored. */
  async function publish(
    roomKey: string,
    message: RoomMessage,
  ): Promise<Result<void, AppError<'NOT_FOUND' | 'VALIDATION_FAILED'>>> {
    const parsed = RoomMessage.safeParse(message);
    if (!RoomKey.safeParse(roomKey).success || !parsed.success)
      return err(appError('VALIDATION_FAILED'));
    // BR16.4: only aggregates are broadcast; obvious personal-data fields are refused.
    if (
      typeof parsed.data.body === 'object' &&
      parsed.data.body !== null &&
      Object.keys(parsed.data.body).some(isPersonalDataKey)
    ) {
      return err(appError('VALIDATION_FAILED', { details: { reason: 'personal_data_in_body' } }));
    }
    const k = keys(roomKey);
    const result = await deps.valkey.eval(
      PUBLISH_SCRIPT,
      5,
      k.meta,
      k.seq,
      k.state,
      k.log,
      k.channel,
      JSON.stringify(parsed.data),
      String(deps.replayLogSize ?? 500),
    );
    return result === -1 ? err(appError('NOT_FOUND')) : ok(undefined);
  }

  async function close(roomKey: string): Promise<void> {
    const k = keys(roomKey);
    await deps.valkey.publish(
      k.channel,
      JSON.stringify({ kind: 'room.closed', seq: 0, sentAt: deps.clock.now(), body: {} }),
    );
    await deps.valkey.del(k.meta, k.seq, k.state, k.log);
  }

  /**
   * Joins a room for one client connection (BR16.1, BR16.3): subscribes first, then replays everything
   * after `fromSeq` from the log, then live messages, each sequence number delivered at most once.
   */
  async function join(input: {
    roomKey: string;
    joinToken: string;
    actor: Actor;
    subscription: RoomSubscription;
    fromSeq?: number;
    onMessage: (message: RoomMessage) => void;
  }): Promise<Result<JoinedRoom, AppError<'FORBIDDEN' | 'NOT_FOUND'>>> {
    const claims = verifyJoinToken(deps.joinTokenSecret, input.joinToken, nowMs());
    if (!claims || claims.roomKey !== input.roomKey || claims.userId !== input.actor.userId)
      return err(appError('FORBIDDEN'));
    const k = keys(input.roomKey);
    if (!(await deps.valkey.exists(k.meta))) return err(appError('NOT_FOUND'));
    let lastSeq = input.fromSeq ?? 0;
    let isReplaying = true;
    const buffered: RoomMessage[] = [];
    const deliver = (message: RoomMessage) => {
      if (message.kind !== 'room.closed' && message.seq <= lastSeq) return;
      if (message.seq > 0) lastSeq = message.seq;
      input.onMessage(message);
    };
    // Subscribe first, then read the log, so nothing published in between is lost.
    const unsubscribe = await input.subscription.subscribe(k.channel, (raw) => {
      const message = JSON.parse(raw) as RoomMessage;
      if (isReplaying) buffered.push(message);
      else deliver(message);
    });
    const [stateRaw, logRaw] = await Promise.all([
      deps.valkey.get(k.state),
      deps.valkey.lrange(k.log, 0, -1),
    ]);
    const snapshot = stateRaw ? (JSON.parse(stateRaw) as RoomMessage) : null;
    if (input.fromSeq !== undefined) {
      for (const raw of logRaw) deliver(JSON.parse(raw) as RoomMessage);
    } else if (snapshot) {
      // A fresh join starts from the current state.
      lastSeq = snapshot.seq;
    }
    isReplaying = false;
    for (const message of buffered.sort((a, b) => a.seq - b.seq)) deliver(message);
    return ok({ snapshot, leave: unsubscribe });
  }

  return { authorizeJoin, publish, close, join };
}

export type Rooms = ReturnType<typeof createRooms>;
