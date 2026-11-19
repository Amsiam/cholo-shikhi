// Security headers (team.md "Security headers and payment callbacks") and BR1.8 no-store.
import { randomBytes } from 'node:crypto';

export const SESSION_COOKIE_MARKER = 'cs.session_token';

/** A fresh, unguessable script nonce per response (128 bits, base64). */
export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

export function contentSecurityPolicy(options: {
  isDevelopment: boolean;
  nonce: string;
  realtimeOrigin?: string;
}): string {
  const connect = [
    "'self'",
    ...(options.realtimeOrigin ? [options.realtimeOrigin] : []),
    ...(options.isDevelopment ? ['ws:', 'wss:'] : []),
  ];
  const directives = [
    "default-src 'self'",
    // No 'unsafe-inline': TanStack Start's inline hydration scripts carry this response's nonce.
    `script-src 'self' 'nonce-${options.nonce}'${options.isDevelopment ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    // The only third-party frame: privacy-enhanced YouTube embeds.
    'frame-src https://www.youtube-nocookie.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
  ];
  return directives.join('; ');
}

export type HeaderOptions = { isProduction: boolean; nonce: string; realtimeOrigin?: string };

export function securityHeaders(options: HeaderOptions): Record<string, string> {
  return {
    'content-security-policy': contentSecurityPolicy({
      isDevelopment: !options.isProduction,
      nonce: options.nonce,
      ...(options.realtimeOrigin ? { realtimeOrigin: options.realtimeOrigin } : {}),
    }),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    // HSTS only where the site is served over HTTPS; never pinned onto localhost.
    ...(options.isProduction
      ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' }
      : {}),
  };
}

export function hasSessionCookie(cookieHeader: string | null): boolean {
  return (cookieHeader ?? '').includes(SESSION_COOKIE_MARKER);
}

/** Returns a copy of the response with the security headers and, for signed-in users, no-store. */
export function withSecurityHeaders(
  response: Response,
  options: HeaderOptions & { isSignedIn: boolean },
): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders(options))) headers.set(name, value);
  // BR1.8: nothing rendered for a signed-in user may be cached (shared phones, Back button).
  if (options.isSignedIn) headers.set('cache-control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
