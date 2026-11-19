// The real-time WebSocket server (US11.9; ADR 0001 Option A, approved by the human on 2026-11-13).
// One shared Valkey subscriber per process fans room messages out to every socket. A connection is
// accepted only from a trusted Origin, with an active Better Auth session (cookie) and a join token
// issued to that same user for that room (BR16.1). Close codes: 4400 bad request, 4401
// unauthenticated, 4403 forbidden, 4404 room not found.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { type WebSocket, WebSocketServer } from 'ws';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import type { AppError } from '#src/lib/errors.ts';
import { getLogger } from '#src/lib/logger.ts';
import { metrics } from '#src/lib/metrics.ts';
import type { Result } from '#src/lib/result.ts';
import type { ValkeyClient } from '#src/server/valkey.server.ts';
import { RoomKey } from '../domain/room.schema.ts';
import { type Rooms, sharedSubscription } from './rooms.server.ts';

export type RealtimeServerDeps = {
  getActor: (request: Request) => Promise<Result<Actor, AppError>>;
  rooms: Rooms;
  /** A dedicated Valkey connection used only for SUBSCRIBE. */
  subscriber: ValkeyClient;
  trustedOrigins: readonly string[];
  heartbeatMs?: number;
};

export const CLOSE = {
  badRequest: 4400,
  unauthenticated: 4401,
  forbidden: 4403,
  notFound: 4404,
} as const;

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const name of ['cookie', 'origin', 'user-agent', 'x-forwarded-for']) {
    const value = req.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, { headers });
}

export function createRealtimeServer(deps: RealtimeServerDeps) {
  const log = getLogger().child({ component: 'realtime' });
  const subscription = sharedSubscription(deps.subscriber);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const alive = new WeakSet<WebSocket>();

  async function onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const roomKey = url.searchParams.get('room') ?? '';
    const joinToken = url.searchParams.get('token') ?? '';
    const fromSeqRaw = url.searchParams.get('fromSeq');
    const fromSeq =
      fromSeqRaw !== null && /^\d+$/.test(fromSeqRaw) ? Number(fromSeqRaw) : undefined;
    if (!RoomKey.safeParse(roomKey).success || !joinToken) {
      ws.close(CLOSE.badRequest, 'bad request');
      return;
    }
    const actor = await deps.getActor(toRequest(req));
    if (!actor.ok) {
      ws.close(CLOSE.unauthenticated, 'unauthenticated');
      return;
    }
    const joined = await deps.rooms.join({
      roomKey,
      joinToken,
      actor: actor.value,
      subscription,
      ...(fromSeq !== undefined ? { fromSeq } : {}),
      onMessage: (message) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'message', message }));
      },
    });
    if (!joined.ok) {
      ws.close(
        joined.error.code === 'NOT_FOUND' ? CLOSE.notFound : CLOSE.forbidden,
        joined.error.code.toLowerCase(),
      );
      return;
    }
    metrics.increment('realtime_joins_total');
    ws.send(JSON.stringify({ type: 'snapshot', snapshot: joined.value.snapshot }));
    ws.on('close', () => {
      void joined.value
        .leave()
        .catch((error: unknown) =>
          log.warn({ err: error, code: 'REALTIME_LEAVE_FAILED' }, 'leave failed'),
        );
    });
    // Clients only send keep-alive pings here; answers belong to the room owners (U7/U8).
    ws.on('message', (data) => {
      if (data.toString() === '{"type":"ping"}' && ws.readyState === 1) ws.send('{"type":"pong"}');
    });
  }

  const http: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sockets: wss.clients.size }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  http.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/rooms') return rejectUpgrade(socket, 404, 'Not Found');
    // BR3.5 applies to sockets too: only the app's own origins may open one.
    if (!origin || !deps.trustedOrigins.includes(origin))
      return rejectUpgrade(socket, 403, 'Forbidden');
    wss.handleUpgrade(req, socket, head, (ws) => {
      alive.add(ws);
      ws.on('pong', () => alive.add(ws));
      void onConnection(ws, req).catch((error: unknown) => {
        log.error({ err: error, code: 'REALTIME_JOIN_FAILED' }, 'join failed');
        ws.close(1011, 'internal error');
      });
    });
  });

  // Drop sockets that stopped answering pings, so dead phones do not hold room subscriptions.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
    metrics.setGauge('realtime_open_sockets', wss.clients.size);
  }, deps.heartbeatMs ?? 30_000);
  heartbeat.unref();

  return {
    listen(port: number, host: string): Promise<number> {
      return new Promise((resolve) => {
        http.listen(port, host, () => {
          const address = http.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      });
    },
    subscribedChannels: () => subscription.channelCount(),
    async close(): Promise<void> {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.close(1001, 'server shutting down');
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
