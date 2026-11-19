// US1.6 Admin staff screen: the staff list, finding an account by email, and giving or taking a
// staff role (Instructor with Employee or Contracted, Admin, Finance). Admins with two-step sign-in
// only (checked again in the service); every change is audit-logged; the last Admin cannot be removed.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { roleFn, typedInput } from '#src/server/fn.ts';
import { getIdentity } from './identity-instance.server.ts';

const NoInput = z.object({}).default({});
const FindInput = z.object({ email: z.email().max(254) });
const AssignInput = z.object({
  userId: z.uuid(),
  role: z.enum(['instructor', 'admin', 'finance']),
  instructorType: z.enum(['employee', 'contractor']).optional(),
});
const RevokeInput = z.object({
  userId: z.uuid(),
  role: z.enum(['instructor', 'admin', 'finance']),
});

export const listStaff = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn('admin', NoInput, async ({ actor }) => getIdentity().staffDirectory(actor)));

export const findStaffCandidate = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof FindInput>())
  .handler(
    roleFn('admin', FindInput, async ({ actor, input }) =>
      getIdentity().findAccountForStaffing(actor, input.email),
    ),
  );

export const assignStaffRole = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof AssignInput>())
  .handler(
    roleFn('admin', AssignInput, async ({ actor, input, correlationId }) =>
      getIdentity().roles.assign(actor, input, correlationId),
    ),
  );

export const revokeStaffRole = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof RevokeInput>())
  .handler(
    roleFn('admin', RevokeInput, async ({ actor, input, correlationId }) =>
      getIdentity().roles.revoke(actor, input, correlationId),
    ),
  );
