// [LT] Bangladeshi mobile number normalisation.
import { describe, expect, it } from 'vitest';
import { formatBdPhone, normaliseBdPhone } from './phone.ts';

describe('normaliseBdPhone', () => {
  it.each([
    ['01712345678', '+8801712345678'],
    ['+8801712345678', '+8801712345678'],
    ['8801912345678', '+8801912345678'],
    ['017-1234 5678', '+8801712345678'],
    ['০১৭১২৩৪৫৬৭৮', '+8801712345678'],
  ])('accepts %s', (input, out) => expect(normaliseBdPhone(input)).toBe(out));
  it.each([['01212345678'], ['0171234567'], ['+15551234567'], ['abc'], ['']])(
    'refuses %s',
    (input) => expect(normaliseBdPhone(input)).toBeNull(),
  );
  it('formats for display', () => expect(formatBdPhone('+8801712345678')).toBe('01712-345678'));
});
