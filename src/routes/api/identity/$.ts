import { createFileRoute } from '@tanstack/react-router';
import { getIdentity } from '#src/features/identity-access/server/identity-instance.server.ts';

// IdentityAccess's own endpoints (e.g. resend-verification).
export const Route = createFileRoute('/api/identity/$')({
  server: {
    handlers: {
      POST: ({ request }) => getIdentity().handler(request),
    },
  },
});
