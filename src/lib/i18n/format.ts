// Number and date formatting for the active language (BR6.5): Bangla digits in bn, via Intl.
import { normaliseDigits } from '#src/features/platform/domain/settings.ts';
import type { Locale } from './locale.ts';

const INTEGER = { bn: new Intl.NumberFormat('bn-BD'), en: new Intl.NumberFormat('en-US') } as const;
const MARKS = {
  bn: new Intl.NumberFormat('bn-BD', { maximumFractionDigits: 2 }),
  en: new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }),
} as const;

/** Exam marks kept in hundredths (150 = 1.5), shown with up to two decimals. */
export function formatMarks(x100: number, locale: Locale): string {
  return MARKS[locale].format(x100 / 100);
}

const DATE = {
  bn: new Intl.DateTimeFormat('bn-BD', { timeZone: 'Asia/Dhaka', dateStyle: 'medium' }),
  en: new Intl.DateTimeFormat('en-BD', { timeZone: 'Asia/Dhaka', dateStyle: 'medium' }),
} as const;

export function formatInteger(value: number, locale: Locale): string {
  return INTEGER[locale].format(value);
}

/** Calendar date in Asia/Dhaka (UTC is stored, Dhaka is shown). */
export function formatDate(instant: string, locale: Locale): string {
  return DATE[locale].format(new Date(instant));
}

/** The document `lang` attribute for a locale (AC1.12.1). */
export function htmlLang(locale: Locale): 'bn' | 'en' {
  return locale;
}

/** Accepts ASCII or Bangla digits (BR6.5); anything else is null. */
export function parseLocalizedInteger(input: string): number | null {
  const text = normaliseDigits(input.trim());
  return /^-?\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
}
