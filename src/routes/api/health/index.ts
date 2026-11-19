import { createFileRoute } from '@tanstack/react-router';

// Liveness: the process is up and serving. Public by design; no data, no dependencies.
export const Route = createFileRoute('/api/health/')({
  server: {
    handlers: {
      GET: () => Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } }),
    },
  },
});
