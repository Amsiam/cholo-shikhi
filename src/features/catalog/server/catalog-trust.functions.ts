// A9 blocked-domain list server functions (NFR6.210): roleFn('admin'), which requires the staff
// two-step check (U1 BR1.6). No Catalog function is public.
import { createServerFn } from '@tanstack/react-start';
import { roleFn, typedInput } from '#src/server/fn.ts';
import { getCatalog } from './catalog-instance.server.ts';
import {
  AddBlockedDomainInput,
  BlockedDomainPageInput,
  RemoveBlockedDomainInput,
} from './catalog-trust.schema.ts';

export const listBlockedDomains = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof BlockedDomainPageInput>())
  .handler(
    roleFn('admin', BlockedDomainPageInput, async ({ actor, input }) =>
      getCatalog().listBlockedDomains(actor, input),
    ),
  );

export const addBlockedDomain = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof AddBlockedDomainInput>())
  .handler(
    roleFn('admin', AddBlockedDomainInput, async ({ actor, input, correlationId }) =>
      getCatalog().addBlockedDomain(actor, input, correlationId),
    ),
  );

export const removeBlockedDomain = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof RemoveBlockedDomainInput>())
  .handler(
    roleFn('admin', RemoveBlockedDomainInput, async ({ actor, input, correlationId }) =>
      getCatalog().removeBlockedDomain(actor, input, correlationId),
    ),
  );
