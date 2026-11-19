import { describe, expect, it } from 'vitest';

// Runner smoke test (Step 2): proves Vitest, TypeScript and the `#src/*` import map work.
describe('test runner', () => {
  it('resolves the #src import map', async () => {
    const mod = await import('#src/test/factories/synthetic.ts');
    expect(typeof mod.buildPerson).toBe('function');
  });
});
