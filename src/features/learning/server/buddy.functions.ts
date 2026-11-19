// Study buddy (S12) server functions: the caller's own invite and pair only.
import { createServerFn } from '@tanstack/react-start';
import { authedFn, typedInput } from '#src/server/fn.ts';
import {
  acceptBuddyInvite,
  cancelBuddyInvite,
  createBuddyInvite,
  endBuddyPair,
  getMyBuddy,
  previewBuddyInvite,
} from './buddy.server.ts';
import { BuddyCodeInput, NoInput } from './learning.schema.ts';

export const getMyStudyBuddy = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => getMyBuddy(actor)));

export const createMyBuddyInvite = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => createBuddyInvite(actor)));

export const cancelMyBuddyInvite = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => cancelBuddyInvite(actor)));

export const previewStudyBuddyInvite = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof BuddyCodeInput>())
  .handler(authedFn(BuddyCodeInput, async ({ actor, input }) => previewBuddyInvite(actor, input)));

export const acceptStudyBuddyInvite = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof BuddyCodeInput>())
  .handler(authedFn(BuddyCodeInput, async ({ actor, input }) => acceptBuddyInvite(actor, input)));

export const endMyStudyBuddy = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => endBuddyPair(actor)));
