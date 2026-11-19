// Bangladeshi mobile numbers (profile, trial protection per Q15). Plain TypeScript.
// Accepts 01XXXXXXXXX, 8801XXXXXXXXX or +8801XXXXXXXXX, with spaces or dashes and Bangla digits;
// operator codes 013–019. Stored as +8801XXXXXXXXX.

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';

export function normaliseBdPhone(input: string): string | null {
  const latin = [...input.trim()]
    .map((ch) => {
      const i = BANGLA_DIGITS.indexOf(ch);
      return i >= 0 ? String(i) : ch;
    })
    .join('')
    .replace(/[\s-]/g, '');
  const m = /^(?:\+?88)?(01[3-9]\d{8})$/.exec(latin);
  return m ? `+88${m[1]}` : null;
}

/** For display: 01XXX-XXXXXX. */
export function formatBdPhone(e164: string): string {
  const local = e164.replace(/^\+88/, '');
  return `${local.slice(0, 5)}-${local.slice(5)}`;
}
