// Import-boundary test for U2 (Step 2). Since the human approved Step 51 on 2026-11-17, the Biome
// per-path noRestrictedImports overrides in biome.json enforce the same rules at lint time; this test
// stays as the second check, and also covers relative imports and deep imports into U1 features that
// a glob rule cannot express. It reads every source file under src/features/goals and
// src/features/catalog and fails when:
//   - any file imports a feature of a later unit (ADR-020: U2 depends on U1 only);
//   - any file reaches into another feature other than through its index.ts (UI may also use the
//     Platform UI kit, any layer may use a U1 feature's pure domain/ modules, and routes are
//     outside this scan);
//   - a ui/ file imports a data/ module or the DB client;
//   - a domain/ file imports a framework, auth library, DB client, data layer or server module, or
//     reads process.env (team.md layer boundaries).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const U2_FEATURES = ['goals', 'catalog'] as const;
const U1_FEATURES = new Set([
  'platform',
  'identity-access',
  'notifications',
  'app-shell',
  'realtime',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function importSpecifiers(source: string): string[] {
  const found: string[] = [];
  const pattern =
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const spec = match[1] ?? match[2];
    if (spec) found.push(spec);
  }
  return found;
}

/** The repo-relative path an import points at, or the bare package name. */
function resolveSpecifier(fromFile: string, spec: string): string {
  if (spec.startsWith('#src/')) return `src/${spec.slice('#src/'.length)}`;
  if (spec.startsWith('@/')) return `src/${spec.slice(2)}`;
  if (spec.startsWith('.'))
    return relative(ROOT, resolve(fromFile, '..', spec))
      .split(sep)
      .join('/');
  return spec;
}

type Violation = { file: string; spec: string; rule: string };

function checkFile(file: string, source: string): Violation[] {
  const rel = relative(ROOT, file).split(sep).join('/');
  const [, , feature, layer] = rel.split('/');
  const violations: Violation[] = [];
  const add = (spec: string, rule: string) => violations.push({ file: rel, spec, rule });
  for (const spec of importSpecifiers(source)) {
    const target = resolveSpecifier(file, spec);
    const featureMatch = /^src\/features\/([^/]+)\/(.*)$/.exec(target);
    if (featureMatch) {
      const [, targetFeature, rest] = featureMatch as unknown as [string, string, string];
      if (targetFeature !== feature) {
        const isU2 = (U2_FEATURES as readonly string[]).includes(targetFeature);
        if (!isU2 && !U1_FEATURES.has(targetFeature)) add(spec, 'later-unit feature');
        const isIndex = rest === 'index.ts' || rest === 'index' || rest === '';
        const isUiKit = layer === 'ui' && targetFeature === 'platform' && rest.startsWith('ui/');
        // A U1 feature's domain/ modules are plain TypeScript (contract types and pure rules such
        // as defineSetting); a feature index re-exports server singletons, so a pure layer that
        // needs a U1 contract type imports it from that feature's domain instead.
        const isU1Domain = U1_FEATURES.has(targetFeature) && rest.startsWith('domain/');
        if (!isIndex && !isUiKit && !isU1Domain)
          add(spec, 'other feature not through its index.ts');
      }
    }
    if (layer === 'ui' && (/\/data\//.test(target) || /^src\/server\/db/.test(target))) {
      add(spec, 'ui imports data layer');
    }
    if (layer === 'domain') {
      const isFramework =
        /^(@tanstack\/|react$|react-dom|better-auth|pg$|drizzle-orm)/.test(target) ||
        /\/data\//.test(target) ||
        /^src\/server\//.test(target) ||
        /\.server(\.ts)?$/.test(target);
      if (isFramework) add(spec, 'domain imports framework/DB/server');
    }
  }
  if (layer === 'domain' && /process\.env/.test(source)) {
    violations.push({ file: rel, spec: 'process.env', rule: 'domain reads env' });
  }
  return violations;
}

describe('U2 import boundaries', () => {
  const files = U2_FEATURES.flatMap((f) => walk(join(ROOT, 'src/features', f)));

  it('scans the U2 feature folders', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it('has no boundary violations', () => {
    const violations = files.flatMap((file) => checkFile(file, readFileSync(file, 'utf8')));
    expect(violations).toEqual([]);
  });

  describe('the checker itself catches each rule', () => {
    const at = (path: string) => join(ROOT, path);
    it('flags a later-unit feature', () => {
      expect(
        checkFile(
          at('src/features/goals/server/x.ts'),
          "import { a } from '#src/features/commerce/index.ts';",
        ),
      ).toEqual([expect.objectContaining({ rule: 'later-unit feature' })]);
    });
    it('flags a deep import into another feature', () => {
      const v = checkFile(
        at('src/features/goals/server/x.ts'),
        "import { a } from '#src/features/platform/server/outbox.server.ts';",
      );
      expect(v.map((x) => x.rule)).toEqual(['other feature not through its index.ts']);
    });
    it('allows the Platform UI kit from ui/ only', () => {
      const spec = "import { DataTable } from '#src/features/platform/ui/DataTable.tsx';";
      expect(checkFile(at('src/features/goals/ui/X.tsx'), spec)).toEqual([]);
      expect(checkFile(at('src/features/goals/server/x.ts'), spec)).toHaveLength(1);
    });
    it('flags ui importing data and domain importing frameworks or env', () => {
      expect(
        checkFile(
          at('src/features/goals/ui/X.tsx'),
          "import { r } from '../data/goals.repository.ts';",
        ),
      ).toHaveLength(1);
      expect(
        checkFile(at('src/features/goals/domain/x.ts'), "import { z } from 'react';"),
      ).toHaveLength(1);
      expect(
        checkFile(at('src/features/goals/domain/x.ts'), "import { db } from '#src/server/db.ts';"),
      ).toHaveLength(1);
      expect(
        checkFile(at('src/features/goals/domain/x.ts'), 'const k = process.env.X;'),
      ).toHaveLength(1);
      expect(
        checkFile(at('src/features/goals/domain/x.ts'), "import { ok } from '#src/lib/result.ts';"),
      ).toEqual([]);
    });
  });
});
