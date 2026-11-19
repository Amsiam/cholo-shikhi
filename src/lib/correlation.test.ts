import { describe, expect, it } from 'vitest';
import { correlationIdFrom, currentCorrelationId, withCorrelation } from './correlation.ts';

describe('correlation IDs', () => {
  it('accepts a well-formed incoming ID', () => {
    expect(correlationIdFrom('req-12345678')).toBe('req-12345678');
  });
  it('replaces a missing or malformed ID with a fresh UUID', () => {
    expect(correlationIdFrom(null)).toMatch(/^[0-9a-f-]{36}$/);
    expect(correlationIdFrom('bad id with spaces')).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('propagates across awaits', async () => {
    await withCorrelation('corr-await-1', async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(currentCorrelationId()).toBe('corr-await-1');
    });
  });
});
