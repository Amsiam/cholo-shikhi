// Versioned settings registry rules (BR9.1–BR9.5, BR9.9). Definitions are declared in code by the
// owning feature; values are immutable versions. Pure: no DB access here.
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';

export type ValueType = 'integer' | 'boolean' | 'string' | 'poisha' | 'basis_points' | 'record';
type ValueOf<V extends ValueType> = V extends 'boolean'
  ? boolean
  : V extends 'string'
    ? string
    : V extends 'record'
      ? Record<string, unknown>
      : number;

export type RecordField = {
  name: string;
  type: Exclude<ValueType, 'record'>;
  min?: number;
  max?: number;
  referenceValidator?: string;
};

export type SettingDefinition<V extends ValueType = ValueType> = {
  settingKey: string;
  ownerFeature: string;
  valueType: V;
  min?: number;
  max?: number;
  unit?: 'minutes' | 'hours' | 'days' | 'years' | 'count' | 'percent' | 'poisha' | 'basis_points';
  scope: 'global' | 'goal_segment';
  blocksWhenUnset: boolean;
  defaultValue?: ValueOf<V>;
  recordFields?: readonly RecordField[];
  referenceValidator?: string;
};

/** A typed handle used by readers: settings.get(refundWindowDays) returns a number. */
export type SettingKey<T> = SettingDefinition & { readonly __type?: T };

const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

export function defineSetting<V extends ValueType>(
  definition: SettingDefinition<V>,
): SettingKey<ValueOf<V>> & SettingDefinition<V> {
  if (!KEY.test(definition.settingKey))
    throw new Error(`invalid setting key ${definition.settingKey}`);
  if (definition.blocksWhenUnset && definition.defaultValue !== undefined) {
    throw new Error(
      `${definition.settingKey}: blocksWhenUnset and a defaultValue are mutually exclusive`,
    );
  }
  if (
    definition.min !== undefined &&
    definition.max !== undefined &&
    definition.min > definition.max
  ) {
    throw new Error(`${definition.settingKey}: min must be <= max`);
  }
  return definition as SettingKey<ValueOf<V>> & SettingDefinition<V>;
}

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';

/** BR9.2 / BR6.5: Bangla digits typed into numeric inputs are normalised to ASCII. */
export function normaliseDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
}

type FieldSpec = { type: Exclude<ValueType, 'record'>; min?: number; max?: number };

function invalid(field: string, reason: string): AppError<'VALIDATION_FAILED'> {
  return appError('VALIDATION_FAILED', {
    fieldErrors: { [field]: [`errors.validation.${reason}`] },
  });
}

function parseScalar(
  spec: FieldSpec,
  raw: unknown,
  field: string,
): Result<unknown, AppError<'VALIDATION_FAILED'>> {
  if (spec.type === 'boolean') {
    if (typeof raw === 'boolean') return ok(raw);
    if (raw === 'true' || raw === 'false') return ok(raw === 'true');
    return err(invalid(field, 'invalid_type'));
  }
  if (spec.type === 'string') {
    if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > 500)
      return err(invalid(field, 'invalid_type'));
    return ok(raw.trim());
  }
  const text =
    typeof raw === 'number'
      ? String(raw)
      : typeof raw === 'string'
        ? normaliseDigits(raw.trim())
        : '';
  if (!/^-?\d+$/.test(text)) return err(invalid(field, 'invalid_type'));
  const value = Number(text);
  if (!Number.isSafeInteger(value)) return err(invalid(field, 'invalid_type'));
  const min =
    spec.type === 'basis_points'
      ? Math.max(0, spec.min ?? 0)
      : spec.type === 'poisha'
        ? Math.max(0, spec.min ?? 0)
        : spec.min;
  const max = spec.type === 'basis_points' ? Math.min(10_000, spec.max ?? 10_000) : spec.max;
  if (min !== undefined && value < min) return err(invalid(field, 'too_small'));
  if (max !== undefined && value > max) return err(invalid(field, 'too_big'));
  return ok(value);
}

/** Validates and normalises a raw value against its definition (BR9.2). */
export function parseSettingValue(
  definition: SettingDefinition,
  raw: unknown,
): Result<unknown, AppError<'VALIDATION_FAILED'>> {
  if (definition.valueType !== 'record') {
    return parseScalar(
      {
        type: definition.valueType,
        ...(definition.min !== undefined ? { min: definition.min } : {}),
        ...(definition.max !== undefined ? { max: definition.max } : {}),
      },
      raw,
      'value',
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return err(invalid('value', 'invalid_type'));
  const out: Record<string, unknown> = {};
  for (const field of definition.recordFields ?? []) {
    const parsed = parseScalar(
      field,
      (raw as Record<string, unknown>)[field.name],
      `value.${field.name}`,
    );
    if (!parsed.ok) return parsed;
    out[field.name] = parsed.value;
  }
  return ok(out);
}

export type StoredVersion = {
  settingVersionId: string;
  scopeKey: string;
  version: number;
  effectiveFrom: string;
  value: unknown;
};

/** BR9.4: the newest version already in effect for the scope; a segment read falls back to global. */
export function resolveEffective(
  versions: readonly StoredVersion[],
  scopeKey: string,
  now: string,
): StoredVersion | undefined {
  const nowMs = new Date(now).getTime();
  const pick = (scope: string) =>
    versions
      .filter((v) => v.scopeKey === scope && new Date(v.effectiveFrom).getTime() <= nowMs)
      .sort((a, b) => b.version - a.version)[0];
  return pick(scopeKey) ?? (scopeKey === 'global' ? undefined : pick('global'));
}

/** The nil UUID marks a declared default that has never been saved as a version. */
export const DEFAULT_SETTING_VERSION_ID = '00000000-0000-0000-0000-000000000000';
