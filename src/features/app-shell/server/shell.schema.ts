import { z } from 'zod';

export const NoInput = z.object({}).default({});
export const LanguageInput = z.object({ locale: z.enum(['bn', 'en']) });
