// React access to the i18n layer: one language at a time (BR6.1), chosen by the root loader.
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { formatMoney, type MoneyPoisha } from '../money.ts';
import { formatDateTime } from '../time.ts';
import { formatDate, formatInteger, formatMarks } from './format.ts';
import { type MessageKey, type MessageParams, translate, translateDynamic } from './index.ts';
import type { Locale } from './locale.ts';

export type I18n = {
  locale: Locale;
  t: (key: MessageKey, params?: MessageParams) => string;
  /** For keys that arrive as data, such as an error's i18nKey. */
  tDynamic: (key: string, params?: MessageParams) => string;
  formatInteger: (value: number) => string;
  formatMarks: (x100: number) => string;
  formatDate: (instant: string) => string;
  formatDateTime: (instant: string) => string;
  formatMoney: (amount: MoneyPoisha) => string;
};

export function createI18n(locale: Locale): I18n {
  return {
    locale,
    t: (key, params) => translate(locale, key, params),
    tDynamic: (key, params) => translateDynamic(locale, key, params),
    formatInteger: (value) => formatInteger(value, locale),
    formatMarks: (x100) => formatMarks(x100, locale),
    formatDate: (instant) => formatDate(instant, locale),
    formatDateTime: (instant) => formatDateTime(instant, locale),
    formatMoney: (amount) => formatMoney(amount, locale),
  };
}

const I18nContext = createContext<I18n>(createI18n('bn'));

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => createI18n(locale), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
