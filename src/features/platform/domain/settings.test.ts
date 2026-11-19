// [LT] settings domain rules.
import { describe, expect, it } from 'vitest';
import { defineSetting, normaliseDigits, parseSettingValue, resolveEffective } from './settings.ts';

const days = defineSetting({
  settingKey: 'x.days',
  ownerFeature: 't',
  valueType: 'integer',
  min: 1,
  max: 30,
  scope: 'global',
  blocksWhenUnset: true,
});

describe('defineSetting', () => {
  it('rejects bad keys, default-with-blocking and min > max', () => {
    expect(() => defineSetting({ ...days, settingKey: 'NoDots' })).toThrow();
    expect(() => defineSetting({ ...days, defaultValue: 3 })).toThrow(/mutually exclusive/);
    expect(() => defineSetting({ ...days, min: 5, max: 1 })).toThrow(/min must be/);
  });
});

describe('parseSettingValue (BR9.2)', () => {
  it('normalises Bangla digits', () => {
    expect(normaliseDigits('১২৩')).toBe('123');
    expect(parseSettingValue(days, '১৫')).toEqual({ ok: true, value: 15 });
  });
  it('enforces type and range', () => {
    expect(parseSettingValue(days, '0')).toMatchObject({
      ok: false,
      error: { fieldErrors: { value: ['errors.validation.too_small'] } },
    });
    expect(parseSettingValue(days, 31)).toMatchObject({
      ok: false,
      error: { fieldErrors: { value: ['errors.validation.too_big'] } },
    });
    expect(parseSettingValue(days, '1.5')).toMatchObject({ ok: false });
  });
  it('parses booleans, strings, poisha and basis points', () => {
    const flag = defineSetting({
      settingKey: 'x.flag',
      ownerFeature: 't',
      valueType: 'boolean',
      scope: 'global',
      blocksWhenUnset: false,
      defaultValue: false,
    });
    expect(parseSettingValue(flag, 'true')).toEqual({ ok: true, value: true });
    expect(parseSettingValue(flag, 'yes').ok).toBe(false);
    const text = defineSetting({
      settingKey: 'x.text',
      ownerFeature: 't',
      valueType: 'string',
      scope: 'global',
      blocksWhenUnset: true,
    });
    expect(parseSettingValue(text, '  hi ')).toEqual({ ok: true, value: 'hi' });
    expect(parseSettingValue(text, '').ok).toBe(false);
    const fee = defineSetting({
      settingKey: 'x.fee',
      ownerFeature: 't',
      valueType: 'poisha',
      scope: 'global',
      blocksWhenUnset: true,
    });
    expect(parseSettingValue(fee, '-1').ok).toBe(false);
    const bp = defineSetting({
      settingKey: 'x.share',
      ownerFeature: 't',
      valueType: 'basis_points',
      scope: 'global',
      blocksWhenUnset: true,
    });
    expect(parseSettingValue(bp, '10001').ok).toBe(false);
    expect(parseSettingValue(bp, '2500')).toEqual({ ok: true, value: 2500 });
  });
  it('validates record fields', () => {
    const trial = defineSetting({
      settingKey: 'x.trial',
      ownerFeature: 't',
      valueType: 'record',
      scope: 'goal_segment',
      blocksWhenUnset: true,
      recordFields: [
        { name: 'dayCap', type: 'integer', min: 1 },
        { name: 'lessonCap', type: 'integer', min: 1 },
      ],
    });
    expect(parseSettingValue(trial, { dayCap: '৩', lessonCap: 2 })).toEqual({
      ok: true,
      value: { dayCap: 3, lessonCap: 2 },
    });
    expect(parseSettingValue(trial, { dayCap: 0, lessonCap: 2 })).toMatchObject({
      ok: false,
      error: { fieldErrors: { 'value.dayCap': ['errors.validation.too_small'] } },
    });
    expect(parseSettingValue(trial, 'nope').ok).toBe(false);
  });
});

describe('resolveEffective (BR9.4)', () => {
  const v = (version: number, scopeKey: string, effectiveFrom: string) => ({
    settingVersionId: `v${version}${scopeKey}`,
    scopeKey,
    version,
    effectiveFrom,
    value: version,
  });
  const versions = [
    v(1, 'global', '2026-01-01T00:00:00Z'),
    v(2, 'global', '2027-01-01T00:00:00Z'),
    v(1, 'seg-a', '2026-06-01T00:00:00Z'),
  ];
  it('picks the newest version already in effect', () => {
    expect(resolveEffective(versions, 'global', '2026-12-31T00:00:00Z')?.version).toBe(1);
    expect(resolveEffective(versions, 'global', '2027-01-02T00:00:00Z')?.version).toBe(2);
  });
  it('falls back from a segment to the global value', () => {
    expect(resolveEffective(versions, 'seg-a', '2026-07-01T00:00:00Z')?.scopeKey).toBe('seg-a');
    expect(resolveEffective(versions, 'seg-b', '2026-07-01T00:00:00Z')?.scopeKey).toBe('global');
    expect(resolveEffective([], 'global', '2026-07-01T00:00:00Z')).toBeUndefined();
  });
});
