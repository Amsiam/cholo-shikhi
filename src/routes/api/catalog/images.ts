import { createFileRoute } from '@tanstack/react-router';
import { getImageUploads } from '#src/features/catalog/server/catalog-images-instance.server.ts';

// Cover and inline image uploads (NFR6.212–NFR6.215). Behind catalog.imageUploads (default off);
// every check runs before the body is read, and without an approved decoder it fails closed.
export const Route = createFileRoute('/api/catalog/images')({
  server: {
    handlers: {
      POST: ({ request }) => getImageUploads().handle(request),
    },
  },
});
