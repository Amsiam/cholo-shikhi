import { describe, expect, it } from 'vitest';
import { buildPerson, createRng } from './synthetic.ts';

describe('synthetic factories', () => {
  it('produces deterministic sequences for a fixed seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('builds bn_BD and en people with reserved test-domain emails', () => {
    const bn = buildPerson({ locale: 'bn_BD', seed: 1 });
    const en = buildPerson({ locale: 'en', seed: 1 });
    expect(bn.locale).toBe('bn');
    expect(en.locale).toBe('en');
    expect(bn.email).toMatch(/@example\.test$/);
    expect(en.password.length).toBeGreaterThanOrEqual(12);
  });

  it('never repeats an email across calls', () => {
    const emails = new Set(Array.from({ length: 50 }, () => buildPerson().email));
    expect(emails.size).toBe(50);
  });
});
