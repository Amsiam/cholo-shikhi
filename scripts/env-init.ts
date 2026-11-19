// Creates a local .env with freshly generated random secrets, if none exists. For an existing .env
// it only appends independent secrets added since (listed in ADDABLE) that the file lacks; every
// existing line is left unchanged. Values are generated on this machine and never committed (.env is
// gitignored), and no value is ever printed.
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = new URL('../.env', import.meta.url);
const secret = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Secrets that do not depend on any other value, so they can be added to an existing .env. */
const ADDABLE: Record<string, () => string> = {
  // catalog LC-213: the S3 paging-cursor key, `<kid>:<base64 32 bytes>`.
  CATALOG_CURSOR_KEYS: () => `k1:${randomBytes(32).toString('base64')}`,
};

if (existsSync(target)) {
  const present = new Set(
    readFileSync(target, 'utf8')
      .split('\n')
      .map((line) => line.split('=')[0]?.trim()),
  );
  const missing = Object.keys(ADDABLE).filter((name) => !present.has(name));
  for (const name of missing) appendFileSync(target, `${name}=${ADDABLE[name]?.()}\n`);
  console.log(
    missing.length > 0
      ? `.env exists; added ${missing.join(', ')} and left every other line unchanged.`
      : '.env already exists; leaving it unchanged.',
  );
  process.exit(0);
}
const pgPassword = secret(18);
const valkeyPassword = secret(18);

const lines = [
  'NODE_ENV=development',
  'APP_BASE_URL=http://localhost:3000',
  `DATABASE_URL=postgres://cholo:${pgPassword}@127.0.0.1:55432/cholo_shikhi`,
  `VALKEY_URL=redis://:${valkeyPassword}@127.0.0.1:56379`,
  `BETTER_AUTH_SECRET=${secret()}`,
  `IDENTIFIER_HASH_KEY=${secret()}`,
  `TOTP_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
  `KYC_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
  `REALTIME_JOIN_TOKEN_SECRET=${secret()}`,
  ...Object.entries(ADDABLE).map(([name, generate]) => `${name}=${generate()}`),
  'TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000',
  'EMAIL_TRANSPORT=dev-mailbox',
  'LOG_LEVEL=info',
  'REALTIME_PORT=3001',
  'REALTIME_HOST=127.0.0.1',
  'PUBLIC_REALTIME_URL=ws://localhost:3001',
  'PUBLIC_APP_NAME="Cholo Shikhi"',
  `POSTGRES_PASSWORD=${pgPassword}`,
  `VALKEY_PASSWORD=${valkeyPassword}`,
];
writeFileSync(target, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log('Created .env with generated local secrets.');
