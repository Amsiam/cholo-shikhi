// Profile server functions: the caller's own name and phone only.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authedFn, typedInput } from '#src/server/fn.ts';
import { getMyProfile, UpdateProfileInput, updateMyProfile } from './profile.server.ts';

const NoInput = z.object({});

export const getMyProfileDetails = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => getMyProfile(actor)));

export const saveMyProfile = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof UpdateProfileInput>())
  .handler(authedFn(UpdateProfileInput, async ({ actor, input }) => updateMyProfile(actor, input)));
