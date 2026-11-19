// Turns a shared Zod schema into TanStack Form field errors expressed as i18n keys (never raw text).
import type { z } from 'zod';
import { fromZodError } from '#src/lib/errors.ts';

export function schemaFieldErrors(
  schema: z.ZodType,
  value: unknown,
): Record<string, string> | undefined {
  const parsed = schema.safeParse(value);
  if (parsed.success) return undefined;
  const { fieldErrors = {} } = fromZodError(parsed.error);
  return Object.fromEntries(
    Object.entries(fieldErrors).map(([field, keys]) => [
      field,
      keys[0] ?? 'errors.validation.invalid_format',
    ]),
  );
}
