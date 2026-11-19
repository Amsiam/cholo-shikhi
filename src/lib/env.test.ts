import { describe, expect, it } from 'vitest';
import {
  EnvError,
  getHttpSecurityConfig,
  getLogLevel,
  getServeConfig,
  parseEnv,
  publicEnvFrom,
} from './env.ts';

const valid = {
  NODE_ENV: 'test',
  APP_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://u:p@127.0.0.1:55432/db',
  VALKEY_URL: 'redis://:p@127.0.0.1:56379',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  IDENTIFIER_HASH_KEY: 'y'.repeat(40),
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  KYC_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
  REALTIME_JOIN_TOKEN_SECRET: 'z'.repeat(40),
  CATALOG_CURSOR_KEYS: `k2:${Buffer.alloc(32, 2).toString('base64')}`,
  TRUSTED_ORIGINS: 'http://localhost:3000, http://127.0.0.1:3000',
};

describe('parseEnv', () => {
  it('accepts a complete environment and splits trusted origins', () => {
    const env = parseEnv(valid);
    expect(env.TRUSTED_ORIGINS).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    expect(env.EMAIL_TRANSPORT).toBe('dev-mailbox');
  });

  it('fails fast naming the missing variable without printing values', () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
    try {
      parseEnv({ ...valid, BETTER_AUTH_SECRET: 'short-secret-value' });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect(String(error)).not.toContain('short-secret-value');
    }
  });

  it('rejects a TOTP key that is not 32 bytes', () => {
    expect(() => parseEnv({ ...valid, TOTP_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(
      /TOTP_ENCRYPTION_KEY/,
    );
  });

  it('refuses a public variable whose name looks like a secret', () => {
    expect(() => parseEnv({ ...valid, PUBLIC_API_TOKEN: 'abc' })).toThrow(/looks like a secret/);
  });

  it('exposes only PUBLIC_ variables through publicEnvFrom', () => {
    const pub = publicEnvFrom(parseEnv(valid));
    expect(Object.keys(pub)).toEqual(['PUBLIC_APP_NAME']);
  });
});

describe('CATALOG_CURSOR_KEYS (catalog LC-213, SD-205)', () => {
  const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');

  it('parses the current key, and the previous key kept during a rotation', () => {
    expect(parseEnv(valid).CATALOG_CURSOR_KEYS).toEqual({
      current: { kid: 'k2', key: new Uint8Array(32).fill(2) },
    });
    const rotated = parseEnv({ ...valid, CATALOG_CURSOR_KEYS: `k3:${key(3)}, k2:${key(2)}` });
    expect(rotated.CATALOG_CURSOR_KEYS.current.kid).toBe('k3');
    expect(rotated.CATALOG_CURSOR_KEYS.previous?.kid).toBe('k2');
  });

  it('fails start-up when the variable is missing', () => {
    const { CATALOG_CURSOR_KEYS: _omit, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow(/CATALOG_CURSOR_KEYS/);
  });

  it('refuses a short key, a duplicate kid, three keys and a bad kid, without printing the value', () => {
    const short = `k1:${Buffer.alloc(16, 1).toString('base64')}`;
    for (const value of [
      short,
      `k1:${key(1)},k1:${key(2)}`,
      `k1:${key(1)},k2:${key(2)},k3:${key(3)}`,
      `K1:${key(1)}`,
      key(1),
      '',
    ]) {
      expect(() => parseEnv({ ...valid, CATALOG_CURSOR_KEYS: value })).toThrow(
        /CATALOG_CURSOR_KEYS/,
      );
    }
    try {
      parseEnv({ ...valid, CATALOG_CURSOR_KEYS: short });
    } catch (error) {
      expect(String(error)).not.toContain(short);
    }
  });
});

describe('PUBLIC_REALTIME_URL (written into the CSP connect-src)', () => {
  const malformed = [
    'ws://x:3001/path',
    'http://x',
    'ws://u:p@x',
    'ws://x?q',
    'ws://x#frag',
    "ws://x'; script-src *",
    'ws://localhost:3001 https://evil.example',
    'not a url',
  ];

  it.each(malformed)('parseEnv rejects %s', (value) => {
    expect(() => parseEnv({ ...valid, PUBLIC_REALTIME_URL: value })).toThrow(/PUBLIC_REALTIME_URL/);
  });

  it.each(malformed)('getHttpSecurityConfig rejects %s', (value) => {
    expect(() => getHttpSecurityConfig({ PUBLIC_REALTIME_URL: value })).toThrow(EnvError);
  });

  it('accepts bare ws and wss origins', () => {
    expect(
      parseEnv({ ...valid, PUBLIC_REALTIME_URL: 'ws://localhost:3001' }).PUBLIC_REALTIME_URL,
    ).toBe('ws://localhost:3001');
    expect(getHttpSecurityConfig({ PUBLIC_REALTIME_URL: 'wss://rt.example.com' })).toEqual({
      isProduction: false,
      realtimeOrigin: 'wss://rt.example.com',
    });
  });

  it('omits the realtime origin when unset and reports production', () => {
    expect(getHttpSecurityConfig({ NODE_ENV: 'production' })).toEqual({ isProduction: true });
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => getHttpSecurityConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});

describe('getLogLevel', () => {
  it('defaults to info and accepts a known level', () => {
    expect(getLogLevel({})).toBe('info');
    expect(getLogLevel({ LOG_LEVEL: 'warn' })).toBe('warn');
  });

  it('rejects an unknown level', () => {
    expect(() => getLogLevel({ LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});

describe('getServeConfig', () => {
  it('defaults to 127.0.0.1:3000 and coerces PORT', () => {
    expect(getServeConfig({})).toEqual({ port: 3000, host: '127.0.0.1' });
    expect(getServeConfig({ PORT: '8080', HOST: '0.0.0.0' })).toEqual({
      port: 8080,
      host: '0.0.0.0',
    });
  });

  it.each(['abc', '70000', '-1', '3.5'])('rejects PORT=%s', (port) => {
    expect(() => getServeConfig({ PORT: port })).toThrow(/PORT/);
  });
});
