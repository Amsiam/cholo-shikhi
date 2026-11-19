// The signed-in user's own profile: display name and Bangladeshi mobile number (unverified until SMS
// ships, Q15; one account per number). Email changes and verification are out of scope here.
import { z } from 'zod';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { getDb } from '#src/server/db.ts';
import { createIdentityRepository } from '../data/identity.repository.ts';
import type { Actor } from '../domain/actor.schema.ts';
import { normaliseBdPhone } from '../domain/phone.ts';

const repo = createIdentityRepository();

export const UpdateProfileInput = z.object({
  name: z.string().trim().max(80),
  phone: z.string().trim().max(20),
});
export type UpdateProfileInput = z.input<typeof UpdateProfileInput>;

export type Profile = {
  name: string;
  email: string;
  phone: string | null;
  passwordChangedAt: string | null;
};

export async function getMyProfile(actor: Actor): Promise<Result<Profile, AppError<'NOT_FOUND'>>> {
  const row = await repo.profileOf(getDb(), actor.userId);
  if (!row) return err(appError('NOT_FOUND'));
  return ok({
    name: row.name,
    email: row.email,
    phone: row.phone,
    passwordChangedAt: row.passwordChangedAt?.toISOString() ?? null,
  });
}

export async function updateMyProfile(
  actor: Actor,
  raw: UpdateProfileInput,
): Promise<Result<Profile, AppError<'NOT_FOUND' | 'VALIDATION_FAILED' | 'CONFLICT'>>> {
  const input = UpdateProfileInput.parse(raw);
  const phone = input.phone === '' ? null : normaliseBdPhone(input.phone);
  if (input.phone !== '' && phone === null)
    return err(
      appError('VALIDATION_FAILED', { fieldErrors: { phone: ['errors.profile.phoneInvalid'] } }),
    );
  const saved = await repo.updateProfile(
    getDb(),
    actor.userId,
    { name: input.name, phone },
    new Date(),
  );
  if (!saved)
    return err({
      ...appError('CONFLICT'),
      i18nKey: 'errors.profile.phoneTaken',
      fieldErrors: { phone: ['errors.profile.phoneTaken'] },
    });
  return getMyProfile(actor);
}

/** The user's phone number (or null), for other units (free-trial protection). */
export async function phoneOf(userId: string): Promise<string | null> {
  return (await repo.profileOf(getDb(), userId))?.phone ?? null;
}
