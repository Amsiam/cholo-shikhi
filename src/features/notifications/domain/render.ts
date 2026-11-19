// Renders a notification in a given language at send or display time (BR12.12, BR12.16).
import { type MessageParams, translate } from '#src/lib/i18n/index.ts';
import { formatMoney, MoneyPoisha } from '#src/lib/money.ts';
import type { NotificationType } from './notification-types.ts';

/** Money params (`*Poisha`) are formatted; account fragments are always masked to the last 4. */
export function displayParams(
  params: Readonly<Record<string, string | number | boolean>>,
  locale: 'bn' | 'en',
): MessageParams {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key.endsWith('Poisha') && typeof value === 'number') {
      const amount = MoneyPoisha.safeParse(value);
      out[key] = amount.success ? formatMoney(amount.data, locale) : '';
    } else if (key.endsWith('Last4')) {
      out[key] = `••••${String(value).replace(/\D/g, '').slice(-4)}`;
    } else {
      out[key] = typeof value === 'boolean' ? String(value) : value;
    }
  }
  return out;
}

export function renderNotification(
  type: NotificationType,
  params: Readonly<Record<string, string | number | boolean>>,
  locale: 'bn' | 'en',
) {
  const values = displayParams(params, locale);
  return {
    title: translate(locale, type.titleKey, values),
    body: translate(locale, type.bodyKey, values),
  };
}

/** BR12.13: a push payload carries only the generic text, in the account language. */
export function pushPayload(locale: 'bn' | 'en'): string {
  return JSON.stringify({ title: translate(locale, 'notify.push.generic') });
}
