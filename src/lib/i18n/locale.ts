// Interface language rules (BR6.1–BR6.3).
export type Locale = 'bn' | 'en';
export const LOCALES: readonly Locale[] = ['bn', 'en'];

export function isLocale(value: unknown): value is Locale {
  return value === 'bn' || value === 'en';
}

/**
 * Before sign-in: the device's saved language; on a first visit Bangla, unless the browser's
 * preferences rank English above Bangla (BR6.2).
 */
export function resolveDeviceLocale(
  acceptLanguage: string | null | undefined,
  stored: string | null | undefined,
): Locale {
  if (isLocale(stored)) return stored;
  if (!acceptLanguage) return 'bn';
  const ranked = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return {
        lang: tag.toLowerCase().split('-')[0] ?? '',
        q: q ? Number(q.split('=')[1]) : 1,
        index,
      };
    })
    .filter((entry) => entry.lang && !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q || a.index - b.index);
  const first = ranked.find((entry) => entry.lang === 'bn' || entry.lang === 'en');
  return first?.lang === 'en' ? 'en' : 'bn';
}
