// Server-side environment, read once and validated with Zod (team.md Environment and secrets).
// Only variables prefixed PUBLIC_ may ever reach the browser; see publicEnvFrom().
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded');

/**
 * A bare WebSocket origin: ws:// or wss://, host and optional port, nothing else (no path, query,
 * fragment, credentials or extra characters), because it is written into the CSP connect-src.
 */
export const WsOrigin = z.string().refine((value) => {
  try {
    const url = new URL(value);
    const isWs = url.protocol === 'ws:' || url.protocol === 'wss:';
    return isWs && !url.username && !url.password && `${url.protocol}//${url.host}` === value;
  } catch {
    return false;
  }
}, 'must be a bare ws:// or wss:// origin such as ws://localhost:3001');

/**
 * CATALOG_CURSOR_KEYS (catalog LC-213, SD-205): the S3 paging-cursor HMAC keys, server-only.
 * `<kid>:<base64 32 bytes>` for the current key, optionally `,<kid>:<base64 32 bytes>` for the
 * previous key kept during a rotation. Missing or malformed fails start-up.
 */
const CURSOR_KEY_ENTRY = /^([a-z0-9]{1,16}):([A-Za-z0-9+/]{43}=)$/;
export const CursorKeysEnv = z.string().transform((value, ctx) => {
  const entries = value.split(',').map((entry) => entry.trim());
  const keys = entries.map((entry) => CURSOR_KEY_ENTRY.exec(entry));
  const isWellFormed =
    entries.length >= 1 &&
    entries.length <= 2 &&
    keys.every((m) => m !== null && Buffer.from(m[2] as string, 'base64').length === 32) &&
    new Set(keys.map((m) => m?.[1])).size === entries.length;
  if (!isWellFormed) {
    ctx.addIssue({
      code: 'custom',
      message: 'must be <kid>:<base64 32 bytes>[,<kid>:<base64 32 bytes>] with distinct kids',
    });
    return z.NEVER;
  }
  const [current, previous] = keys.map((m) => ({
    kid: m?.[1] as string,
    key: new Uint8Array(Buffer.from(m?.[2] as string, 'base64')),
  }));
  return {
    current: current as { kid: string; key: Uint8Array },
    ...(previous ? { previous } : {}),
  };
});

const NodeEnv = z.enum(['development', 'test', 'production']).default('development');
const LogLevel = z
  .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
  .default('info');

export const EnvSchema = z.object({
  NODE_ENV: NodeEnv,
  APP_BASE_URL: z.url(),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
  VALKEY_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// or rediss:// URL'),
  BETTER_AUTH_SECRET: z.string().min(32),
  IDENTIFIER_HASH_KEY: z.string().min(32),
  TOTP_ENCRYPTION_KEY: base64Key32,
  /** AES-256-GCM key for KYC NID numbers and payout account numbers at rest (US7.19, US7.20). */
  KYC_ENCRYPTION_KEY: base64Key32,
  REALTIME_JOIN_TOKEN_SECRET: z.string().min(32),
  CATALOG_CURSOR_KEYS: CursorKeysEnv,
  TRUSTED_ORIGINS: z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url()).min(1)),
  EMAIL_TRANSPORT: z.enum(['dev-mailbox']).default('dev-mailbox'),
  LOG_LEVEL: LogLevel,
  REALTIME_PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  REALTIME_HOST: z.string().default('127.0.0.1'),
  PUBLIC_APP_NAME: z.string().default('Cholo Shikhi'),
  /** The WebSocket origin the browser connects to, e.g. ws://localhost:3001 (added to CSP connect-src). */
  PUBLIC_REALTIME_URL: WsOrigin.optional(),
  /**
   * Catalog image helper socket (INF-202). Not a secret. The helper sidecar mounts it at
   * /run/helper/helper.sock; when nothing listens there, image uploads fail closed.
   */
  IMAGE_HELPER_SOCKET_PATH: z.string().startsWith('/').default('/run/helper/helper.sock'),
});

export type Env = z.infer<typeof EnvSchema>;

/** Secret-shaped names that must never be exposed through a PUBLIC_ variable. */
const SECRET_NAME_PATTERN = /(SECRET|PASSWORD|TOKEN|KEY|PRIVATE|CREDENTIAL)/i;

export class EnvError extends Error {
  override name = 'EnvError';
}

/** Pure parser: validates a raw environment record and fails fast with a clear message. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  for (const name of Object.keys(source)) {
    if (name.startsWith('PUBLIC_') && SECRET_NAME_PATTERN.test(name.slice('PUBLIC_'.length))) {
      throw new EnvError(
        `Public variable ${name} looks like a secret; public variables reach the browser.`,
      );
    }
  }
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Names and reasons only; values are never printed.
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new EnvError(
      `Invalid environment configuration:\n${problems}\nSee .env.example and README.md.`,
    );
  }
  return parsed.data;
}

/** The subset of the environment that may be sent to the browser. */
export function publicEnvFrom(env: Env): { PUBLIC_APP_NAME: string } {
  return { PUBLIC_APP_NAME: env.PUBLIC_APP_NAME };
}

let cached: Env | undefined;

/** Reads process.env once (loading .env in development) and caches the validated result. */
export function getEnv(): Env {
  if (typeof window !== 'undefined') {
    throw new EnvError('getEnv() is server-only and must never run in the browser.');
  }
  if (cached) return cached;
  // Resolved from the working directory, so it also works from the bundled server build.
  const dotenv = join(process.cwd(), '.env');
  if (process.env.NODE_ENV !== 'production' && existsSync(dotenv)) {
    process.loadEnvFile(dotenv);
  }
  cached = parseEnv(process.env);
  return cached;
}

/** Test hook: forget the cached environment. */
export function resetEnvForTests(): void {
  cached = undefined;
}

// ---------------------------------------------------------------------------------------------
// Partial readers. Some code runs where the full secrets environment is absent (the logger in unit
// tests, the request middleware's header config, the production `serve` script). Each reader
// validates only the variables it needs, still with Zod, and still only here: no other module reads
// process.env.

function parsePart<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined>,
): z.output<S> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new EnvError(
      `Invalid environment configuration:\n${problems}\nSee .env.example and README.md.`,
    );
  }
  return parsed.data;
}

/** The logger's level (LOG_LEVEL, default info). */
export function getLogLevel(
  source: Record<string, string | undefined> = process.env,
): z.output<typeof LogLevel> {
  return parsePart(z.object({ LOG_LEVEL: LogLevel }), source).LOG_LEVEL;
}

/**
 * Whether NODE_ENV is production, read at call time (not cached) so test-only seams can refuse to
 * run in production. An unrecognised NODE_ENV throws EnvError, which also refuses.
 */
export function isProductionRuntime(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return parsePart(z.object({ NODE_ENV: NodeEnv }), source).NODE_ENV === 'production';
}

const HttpSecuritySchema = z.object({
  NODE_ENV: NodeEnv,
  PUBLIC_REALTIME_URL: WsOrigin.optional(),
});

/**
 * What the request middleware needs for security headers. A malformed PUBLIC_REALTIME_URL fails
 * here, before it can reach the CSP connect-src.
 */
export function getHttpSecurityConfig(source: Record<string, string | undefined> = process.env): {
  isProduction: boolean;
  realtimeOrigin?: string;
} {
  const parsed = parsePart(HttpSecuritySchema, source);
  return {
    isProduction: parsed.NODE_ENV === 'production',
    ...(parsed.PUBLIC_REALTIME_URL ? { realtimeOrigin: parsed.PUBLIC_REALTIME_URL } : {}),
  };
}

/** Where `pnpm start` (scripts/serve.ts) listens: PORT (default 3000) and HOST (default 127.0.0.1). */
export function getServeConfig(source: Record<string, string | undefined> = process.env): {
  port: number;
  host: string;
} {
  const parsed = parsePart(
    z.object({
      PORT: z.coerce.number().int().min(0).max(65535).default(3000),
      HOST: z.string().min(1).default('127.0.0.1'),
    }),
    source,
  );
  return { port: parsed.PORT, host: parsed.HOST };
}
