// [LT] The CSV reader used by Admin imports.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toCsv } from '#src/features/platform/index.ts';
import { parseCsv } from './csv-parse.ts';

// toCsv neutralises spreadsheet formulas, so cells starting with one of those characters change.
const cell = fc.string().filter((x) => !/^[=+\-@\t\r]/.test(x));

describe('parseCsv', () => {
  it('reads quoted commas, doubled quotes, line breaks, CRLF, a BOM and blank lines', () => {
    const r = parseCsv('﻿A, b \r\n"x, y","say ""hi"""\r\n\r\n"two\nlines",z\n');
    expect(r).toEqual({
      ok: true,
      header: ['a', 'b'],
      records: [
        { line: 2, fields: { a: 'x, y', b: 'say "hi"' } },
        { line: 4, fields: { a: 'two\nlines', b: 'z' } },
      ],
    });
  });
  it('fills missing trailing fields with empty strings', () => {
    const r = parseCsv('a,b,c\n1');
    expect(r.ok && r.records[0]?.fields).toEqual({ a: '1', b: '', c: '' });
  });
  it('refuses an empty file and an unterminated quote', () => {
    expect(parseCsv('')).toEqual({ ok: false, error: 'empty' });
    expect(parseCsv('a\n"open')).toEqual({ ok: false, error: 'unterminatedQuote' });
  });
  it('reads back what toCsv writes', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(cell, cell), { minLength: 1, maxLength: 5 }), (rows) => {
        const data = rows.filter(([a, b]) => a !== '' || b !== '');
        const csv = toCsv(
          ['a', 'b'],
          data.map(([a, b]) => [a, b]),
        );
        const r = parseCsv(csv.toString('utf8'));
        expect(r.ok && r.records.map((x) => [x.fields.a, x.fields.b])).toEqual(data);
      }),
    );
  });
});
