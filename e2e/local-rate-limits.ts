// Starts every e2e run from a known rate-limit state on the LOCAL dev database.
//
// Why: the journey signs up once per run from the same loopback client, and the app's sign-up limiter
// (DEFAULT_RATE_LIMITS.sign_up: 5 per client per 15 minutes) plus Better Auth's per-IP limiter persist
// in the database. Without a reset, the sixth run inside 15 minutes is refused with 429 and the
// journey fails at "check your email". The limits themselves are unchanged and stay covered by their
// own unit and integration tests; only the local counters left by earlier runs are cleared.
//
// Safety: refuses to run unless the app is in development, the database is on a loopback host and
// the e2e target is a local URL. It never touches staging or production data.
import pg from 'pg';
import { getEnv } from '../src/lib/env.ts';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLoopbackUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

export async function resetLocalRateLimits(): Promise<void> {
  const env = getEnv();
  const target = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  if (
    env.NODE_ENV !== 'development' ||
    !isLoopbackUrl(env.DATABASE_URL) ||
    !isLoopbackUrl(target)
  ) {
    throw new Error(
      'resetLocalRateLimits only resets rate limits on a local development database; refusing to run.',
    );
  }
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM rate_limit_bucket WHERE action = 'sign_up'`);
    await client.query(
      `DELETE FROM auth_rate_limit
        WHERE key LIKE '127.0.0.1|%' OR key LIKE '::1|%' OR key LIKE 'no-trusted-ip|%'`,
    );
  } finally {
    await client.end();
  }
}
