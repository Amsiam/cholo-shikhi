// CSRF for the app's server functions: cross-origin POSTs are refused, same-origin POSTs pass.
// Exercises the real TanStack CSRF middleware built from serverFnCsrfOptions.
import { createCsrfMiddleware } from '@tanstack/react-start';
import { describe, expect, it } from 'vitest';
import { serverFnCsrfMiddleware, serverFnCsrfOptions, trustedOriginsFrom } from './csrf.ts';

const APP = 'http://localhost:3000';
const TRUSTED = [APP, 'http://127.0.0.1:3000'];
const PASSED = new Response('ok', { status: 200 });

type ServerHandler = (ctx: {
  request: Request;
  handlerType: 'serverFn' | 'router';
  context: unknown;
  next: () => Response;
}) => Promise<Response> | Response;

function handlerOf(middleware: unknown): ServerHandler {
  const server = (middleware as { options: { server?: ServerHandler } }).options.server;
  if (!server) throw new Error('CSRF middleware has no server handler');
  return server;
}

const handler = handlerOf(createCsrfMiddleware(serverFnCsrfOptions()));

async function post(
  headers: Record<string, string>,
  handlerType: 'serverFn' | 'router' = 'serverFn',
  context: unknown = { nonce: 'n', trustedOrigins: TRUSTED },
): Promise<number> {
  const request = new Request(`${APP}/_serverFn/abc`, { method: 'POST', headers });
  const response = await handler({ request, handlerType, context, next: () => PASSED });
  return response.status;
}

describe('server-function CSRF middleware', () => {
  it('passes a same-origin POST (Sec-Fetch-Site: same-origin)', async () => {
    expect(await post({ 'sec-fetch-site': 'same-origin', origin: APP })).toBe(200);
  });

  it.each(['cross-site', 'same-site', 'none'])('refuses Sec-Fetch-Site: %s', async (site) => {
    expect(await post({ 'sec-fetch-site': site, origin: APP })).toBe(403);
  });

  it('passes a trusted Origin when Sec-Fetch-Site is absent', async () => {
    expect(await post({ origin: 'http://127.0.0.1:3000' })).toBe(200);
  });

  it('refuses an untrusted Origin', async () => {
    expect(await post({ origin: 'https://evil.example' })).toBe(403);
    expect(await post({ origin: 'null' })).toBe(403);
  });

  it('falls back to Referer and checks its origin against the trusted list', async () => {
    expect(await post({ referer: `${APP}/sign-up?x=1` })).toBe(200);
    expect(await post({ referer: 'https://evil.example/page' })).toBe(403);
    expect(await post({ referer: 'http://localhost:3000.evil.example/' })).toBe(403);
  });

  it('refuses a POST with no Sec-Fetch-Site, Origin or Referer', async () => {
    expect(await post({})).toBe(403);
  });

  it('leaves page (router) requests to the router', async () => {
    expect(await post({ origin: 'https://evil.example' }, 'router')).toBe(200);
  });

  it('trusts no origin when the context carries no valid list (fail closed)', async () => {
    for (const context of [null, {}, { trustedOrigins: 'http://localhost:3000' }]) {
      expect(await post({ origin: APP }, 'serverFn', context)).toBe(403);
      expect(await post({ referer: `${APP}/` }, 'serverFn', context)).toBe(403);
    }
    expect(trustedOriginsFrom({ trustedOrigins: [APP, 42, null] })).toEqual([APP]);
  });

  it('is the middleware registered in start.ts and carries the CSRF marker', () => {
    expect(Object.getOwnPropertySymbols(serverFnCsrfMiddleware).map(String)).toContain(
      'Symbol(tanstack-start:csrf-middleware)',
    );
  });
});
