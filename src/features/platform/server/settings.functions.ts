// Admin settings screen (A10) server functions.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { ok } from '#src/lib/result.ts';
import { roleFn, typedInput } from '#src/server/fn.ts';
import { SettingChangeInput } from './settings.schema.ts';
import { getSettings } from './settings-instance.server.ts';

const NoInput = z.object({}).default({});

export const listSettingDefinitions = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    roleFn('admin', NoInput, async () =>
      ok(
        getSettings()
          .listDefinitions()
          .map((d) => ({
            settingKey: d.settingKey,
            valueType: d.valueType,
            min: d.min ?? null,
            max: d.max ?? null,
            unit: d.unit ?? null,
            blocksWhenUnset: d.blocksWhenUnset,
          })),
      ),
    ),
  );

export const saveSetting = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SettingChangeInput>())
  .handler(
    roleFn('admin', SettingChangeInput, async ({ actor, input, correlationId }) =>
      getSettings().save(actor, input, correlationId),
    ),
  );
