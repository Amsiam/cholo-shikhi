// [AT] US11.11 Render PDF and CSV exports in one service (written before the renderer exists).
// PDF rendering is behind a port; headless Chromium is not installed in this Bolt (plan Step 18),
// so the PDF path must answer RENDERER_UNAVAILABLE and store nothing.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '#src/lib/time.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createFileObjectStore } from './object-store.server.ts';
import { createRenderer, defineCsvTemplate } from './renderer.server.ts';

const statement = defineCsvTemplate({
  name: 'test.statement',
  owner: 'test',
  columns: [
    { key: 'description', header: { bn: 'বিবরণ', en: 'Description' } },
    { key: 'amount', header: { bn: 'পরিমাণ', en: 'Amount' } },
  ],
});

let t: TestDatabase;
let dir: string;
let renderer: ReturnType<typeof createRenderer>;
beforeAll(async () => {
  t = await createTestDatabase();
  dir = mkdtempSync(join(tmpdir(), 'cs-render-'));
  renderer = createRenderer({
    db: t.db,
    clock: fixedClock('2026-11-13T09:00:00.000Z'),
    store: createFileObjectStore(pathToFileURL(`${dir}/`)),
    templates: [statement],
  });
});
afterAll(async () => {
  await t.drop();
  rmSync(dir, { recursive: true, force: true });
});

describe('US11.11 Render PDF and CSV exports in one service', () => {
  it('AC11.11.1 Given a statement template and data, When rendered, Then a UTF-8 CSV is produced (Bangla intact) and recorded', async () => {
    const r = await renderer.render(
      {
        template: 'test.statement',
        locale: 'bn',
        format: 'csv',
        data: [{ description: 'কোর্স ফি', amount: '৳১,৫০০.০০' }],
        retainUntil: '2027-11-13T00:00:00.000Z',
      },
      'corr-r1',
    );
    if (!r.ok) throw new Error(r.error.code);
    const bytes = readFileSync(join(dir, r.value.objectKey));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8')).toBe('বিবরণ,পরিমাণ\r\nকোর্স ফি,"৳১,৫০০.০০"\r\n');
    const { rows } = await t.pool.query(
      'SELECT format, locale, template FROM rendered_document WHERE object_key = $1',
      [r.value.objectKey],
    );
    expect(rows[0]).toEqual({ format: 'csv', locale: 'bn', template: 'test.statement' });
  });

  it('AC11.11.1 (PDF) Given no PDF engine is configured, When a PDF is requested, Then RENDERER_UNAVAILABLE is returned and nothing is stored', async () => {
    const before = await t.pool.query('SELECT count(*)::int AS n FROM rendered_document');
    const r = await renderer.render(
      {
        template: 'test.statement',
        locale: 'bn',
        format: 'pdf',
        data: [],
        retainUntil: '2027-11-13T00:00:00.000Z',
      },
      'corr-r2',
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'RENDERER_UNAVAILABLE' } });
    const after = await t.pool.query('SELECT count(*)::int AS n FROM rendered_document');
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('AC11.11.2 Given a template error, When rendering fails, Then a typed error is returned and no partial file is stored', async () => {
    const unknown = await renderer.render(
      {
        template: 'no.such',
        locale: 'en',
        format: 'csv',
        data: [],
        retainUntil: '2027-01-01T00:00:00.000Z',
      },
      'corr-r3',
    );
    expect(unknown).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const badData = await renderer.render(
      {
        template: 'test.statement',
        locale: 'en',
        format: 'csv',
        data: [{ description: 'x' }],
        retainUntil: '2027-01-01T00:00:00.000Z',
      },
      'corr-r4',
    );
    expect(badData).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const { rows } = await t.pool.query(
      "SELECT count(*)::int AS n FROM rendered_document WHERE correlation_id IN ('corr-r3', 'corr-r4')",
    );
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('AC11.11.3 Given a value starting with =, +, - or @, When exported, Then it is escaped against formula injection', async () => {
    const r = await renderer.render(
      {
        template: 'test.statement',
        locale: 'en',
        format: 'csv',
        data: [
          { description: '=HYPERLINK("http://x")', amount: '+1' },
          { description: '-2', amount: '@SUM(A1)' },
        ],
        retainUntil: '2027-01-01T00:00:00.000Z',
      },
      'corr-r5',
    );
    if (!r.ok) throw new Error(r.error.code);
    const text = readFileSync(join(dir, r.value.objectKey)).subarray(3).toString('utf8');
    expect(text).toBe(
      'Description,Amount\r\n"\'=HYPERLINK(""http://x"")",\'+1\r\n\'-2,\'@SUM(A1)\r\n',
    );
  });
});
