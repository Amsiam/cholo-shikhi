import { createFileRoute } from '@tanstack/react-router';
import { getHealth } from '#src/features/platform/server/health-instance.server.ts';

// Readiness: database, Valkey and relay lag. 503 when not ready. Component states only, no personal data.
export const Route = createFileRoute('/api/health/ready')({
  server: {
    handlers: {
      GET: async () => {
        const status = await getHealth().readiness();
        return Response.json(status, {
          status: status.isReady ? 200 : 503,
          headers: { 'cache-control': 'no-store' },
        });
      },
    },
  },
});
