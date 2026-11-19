// One shared Zod schema per auth mutation: used by the forms (TanStack Form) and by the server.
import { z } from 'zod';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** BR2.2: lower-cased, trimmed full address; plus tags and dots are kept. */
export const EmailInput = z
  .string()
  .trim()
  .max(254)
  .transform((v) => v.toLowerCase())
  .pipe(z.email());

export const PasswordInput = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

export const SignUpInput = z.object({
  email: EmailInput,
  password: PasswordInput,
  name: z.string().trim().max(80).default(''),
  locale: z.enum(['bn', 'en']).default('bn'),
});
export type SignUpInput = z.input<typeof SignUpInput>;

/** Sign-in never reveals which field was wrong, so its schema only checks shape. */
export const SignInInput = z.object({
  email: z
    .string()
    .trim()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(PASSWORD_MAX),
});
export type SignInInput = z.input<typeof SignInInput>;

export const ResetRequestInput = z.object({ email: EmailInput });
export const ResetPasswordInput = z.object({
  token: z.string().min(16).max(512),
  newPassword: PasswordInput,
});
export const ResendVerificationInput = z.object({ email: EmailInput });
export const LocaleInput = z.object({ locale: z.enum(['bn', 'en']) });
export const TwoFactorCodeInput = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});
export const RecoveryCodeInput = z.object({ code: z.string().trim().min(10).max(24) });
