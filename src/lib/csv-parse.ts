// A small RFC 4180 CSV reader for Admin imports. Plain TypeScript.
// Quoted fields may hold commas, doubled quotes and line breaks; CRLF and LF both end a record;
// a leading UTF-8 byte-order mark is ignored; blank lines are skipped.

export type CsvParse =
  | { ok: true; header: string[]; records: Array<{ line: number; fields: Record<string, string> }> }
  | { ok: false; error: 'empty' | 'unterminatedQuote' };

/** Raw rows of fields, each with the 1-based line number it started on. */
function rowsOf(text: string): Array<{ line: number; cells: string[] }> | null {
  const rows: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = '';
  let isQuoted = false;
  let line = 1;
  let startLine = 1;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const endRow = () => {
    cells.push(cell);
    if (!(cells.length === 1 && cells[0] === '')) rows.push({ line: startLine, cells });
    cells = [];
    cell = '';
  };
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i] as string;
    if (isQuoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else isQuoted = false;
      } else {
        if (c === '\n') line += 1;
        cell += c;
      }
      continue;
    }
    if (c === '"' && cell === '') isQuoted = true;
    else if (c === ',') {
      cells.push(cell);
      cell = '';
    } else if (c === '\r' && src[i + 1] === '\n') {
      // handled by the '\n' on the next step
    } else if (c === '\n' || c === '\r') {
      endRow();
      line += 1;
      startLine = line;
    } else cell += c;
  }
  if (isQuoted) return null;
  endRow();
  return rows;
}

/** The header (trimmed, lower-cased) and every record keyed by it. */
export function parseCsv(text: string): CsvParse {
  const rows = rowsOf(text);
  if (!rows) return { ok: false, error: 'unterminatedQuote' };
  const [head, ...body] = rows;
  if (!head) return { ok: false, error: 'empty' };
  const header = head.cells.map((h) => h.trim().toLowerCase());
  return {
    ok: true,
    header,
    records: body.map((r) => ({
      line: r.line,
      fields: Object.fromEntries(header.map((h, i) => [h, r.cells[i] ?? ''])),
    })),
  };
}
