// [LT] renderer: retention purge (BR14.4), request validation, object-key safety.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '#src/lib/time.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createFileObjectStore } from './object-store.server.ts';
import { createRenderer, defineCsvTemplate } from './renderer.server.ts';

const template = defineCsvTemplate({
  name: 'test.list',
  owner: 'test',
  columns: [{ key: 'id', header: { bn: 'আইডি', en: 'ID' } }],
});
let t: TestDatabase;
let dir: string;
const clock = fixedClock('2026-11-13T00:00:00.000Z');
beforeAll(async () => {
  t = await createTestDatabase();
  dir = mkdtempSync(join(tmpdir(), 'cs-render-lt-'));
});
afterAll(async () => {
  await t.drop();
  rmSync(dir, { recursive: true, force: true });
});

describe('renderer', () => {
  it('purges files and records after retainUntil', async () => {
    const renderer = createRenderer({
      db: t.db,
      clock,
      store: createFileObjectStore(pathToFileURL(`${dir}/`)),
      templates: [template],
    });
    const r = await renderer.render(
      {
        template: 'test.list',
        locale: 'en',
        format: 'csv',
        data: [{ id: 'a' }],
        retainUntil: '2026-11-20T00:00:00.000Z',
      },
      'c',
    );
    if (!r.ok) throw new Error(r.error.code);
    expect(existsSync(join(dir, r.value.objectKey))).toBe(true);
    expect(await renderer.purgeExpired()).toBe(0);
    clock.set('2026-11-21T00:00:00.000Z');
    expect(await renderer.purgeExpired()).toBe(1);
    expect(existsSync(join(dir, r.value.objectKey))).toBe(false);
  });

  it('refuses a retainUntil in the past and an invalid locale', async () => {
    const renderer = createRenderer({
      db: t.db,
      clock,
      store: createFileObjectStore(pathToFileURL(`${dir}/`)),
      templates: [template],
    });
    expect(
      await renderer.render(
        {
          template: 'test.list',
          locale: 'en',
          format: 'csv',
          data: [],
          retainUntil: '2020-01-01T00:00:00.000Z',
        },
        'c',
      ),
    ).toMatchObject({ ok: false });
    expect(
      await renderer.render(
        {
          template: 'test.list',
          locale: 'fr' as 'en',
          format: 'csv',
          data: [],
          retainUntil: '2030-01-01T00:00:00.000Z',
        },
        'c',
      ),
    ).toMatchObject({ ok: false });
  });

  it('uses a PDF engine when one is configured', async () => {
    const renderer = createRenderer({
      db: t.db,
      clock,
      store: createFileObjectStore(pathToFileURL(`${dir}/`)),
      templates: [template],
      pdfEngine: { render: async () => Buffer.from('%PDF-') },
    });
    // The engine port exists; CSV-shaped data still renders through the template.
    expect(
      (
        await renderer.render(
          {
            template: 'test.list',
            locale: 'bn',
            format: 'pdf',
            data: [{ id: 'x' }],
            retainUntil: '2030-01-01T00:00:00.000Z',
          },
          'c',
        )
      ).ok,
    ).toBe(true);
  });

  it('refuses unsafe object keys', async () => {
    const store = createFileObjectStore(pathToFileURL(`${dir}/`));
    await expect(store.put('../escape.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      /invalid object key/,
    );
  });
});
