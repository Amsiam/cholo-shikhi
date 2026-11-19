// Valkey (Redis protocol) client: real-time fan-out and health pings (TS-06). Bangladesh-hosted.
import Valkey from 'iovalkey';

export type ValkeyClient = InstanceType<typeof Valkey>;

export function createValkey(
  url: string,
  options: { lazyConnect?: boolean; enableOfflineQueue?: boolean } = {},
): ValkeyClient {
  return new Valkey(url, {
    maxRetriesPerRequest: 2,
    // Commands issued while connecting are queued; a health ping bounds its own wait instead.
    enableOfflineQueue: options.enableOfflineQueue ?? true,
    lazyConnect: options.lazyConnect ?? false,
  });
}

/** PING with a timeout; false on any failure. */
export async function pingValkey(client: ValkeyClient, timeoutMs = 1000): Promise<boolean> {
  try {
    if (client.status === 'wait') void client.connect().catch(() => undefined);
    const reply = await Promise.race([
      client.ping(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return reply === 'PONG';
  } catch {
    return false;
  }
}
