// Integration project setup: loads .env and proves PostgreSQL and Valkey are reachable. If they are
// not, the run FAILS with instructions; integration tests are never silently skipped.
import { existsSync } from 'node:fs';
import { Socket } from 'node:net';
import pg from 'pg';

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

export async function setup(): Promise<void> {
  const dotenv = new URL('../../.env', import.meta.url);
  if (existsSync(dotenv)) process.loadEnvFile(dotenv);
  const databaseUrl = process.env.DATABASE_URL;
  const valkeyUrl = process.env.VALKEY_URL;
  if (!databaseUrl || !valkeyUrl) {
    throw new Error(
      'Integration tests need DATABASE_URL and VALKEY_URL. Run `pnpm env:init && pnpm db:up`.',
    );
  }
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('select 1');
  } catch (error) {
    throw new Error(
      `PostgreSQL is not reachable (${error instanceof Error ? error.message : 'unknown'}). Run \`pnpm db:up\`.`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
  const valkey = new URL(valkeyUrl);
  if (!(await canConnect(valkey.hostname, Number(valkey.port || 6379)))) {
    throw new Error('Valkey is not reachable. Run `pnpm db:up`.');
  }
}
