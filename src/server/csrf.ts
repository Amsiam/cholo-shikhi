// CSRF protection for the app's own server functions (team.md: CSRF and origin checks are never
// disabled). TanStack Start only applies its default CSRF middleware when the app has no start
// instance; ours registers request middleware, so it must add this one explicitly.
//
// Decision order is TanStack's: Sec-Fetch-Site (must be same-origin), else Origin (must be in the
// explicit TRUSTED_ORIGINS list), else Referer (its origin must be trusted). A request carrying none
// of the three is refused.
//
// This module is imported by src/start.ts, which is also bundled for the browser, so it must not
// import server-only code (env.ts reads the filesystem). The trusted origins arrive on the request
// context instead: the security middleware in start.ts reads them from getEnv() in its server-only
// body and passes them to next(). A missing or malformed list trusts no origin (fail closed).
import { createCsrfMiddleware } from '@tanstack/react-start';

export type CsrfOptions = NonNullable<Parameters<typeof createCsrfMiddleware>[0]>;

/** The request-context key the security middleware fills with TRUSTED_ORIGINS. */
export const TRUSTED_ORIGINS_CONTEXT_KEY = 'trustedOrigins';

/** Reads the trusted-origin list from a middleware context; anything unexpected yields []. */
export function trustedOriginsFrom(context: unknown): readonly string[] {
  if (typeof context !== 'object' || context === null) return [];
  const list = (context as Record<string, unknown>)[TRUSTED_ORIGINS_CONTEXT_KEY];
  if (!Array.isArray(list)) return [];
  return list.filter((origin): origin is string => typeof origin === 'string');
}

/** Options for server-function CSRF checks against the context's trusted origins. */
export function serverFnCsrfOptions(): CsrfOptions {
  return {
    filter: (ctx) => ctx.handlerType === 'serverFn',
    secFetchSite: 'same-origin',
    origin: (value, ctx) => trustedOriginsFrom(ctx.context).includes(value),
    referer: true,
    allowRequestsWithoutOriginCheck: false,
  };
}

export const serverFnCsrfMiddleware = createCsrfMiddleware(serverFnCsrfOptions());
