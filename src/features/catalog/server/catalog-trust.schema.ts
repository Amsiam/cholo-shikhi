// Schemas for the A9 blocked-domain list (NFR6.210), shared by the Admin form and the server
// functions. The domain grammar (bare host, IDNA to ASCII, no IP or single label) is the domain's.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';
import { MAX_BLOCKED_PAGE } from '../data/blocked-domain.repository.ts';

export const BlockedDomainPageInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_BLOCKED_PAGE).default(20),
});
export type BlockedDomainPageInput = z.input<typeof BlockedDomainPageInput>;

export const AddBlockedDomainInput = z.object({ domain: z.string().trim().min(1).max(300) });
export type AddBlockedDomainInput = z.input<typeof AddBlockedDomainInput>;

export const RemoveBlockedDomainInput = z.object({
  blockedDomainId: Id,
  expectedVersion: z.number().int().min(1),
});
export type RemoveBlockedDomainInput = z.input<typeof RemoveBlockedDomainInput>;
