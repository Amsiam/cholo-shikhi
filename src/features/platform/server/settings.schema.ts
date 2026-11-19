import { z } from 'zod';

/** One schema for the Admin settings form and the server. */
export const SettingChangeInput = z.object({
  settingKey: z.string().min(3).max(120),
  scopeKey: z.string().min(1).max(100).default('global'),
  value: z.union([
    z.string().max(500),
    z.number(),
    z.boolean(),
    z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  ]),
  reason: z.string().trim().min(3).max(500),
  effectiveFrom: z.iso.datetime().optional(),
});
export type SettingChangeInput = z.input<typeof SettingChangeInput>;
