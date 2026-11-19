// [LT] security headers and AC1.4.2 no-store for authenticated responses.
import { describe, expect, it } from 'vitest';
import {
  contentSecurityPolicy,
  createNonce,
  hasSessionCookie,
  withSecurityHeaders,
} from './http-headers.ts';

describe('security headers', () => {
  it('limits frames to youtube-nocookie and forbids being framed', () => {
    const csp = contentSecurityPolicy({ isDevelopment: false, nonce: 'n0nce' });
    expect(csp).toContain('frame-src https://www.youtube-nocookie.com');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(contentSecurityPolicy({ isDevelopment: true, nonce: 'n0nce' })).toContain('ws:');
  });

  it('sends HSTS in production only, and nosniff always', () => {
    const prod = withSecurityHeaders(new Response('x'), {
      isProduction: true,
      isSignedIn: false,
      nonce: 'n',
    });
    const dev = withSecurityHeaders(new Response('x'), {
      isProduction: false,
      isSignedIn: false,
      nonce: 'n',
    });
    expect(prod.headers.get('strict-transport-security')).toContain('max-age=31536000');
    expect(dev.headers.get('strict-transport-security')).toBeNull();
    expect(dev.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('AC1.4.2 marks every response to a signed-in user as no-store and keeps status and body', async () => {
    const res = withSecurityHeaders(
      new Response('page', { status: 201, headers: { 'cache-control': 'public, max-age=60' } }),
      { isProduction: false, isSignedIn: true, nonce: 'n' },
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('page');
  });

  it('detects the session cookie by name', () => {
    expect(hasSessionCookie('__Secure-cs.session_token=abc; x=1')).toBe(true);
    expect(hasSessionCookie('cs_locale=bn')).toBe(false);
    expect(hasSessionCookie(null)).toBe(false);
  });
});

describe('script nonce (no unsafe-inline)', () => {
  it('script-src carries the nonce and never unsafe-inline, in production and development', () => {
    for (const isDevelopment of [false, true]) {
      const scriptSrc =
        contentSecurityPolicy({ isDevelopment, nonce: 'abc123' })
          .split('; ')
          .find((d) => d.startsWith('script-src')) ?? '';
      expect(scriptSrc).toContain("'nonce-abc123'");
      expect(scriptSrc).not.toContain('unsafe-inline');
    }
  });
  it('creates a different 128-bit nonce each time', () => {
    const a = createNonce();
    expect(Buffer.from(a, 'base64')).toHaveLength(16);
    expect(createNonce()).not.toBe(a);
  });
  it('allows the real-time origin for WebSocket connections', () => {
    expect(
      contentSecurityPolicy({
        isDevelopment: false,
        nonce: 'n',
        realtimeOrigin: 'wss://rt.example.test',
      }),
    ).toContain("connect-src 'self' wss://rt.example.test");
  });
});
