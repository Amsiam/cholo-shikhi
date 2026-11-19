// [AT] US1.12 Choose my interface language — the i18n-layer criteria (written before format.ts,
// parity.ts and the literal-string check exist). The account-saving criteria are covered in Step 8.
import { describe, expect, it } from 'vitest';
import { formatDate, formatInteger, htmlLang, parseLocalizedInteger } from './format.ts';
import { translate } from './index.ts';
import { findLiteralJsxStrings } from './literal-check.ts';
import { resolveDeviceLocale } from './locale.ts';
import { catalogueParityProblems } from './parity.ts';

describe('US1.12 Choose my interface language', () => {
  it('AC1.12.1 Given English, When I choose বাংলা, Then labels, numbers and dates render in Bangla only and the page lang is bn', () => {
    expect(translate('en', 'app.name')).toBe('Cholo Shikhi');
    expect(translate('bn', 'app.name')).toBe('চলো শিখি');
    expect(formatInteger(1234567, 'bn')).toBe('১২,৩৪,৫৬৭');
    expect(formatInteger(1234567, 'en')).toBe('1,234,567');
    expect(formatDate('2026-11-13T20:00:00.000Z', 'bn')).toMatch(/^[০-৯]/);
    expect(formatDate('2026-11-13T20:00:00.000Z', 'bn')).not.toMatch(/[0-9]/);
    expect(htmlLang('bn')).toBe('bn');
    expect(htmlLang('en')).toBe('en');
  });

  it('AC1.12.2 Given a Visitor on a first visit, Then Bangla is the default unless the browser prefers English', () => {
    expect(resolveDeviceLocale('bn-BD,bn;q=0.9', null)).toBe('bn');
    expect(resolveDeviceLocale('en-US,en;q=0.9', null)).toBe('en');
  });

  it('BR6.5 numeric inputs accept Bangla digits and normalise them', () => {
    expect(parseLocalizedInteger('১২৩')).toBe(123);
    expect(parseLocalizedInteger('12a')).toBeNull();
  });

  it('AC1.12.5 Given a key missing or empty in bn, Then the parity check fails; the shipped catalogues pass', () => {
    expect(
      catalogueParityProblems({ en: { 'a.b': 'x', 'a.c': 'y' }, bn: { 'a.b': '', 'a.d': 'z' } }),
    ).toEqual(['bn: missing a.c', 'bn: empty a.b', 'en: missing a.d']);
    expect(catalogueParityProblems()).toEqual([]);
  });

  it('AC1.12.5 Given a literal JSX string, Then the no-literal check reports it', () => {
    const source = `export function A() { return <div><p>Sign in</p><Button aria-label="Close">{t('x')}</Button><img alt="" /></div>; }`;
    expect(findLiteralJsxStrings(source).map((f) => f.text)).toEqual(['Sign in', 'Close']);
  });
});
