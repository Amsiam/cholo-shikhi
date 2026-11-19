// [LT] translate/translateDynamic and the literal scanner edge cases.
import { describe, expect, it } from 'vitest';
import { formatDate } from './format.ts';
import { isMessageKey, translate, translateDynamic } from './index.ts';
import { findLiteralJsxStrings } from './literal-check.ts';

describe('translate', () => {
  it('interpolates parameters and writes numbers with Bangla digits in bn', () => {
    expect(translate('bn', 'auth.email.verify.body', { hours: 24, link: 'L' })).toContain('২৪');
    expect(translate('en', 'auth.email.verify.body', { hours: 24, link: 'L' })).toContain(
      '24 hours',
    );
  });
  it('leaves an unknown placeholder visible rather than dropping it', () => {
    expect(translate('en', 'auth.email.verify.body', {})).toContain('{hours}');
  });
  it('falls back to the key for unknown dynamic keys', () => {
    expect(isMessageKey('app.name')).toBe(true);
    expect(translateDynamic('en', 'errors.nope.X')).toBe('errors.nope.X');
    expect(translateDynamic('bn', 'app.name')).toBe('চলো শিখি');
  });
});

describe('formatting', () => {
  it('shows the Asia/Dhaka calendar date', () => {
    expect(formatDate('2026-11-13T20:00:00.000Z', 'en')).toBe('Nov 14, 2026');
  });
});

describe('literal scanner', () => {
  it('ignores arrow functions, comparisons and expressions', () => {
    expect(findLiteralJsxStrings('const f = (a) => a > b && c < d; <p>{t("k")}</p>')).toEqual([]);
  });
  it('does not mistake TypeScript generics for JSX tags', () => {
    expect(
      findLiteralJsxStrings(
        'const [a] = useState<string[] | null>(null); type C = ColumnDef<T>; const x = 1;',
      ),
    ).toEqual([]);
  });
  it('does not report code between two JSX blocks', () => {
    expect(
      findLiteralJsxStrings('if (x) return <p>{t("a")}</p>;\n  return (\n <form>{t("b")}</form>);'),
    ).toEqual([]);
  });
  it('finds Bangla literals and placeholders', () => {
    expect(
      findLiteralJsxStrings('<span>লগ ইন</span><input placeholder="Email" />').map((f) => f.text),
    ).toEqual(['লগ ইন', 'Email']);
  });
});
