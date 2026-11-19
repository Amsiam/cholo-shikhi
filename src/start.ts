// Global request middleware: correlation ID, a per-request CSP nonce, security headers and no-store
// for signed-in users. The nonce reaches the router through the request context (see router.tsx).
import { createMiddleware, createStart } from '@tanstack/react-start';
import { CORRELATION_HEADER, correlationIdFrom, withCorrelation } from '#src/lib/correlation.ts';
import { getEnv, getHttpSecurityConfig } from '#src/lib/env.ts';
import { serverFnCsrfMiddleware, TRUSTED_ORIGINS_CONTEXT_KEY } from '#src/server/csrf.ts';
import { createNonce, hasSessionCookie, withSecurityHeaders } from '#src/server/http-headers.ts';

// Validated once (Zod, src/lib/env.ts); a malformed PUBLIC_REALTIME_URL fails before reaching the CSP.
let cachedSecurityConfig: ReturnType<typeof getHttpSecurityConfig> | undefined;
function securityConfig(): ReturnType<typeof getHttpSecurityConfig> {
  cachedSecurityConfig ??= getHttpSecurityConfig();
  return cachedSecurityConfig;
}

const securityMiddleware = createMiddleware({ type: 'request' }).server(
  async ({ request, next }) => {
    const correlationId = correlationIdFrom(request.headers.get(CORRELATION_HEADER));
    const nonce = createNonce();
    // The CSRF middleware (src/server/csrf.ts) checks Origin/Referer against this explicit list.
    const context = { nonce, [TRUSTED_ORIGINS_CONTEXT_KEY]: getEnv().TRUSTED_ORIGINS };
    const result = await withCorrelation(correlationId, () => next({ context }));
    const response = withSecurityHeaders(result.response, {
      ...securityConfig(),
      isSignedIn: hasSessionCookie(request.headers.get('cookie')),
      nonce,
    });
    response.headers.set(CORRELATION_HEADER, correlationId);
    return response;
  },
);

// CSRF runs inside the security middleware: it receives the trusted origins from it, and a refused
// request still gets the security headers.
export const startInstance = createStart(() => ({
  requestMiddleware: [securityMiddleware, serverFnCsrfMiddleware],
}));
