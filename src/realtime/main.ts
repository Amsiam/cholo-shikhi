// `pnpm dev:realtime`: the WebSocket server for real-time rooms (ADR 0001). Locally one process on
// REALTIME_PORT (default 3001); production runs at least 2 instances behind the proxy (NFR12.5).
import { getIdentity } from '#src/features/identity-access/server/identity-instance.server.ts';
import { getRooms } from '#src/features/realtime/server/rooms-instance.server.ts';
import { createRealtimeServer } from '#src/features/realtime/server/ws-server.server.ts';
import { getEnv } from '#src/lib/env.ts';
import { getLogger } from '#src/lib/logger.ts';
import { closeDb } from '#src/server/db.ts';
import { createValkey } from '#src/server/valkey.server.ts';

const env = getEnv();
const log = getLogger().child({ component: 'realtime' });
const subscriber = createValkey(env.VALKEY_URL);
const server = createRealtimeServer({
  getActor: (request) => getIdentity().getActor(request),
  rooms: getRooms(),
  subscriber,
  trustedOrigins: env.TRUSTED_ORIGINS,
});
const port = await server.listen(env.REALTIME_PORT, env.REALTIME_HOST);
log.info({ port }, 'real-time server listening');

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'real-time server stopping');
  await server.close();
  subscriber.disconnect();
  await closeDb();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
