// `pnpm i18n:check` (local stand-in for the deferred CI gate): catalogue parity and no literal
// user-facing strings in components (BR6.6, AC1.12.5). Exits non-zero on any problem.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLiteralJsxStrings } from '../src/lib/i18n/literal-check.ts';
import { catalogueParityProblems } from '../src/lib/i18n/parity.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP = [/src\/components\/ui\//, /\.test\.tsx$/, /routeTree\.gen\.ts$/];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

const problems = [...catalogueParityProblems()];
for (const file of tsxFiles(join(root, 'src'))) {
  const rel = relative(root, file);
  if (SKIP.some((pattern) => pattern.test(rel))) continue;
  for (const finding of findLiteralJsxStrings(readFileSync(file, 'utf8'))) {
    problems.push(`${rel}: literal string "${finding.text}"`);
  }
}

if (problems.length > 0) {
  console.error(`i18n check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('i18n check passed: catalogues in parity, no literal JSX strings.');
