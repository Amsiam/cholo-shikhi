// The i18n layer: one language at a time (BR6.1), bn and en catalogues with dot-namespaced keys.
import { toBanglaDigits } from '../money.ts';
import { bn } from './bn.ts';
import { en } from './en.ts';

export type Locale = 'bn' | 'en';
export type MessageKey = keyof typeof en;
export type MessageParams = Readonly<Record<string, string | number>>;

export const CATALOGUES: Record<Locale, Record<MessageKey, string>> = { bn, en };

export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}

/** Interpolates {name} placeholders. Numbers are written with Bangla digits in bn (BR6.5). */
export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const template = CATALOGUES[locale][key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    if (typeof value === 'number')
      return locale === 'bn' ? toBanglaDigits(String(value)) : String(value);
    return value;
  });
}

/** Looks up a key that arrived as a string (e.g. an AppError.i18nKey); unknown keys fall back to a generic error. */
export function translateDynamic(locale: Locale, key: string, params: MessageParams = {}): string {
  return isMessageKey(key) ? translate(locale, key, params) : key;
}
