// Regression (Bolt 3, Step 29): contract 1 IDs are imported by schemas the browser also loads (I1
// forms, the lesson document). A `node:*` import here crashed every such page in the browser
// ("Module node:crypto has been externalized"). The module must stay free of Node-only imports.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Id, newId } from './ids.ts';

describe('src/lib/ids.ts', () => {
  it('imports no Node-only module, so client code can load it', () => {
    const source = readFileSync(new URL('./ids.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"]node:/);
  });

  it('newId returns a fresh UUID that Id accepts', () => {
    const a = newId();
    const b = newId();
    expect(Id.safeParse(a).success).toBe(true);
    expect(a).not.toBe(b);
  });
});
