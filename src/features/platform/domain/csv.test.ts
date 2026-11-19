import { describe, expect, it } from 'vitest';
import { escapeFormula, quoteCell, toCsv, toCsvLine } from './csv.ts';

describe('CSV (BR14.1, BR14.2)', () => {
  it.each(['=1+1', '+1', '-1', '@A1', '\tx', '\rx'])('escapes formula-leading cell %j', (cell) => {
    expect(escapeFormula(cell)).toBe(`'${cell}`);
  });
  it('leaves ordinary cells, including Bangla and inner = signs, alone', () => {
    expect(escapeFormula('কোর্স')).toBe('কোর্স');
    expect(escapeFormula('a=b')).toBe('a=b');
  });
  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(quoteCell('a,b')).toBe('"a,b"');
    expect(quoteCell('say "hi"')).toBe('"say ""hi"""');
    expect(quoteCell('two\nlines')).toBe('"two\nlines"');
    expect(toCsvLine(['x', '=y,z'])).toBe('x,"\'=y,z"');
  });
  it('writes a UTF-8 BOM and CRLF line endings', () => {
    const out = toCsv(['h'], [['১']]);
    expect([...out.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(out.subarray(3).toString('utf8')).toBe('h\r\n১\r\n');
  });
});
