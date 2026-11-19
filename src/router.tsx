import { createRouter } from '@tanstack/react-router';
import { getGlobalStartContext } from '@tanstack/react-start';
import { routeTree } from './routeTree.gen';

/** The per-request CSP nonce set by the request middleware (src/start.ts); undefined in the browser. */
function requestNonce(): string | undefined {
  const context = getGlobalStartContext() as { nonce?: string } | undefined;
  return context?.nonce;
}

export function getRouter() {
  const nonce = requestNonce();
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    // Start applies this nonce to every inline hydration and body script it renders.
    ...(nonce ? { ssr: { nonce } } : {}),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
