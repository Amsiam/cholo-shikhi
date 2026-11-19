// CSV writer (TS-11): UTF-8 with a byte-order mark so spreadsheets read Bangla correctly (BR14.1),
// RFC 4180 quoting, and formula-injection escaping (BR14.2).
const FORMULA_START = /^[=+\-@\t\r]/;

/** A cell starting with =, +, -, @, a tab or a carriage return is prefixed with ' so it stays text. */
export function escapeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

export function quoteCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsvLine(cells: readonly string[]): string {
  return cells.map((cell) => quoteCell(escapeFormula(cell))).join(',');
}

export const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly string[]>): Buffer {
  const lines = [toCsvLine(header), ...rows.map(toCsvLine)];
  return Buffer.concat([UTF8_BOM, Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8')]);
}
