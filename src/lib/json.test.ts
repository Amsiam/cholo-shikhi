import { describe, expect, it } from 'vitest';
import { stableStringify } from './json.ts';

describe('stableStringify', () => {
  it('sorts keys at every level and drops undefined values', () => {
    expect(stableStringify({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[1,{"y":2,"z":1}]},"b":1}',
    );
  });
  it('gives equal text for equal values in any key order', () => {
    expect(stableStringify({ x: 1, y: 2 })).toBe(stableStringify({ y: 2, x: 1 }));
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('null');
  });
});
