import { createFileRoute } from '@tanstack/react-router';
import { getIdentity } from '#src/features/identity-access/server/identity-instance.server.ts';

// Better Auth endpoints, behind the IdentityAccess allowlist and custom checks.
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => getIdentity().handler(request),
      POST: ({ request }) => getIdentity().handler(request),
    },
  },
});
