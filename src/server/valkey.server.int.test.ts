import { describe, expect, it } from 'vitest';
import { createValkey, pingValkey } from './valkey.server.ts';

describe('valkey client', () => {
  it('answers PING on the local Valkey', async () => {
    const client = createValkey(process.env.VALKEY_URL as string);
    try {
      expect(await pingValkey(client)).toBe(true);
    } finally {
      client.disconnect();
    }
  });
  it('reports false for an unreachable server instead of throwing', async () => {
    const client = createValkey('redis://127.0.0.1:1', { lazyConnect: true });
    try {
      expect(await pingValkey(client, 300)).toBe(false);
    } finally {
      client.disconnect();
    }
  });
});
