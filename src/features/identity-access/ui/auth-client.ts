// Browser calls to the IdentityAccess HTTP endpoints. Responses carry { code, i18nKey } on failure.
export type AuthOutcome<T = Record<string, unknown>> =
  | { ok: true; body: T }
  | { ok: false; i18nKey: string; fieldErrors?: Record<string, string[]>; isOffline?: boolean };

const KNOWN_PREFIXES = ['errors.common.', 'errors.identity.', 'errors.validation.'];

export async function postAuth<T = Record<string, unknown>>(
  path: string,
  body: unknown,
): Promise<AuthOutcome<T>> {
  // BR3.8 / AC1.2.4: no network means "you're offline", never the incorrect-password message.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, i18nKey: 'errors.network.offline', isOffline: true };
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, i18nKey: 'errors.network.offline', isOffline: true };
  }
  const data = (await response.json().catch(() => ({}))) as {
    i18nKey?: string;
    fieldErrors?: Record<string, string[]>;
  } & T;
  if (response.ok) return { ok: true, body: data };
  const i18nKey =
    data.i18nKey && KNOWN_PREFIXES.some((p) => data.i18nKey?.startsWith(p))
      ? data.i18nKey
      : 'errors.common.INTERNAL_ERROR';
  return { ok: false, i18nKey, ...(data.fieldErrors ? { fieldErrors: data.fieldErrors } : {}) };
}

/** First error key per field from a server-side VALIDATION_FAILED. */
export function firstFieldErrors(
  fieldErrors: Record<string, string[]> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fieldErrors ?? {}).map(([field, keys]) => [
      field,
      keys[0] ?? 'errors.validation.invalid_format',
    ]),
  );
}
