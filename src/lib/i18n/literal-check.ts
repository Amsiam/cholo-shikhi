// BR6.6 / AC1.12.5: no literal user-facing string in components. A deliberately simple scanner:
// JSX text nodes and user-facing attributes that contain letters must come from t().
export type LiteralFinding = { index: number; text: string };

const LETTER = 'A-Za-z\\u0980-\\u09FF';
// Text that follows an opening or closing JSX tag, up to the next tag.
const TEXT_NODE = new RegExp(
  `(?<![\\w$.\\])])<\\/?[A-Za-z][^<>]*>([^<>{}]*[${LETTER}][^<>{}]*)<`,
  'g',
);
const ATTRIBUTE = new RegExp(
  `\\b(?:aria-label|placeholder|title|alt|label)="([^"]*[${LETTER}][^"]*)"`,
  'g',
);

export function findLiteralJsxStrings(source: string): LiteralFinding[] {
  const findings: LiteralFinding[] = [];
  for (const match of source.matchAll(TEXT_NODE)) {
    const text = (match[1] ?? '').trim();
    // Code between two JSX blocks (`);  return (`), not user-facing text.
    const isCode = text.includes(';') || text.includes('=>');
    if (text && !isCode) findings.push({ index: match.index ?? 0, text });
  }
  for (const match of source.matchAll(ATTRIBUTE)) {
    findings.push({ index: match.index ?? 0, text: match[1] ?? '' });
  }
  return findings.sort((a, b) => a.index - b.index);
}
