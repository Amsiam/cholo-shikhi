// How another Student's name is shown on shared lists (merit lists, battles): first name and an
// initial, so a full name never reaches other Students.

/** Another Student's name on a merit list: first name and an initial ("Rahim U."). */
export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const [first, ...rest] = parts;
  const last = rest.at(-1);
  return last ? `${first} ${[...last][0]}.` : (first as string);
}
