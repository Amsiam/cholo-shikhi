// BR6.6: every key has non-empty bn and en entries.
import { bn } from './bn.ts';
import { en } from './en.ts';

type Catalogues = { en: Readonly<Record<string, string>>; bn: Readonly<Record<string, string>> };

export function catalogueParityProblems(catalogues: Catalogues = { en, bn }): string[] {
  const problems: string[] = [];
  for (const [lang, other] of [
    ['bn', 'en'],
    ['en', 'bn'],
  ] as const) {
    for (const key of Object.keys(catalogues[other])) {
      if (!Object.hasOwn(catalogues[lang], key)) problems.push(`${lang}: missing ${key}`);
    }
  }
  for (const lang of ['bn', 'en'] as const) {
    for (const [key, value] of Object.entries(catalogues[lang])) {
      if (value.trim() === '') problems.push(`${lang}: empty ${key}`);
    }
  }
  const order = (p: string) =>
    p.startsWith('bn: missing')
      ? 0
      : p.startsWith('bn: empty')
        ? 1
        : p.startsWith('en: missing')
          ? 2
          : 3;
  return problems.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}
