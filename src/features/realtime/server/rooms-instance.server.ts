import { getEnv } from '#src/lib/env.ts';
import { systemClock } from '#src/lib/time.ts';
import { createValkey } from '#src/server/valkey.server.ts';
import { createRooms, type Rooms } from './rooms.server.ts';

let shared: Rooms | undefined;

export function getRooms(): Rooms {
  if (!shared) {
    const env = getEnv();
    shared = createRooms({
      valkey: createValkey(env.VALKEY_URL),
      joinTokenSecret: env.REALTIME_JOIN_TOKEN_SECRET,
      clock: systemClock,
    });
  }
  return shared;
}
