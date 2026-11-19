// US1.6 Admin staff screen: the staff list, finding an account by email, and giving or taking a
// staff role (Instructor with Employee or Contracted, Admin, Finance). Admins with two-step sign-in
// only (checked again in the service); every change is audit-logged; the last Admin cannot be removed.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { publicFn, roleFn, typedInput } from '#src/server/fn.ts';
import { PasswordInput } from './auth.schema.ts';
import { getIdentity } from './identity-instance.server.ts';

const NoInput = z.object({}).default({});
const FindInput = z.object({ email: z.email().max(254) });
const AssignInput = z.object({
  userId: z.uuid(),
  role: z.enum(['instructor', 'admin', 'finance']),
  instructorType: z.enum(['employee', 'contractor']).optional(),
});
const MemberInput = z.object({ userId: z.uuid() });
const InviteInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  locale: z.enum(['bn', 'en']),
  role: z.enum(['instructor', 'admin', 'finance']),
  instructorType: z.enum(['employee', 'contractor']).optional(),
});
const InvitationInput = z.object({ invitationId: z.uuid() });
const TokenInput = z.object({ token: z.string().min(16).max(512) });
const AcceptInviteInput = z.object({ token: z.string().min(16).max(512), password: PasswordInput });
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

/** The staff profile page (/admin/staff/<id>): one staff member's account, roles and role history. */
export const getStaffMember = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof MemberInput>())
  .handler(
    roleFn('admin', MemberInput, async ({ actor, input }) =>
      getIdentity().staffMember(actor, input.userId),
    ),
  );

/** Adds staff by email: gives the role to a verified account, or creates and invites the person. */
export const inviteStaff = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof InviteInput>())
  .handler(
    roleFn('admin', InviteInput, async ({ actor, input, correlationId }) =>
      getIdentity().staffInvites.invite(actor, input, correlationId),
    ),
  );

export const listStaffInvites = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn('admin', NoInput, async ({ actor }) => getIdentity().staffInvites.list(actor)));

export const resendStaffInvite = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof InvitationInput>())
  .handler(
    roleFn('admin', InvitationInput, async ({ actor, input, correlationId }) =>
      getIdentity().staffInvites.resend(actor, input.invitationId, correlationId),
    ),
  );

export const cancelStaffInvite = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof InvitationInput>())
  .handler(
    roleFn('admin', InvitationInput, async ({ actor, input, correlationId }) =>
      getIdentity().staffInvites.cancel(actor, input.invitationId, correlationId),
    ),
  );

/** The invitation page (/staff-invite/<token>): who is invited and as what. The token is the key. */
export const getStaffInvite = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof TokenInput>())
  .handler(
    publicFn(TokenInput, async ({ input }) => getIdentity().staffInvites.preview(input.token)),
  );

/** The invitee sets their password; the account becomes active and the role is given. */
export const acceptStaffInvite = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof AcceptInviteInput>())
  .handler(
    publicFn(AcceptInviteInput, async ({ input }) =>
      getIdentity().staffInvites.accept(input.token, input.password),
    ),
  );
