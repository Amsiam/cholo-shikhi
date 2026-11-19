// Admin settings screen (A10) server functions.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { ok } from '#src/lib/result.ts';
import { roleFn, typedInput } from '#src/server/fn.ts';
import { DEFAULT_SETTING_VERSION_ID } from '../domain/settings.ts';
import { SettingChangeInput } from './settings.schema.ts';
import { getSettings } from './settings-instance.server.ts';

const NoInput = z.object({}).default({});

/** A scalar shown on the settings screen; a record value is sent as its JSON text. */
type ShownValue = boolean | number | string;

const shown = (value: unknown): ShownValue =>
  typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'
    ? value
    : JSON.stringify(value);

/**
 * Where a setting stands now: a value (saved by an Admin, or the declared default), not set yet, or
 * set separately for each goal segment (then only the default is shown here).
 */
export type SettingCurrent =
  | { kind: 'value'; value: ShownValue; isDefault: boolean }
  | { kind: 'notSet' }
  | { kind: 'perSegment'; defaultValue: ShownValue | null };

export const listSettingDefinitions = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    roleFn('admin', NoInput, async () => {
      const settings = getSettings();
      const rows = await Promise.all(
        settings.listDefinitions().map(async (d) => {
          let current: SettingCurrent;
          if (d.scope !== 'global') {
            current = {
              kind: 'perSegment',
              defaultValue: d.defaultValue === undefined ? null : shown(d.defaultValue),
            };
          } else {
            const read = await settings.get(d);
            current = read.ok
              ? {
                  kind: 'value',
                  value: shown(read.value.value),
                  isDefault: read.value.settingVersionId === DEFAULT_SETTING_VERSION_ID,
                }
              : { kind: 'notSet' };
          }
          return {
            settingKey: d.settingKey,
            valueType: d.valueType,
            min: d.min ?? null,
            max: d.max ?? null,
            unit: d.unit ?? null,
            blocksWhenUnset: d.blocksWhenUnset,
            current,
          };
        }),
      );
      return ok(rows);
    }),
  );

export const saveSetting = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SettingChangeInput>())
  .handler(
    roleFn('admin', SettingChangeInput, async ({ actor, input, correlationId }) =>
      getSettings().save(actor, input, correlationId),
    ),
  );
