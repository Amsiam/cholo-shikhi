// settings.get (contract 3) and the Admin save path (BR9.3, BR9.6). The reference-validator port
// (BR9.9) is internal to U1: a later unit registers a named validator; U1 never imports that unit.
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { type AppError, appError, fromZodError } from '#src/lib/errors.ts';
import type { Json } from '#src/lib/json.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import { type Database, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createSettingsRepository } from '../data/settings.repository.ts';
import type { Instrument } from '../domain/instrumentation.ts';
import {
  DEFAULT_SETTING_VERSION_ID,
  parseSettingValue,
  resolveEffective,
  type SettingDefinition,
  type SettingKey,
} from '../domain/settings.ts';
import { createAudit } from './audit.server.ts';
import { SettingChangeInput } from './settings.schema.ts';

export type ReferenceValidator = (value: unknown) => Promise<boolean>;

export function createSettings(deps: {
  db: Database;
  clock: Clock;
  definitions: readonly SettingDefinition[];
  instrument?: Instrument;
}) {
  const repo = createSettingsRepository();
  const audit = createAudit({ clock: deps.clock });
  const definitions = new Map(deps.definitions.map((d) => [d.settingKey, d]));
  const validators = new Map<string, ReferenceValidator>();

  function registerReferenceValidator(name: string, validator: ReferenceValidator): void {
    validators.set(name, validator);
  }

  async function get<T>(
    key: SettingKey<T>,
    scopeKey = 'global',
  ): Promise<Result<{ value: T; settingVersionId: string }, AppError<'SETTING_NOT_SET'>>> {
    const definition = definitions.get(key.settingKey);
    // BR9.1: an undeclared key cannot be read.
    if (!definition) return err(appError('SETTING_NOT_SET', { details: { reason: 'undeclared' } }));
    const versions = (await repo.versions(deps.db, key.settingKey)).map((v) => ({
      ...v,
      effectiveFrom: v.effectiveFrom.toISOString(),
    }));
    const effective = resolveEffective(versions, scopeKey, deps.clock.now());
    if (effective)
      return ok({ value: effective.value as T, settingVersionId: effective.settingVersionId });
    if (definition.blocksWhenUnset || definition.defaultValue === undefined)
      return err(appError('SETTING_NOT_SET'));
    return ok({
      value: definition.defaultValue as T,
      settingVersionId: DEFAULT_SETTING_VERSION_ID,
    });
  }

  async function checkReferences(
    definition: SettingDefinition,
    value: unknown,
  ): Promise<AppError | null> {
    const checks: Array<[string, unknown, string]> = [];
    if (definition.referenceValidator) checks.push([definition.referenceValidator, value, 'value']);
    for (const field of definition.recordFields ?? []) {
      if (field.referenceValidator)
        checks.push([
          field.referenceValidator,
          (value as Record<string, unknown>)[field.name],
          `value.${field.name}`,
        ]);
    }
    for (const [name, fieldValue, field] of checks) {
      const validator = validators.get(name);
      if (!validator)
        return appError('SETTING_VALIDATOR_UNAVAILABLE', {
          namespace: 'platform',
          details: { validator: name },
        });
      if (!(await validator(fieldValue)))
        return appError('VALIDATION_FAILED', {
          fieldErrors: { [field]: ['errors.validation.reference'] },
        });
    }
    return null;
  }

  async function save(
    actor: Actor,
    raw: SettingChangeInput,
    correlationId: string,
  ): Promise<Result<{ settingVersionId: string; version: number }, AppError>> {
    if (!actor.roles.includes('admin') || !actor.hasStepUp) return err(appError('FORBIDDEN'));
    const parsedInput = SettingChangeInput.safeParse(raw);
    if (!parsedInput.success) return err(fromZodError(parsedInput.error));
    const input = parsedInput.data;
    const definition = definitions.get(input.settingKey);
    if (!definition) return err(appError('NOT_FOUND'));
    if (definition.scope === 'global' && input.scopeKey !== 'global') {
      return err(
        appError('VALIDATION_FAILED', {
          fieldErrors: { scopeKey: ['errors.validation.not_allowed'] },
        }),
      );
    }
    const value = parseSettingValue(definition, input.value);
    if (!value.ok) return value;
    const referenceError = await checkReferences(definition, value.value);
    if (referenceError) return err(referenceError);
    const now = new Date(deps.clock.now());
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : now;
    if (effectiveFrom.getTime() < now.getTime()) {
      return err(
        appError('VALIDATION_FAILED', {
          fieldErrors: { effectiveFrom: ['errors.validation.in_past'] },
        }),
      );
    }
    return withTransaction(deps.db, async (tx) => {
      const exec = unwrapTx(tx);
      const previous = await repo.latestForUpdate(exec, input.settingKey, input.scopeKey);
      const version = (previous?.version ?? 0) + 1;
      const row = await repo.insert(exec, {
        settingKey: input.settingKey,
        scopeKey: input.scopeKey,
        value: value.value as Json,
        version,
        effectiveFrom,
        changedBy: actor.userId,
        reason: input.reason,
        createdAt: now,
      });
      await audit.record(tx, {
        actorId: actor.userId,
        action: 'platform.setting.changed',
        subjectType: 'setting',
        subjectId: input.settingKey,
        before: previous
          ? { value: previous.value, version: previous.version, scopeKey: previous.scopeKey }
          : null,
        after: { value: value.value, version, scopeKey: input.scopeKey },
        reason: input.reason,
        correlationId,
      });
      deps.instrument?.emit({
        eventName: 'setting_changed',
        featureArea: 'platform',
        correlationId,
      });
      return ok({ settingVersionId: row.settingVersionId, version });
    });
  }

  function listDefinitions(): SettingDefinition[] {
    return [...definitions.values()];
  }

  return { get, save, registerReferenceValidator, listDefinitions };
}

export type Settings = ReturnType<typeof createSettings>;
