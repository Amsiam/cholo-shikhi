// [LT] Step 3: U2's settings, flags and Catalog event schemas (functional-spec §8, SD-226, NFR5.203).
import { describe, expect, it } from 'vitest';
import { evaluateFlag } from '#src/features/platform/domain/flags.ts';
import { parseSettingValue } from '#src/features/platform/domain/settings.ts';
import { freeTextPaths } from '#src/test/schema-inspect.ts';
import {
  CATALOG_EVENTS,
  ContentVisibilityChangedV1,
  CoursePublishedV1,
} from './catalog-events.schema.ts';
import { CATALOG_FLAG_DEFAULTS, CATALOG_FLAGS } from './catalog-flags.ts';
import { CATALOG_SETTINGS, PRICE_CEILING_POISHA } from './catalog-settings.ts';
import { ceilingSettingFor } from './pricing.ts';

const ID = '7d3c2a43-6a3e-4f43-9a52-5f0f5c1c2b11';
const AT = '2026-11-16T06:00:00.000Z';

describe('catalog settings (functional-spec §8)', () => {
  const definitions = Object.values(CATALOG_SETTINGS);

  it('declares the four price bounds with their exact keys', () => {
    expect(definitions.map((d) => d.settingKey).sort()).toEqual([
      'catalog.coursePrice.maxPoisha',
      'catalog.coursePrice.minPoisha',
      'catalog.examPackagePrice.maxPoisha',
      'catalog.planMonthlyPrice.maxPoisha',
    ]);
  });

  it.each(definitions)('$settingKey blocks when unset and has no default', (definition) => {
    expect(definition.blocksWhenUnset).toBe(true);
    expect(definition.defaultValue).toBeUndefined();
    expect(definition.valueType).toBe('poisha');
    expect(definition.scope).toBe('global');
    expect(definition.ownerFeature).toBe('catalog');
    expect(definition.min).toBe(1);
    expect(definition.max).toBe(PRICE_CEILING_POISHA);
  });

  it('accepts integer poisha in range, including Bangla digits', () => {
    const def = CATALOG_SETTINGS.coursePriceMaxPoisha;
    expect(parseSettingValue(def, 1)).toEqual({ ok: true, value: 1 });
    expect(parseSettingValue(def, PRICE_CEILING_POISHA)).toEqual({
      ok: true,
      value: PRICE_CEILING_POISHA,
    });
    expect(parseSettingValue(def, '১৫০০০০')).toEqual({ ok: true, value: 150_000 });
  });

  it('refuses zero, above the ceiling and fractional values', () => {
    const def = CATALOG_SETTINGS.coursePriceMinPoisha;
    expect(parseSettingValue(def, 0).ok).toBe(false);
    expect(parseSettingValue(def, PRICE_CEILING_POISHA + 1).ok).toBe(false);
    expect(parseSettingValue(def, '12.5').ok).toBe(false);
  });
});

describe('catalog flags', () => {
  it('declares catalog.bundlesTab, catalog.imageUploads and catalog.unpublish (CR-5 fallback), all default off', () => {
    expect(Object.values(CATALOG_FLAGS).sort()).toEqual([
      'catalog.bundlesTab',
      'catalog.imageUploads',
      'catalog.unpublish',
    ]);
    expect(Object.values(CATALOG_FLAG_DEFAULTS)).toEqual(['off', 'off', 'off']);
  });

  it.each(Object.values(CATALOG_FLAGS))('%s is off until an Admin saves it', (flagKey) => {
    expect(evaluateFlag(undefined, { userId: ID, roles: ['admin'] })).toEqual({
      isEnabled: false,
      reason: 'unknown',
    });
    expect(flagKey.startsWith('catalog.')).toBe(true);
  });
});

describe('catalog event schemas (SD-226)', () => {
  it.each(CATALOG_EVENTS)('$type v$version has no free-text field', ({ schema }) => {
    expect(freeTextPaths(schema)).toEqual([]);
  });

  it('uses the U1 outbox type format', () => {
    for (const event of CATALOG_EVENTS) {
      expect(event.type).toMatch(/^[a-z][a-z0-9-]*\.[A-Z][A-Za-z0-9]*$/);
    }
  });

  it('refuses a payload that carries a title or any other extra field', () => {
    const payload = {
      courseId: ID,
      goalId: ID,
      action: 'published',
      actorId: ID,
      occurredAt: AT,
    } as const;
    expect(CoursePublishedV1.safeParse(payload).success).toBe(true);
    expect(CoursePublishedV1.safeParse({ ...payload, title: 'BCS Maths' }).success).toBe(false);
    expect(
      ContentVisibilityChangedV1.safeParse({
        courseId: ID,
        contentRef: { type: 'lesson', id: ID, url: 'https://x.example' },
        takedownNoticeId: ID,
        action: 'hide',
        occurredAt: AT,
      }).success,
    ).toBe(false);
  });
});

describe('product price ceilings (BR5.9, BR10.9)', () => {
  it('names a declared setting for each product ceiling', () => {
    expect(ceilingSettingFor('exam_package')).toBe(
      CATALOG_SETTINGS.examPackagePriceMaxPoisha.settingKey,
    );
    expect(ceilingSettingFor('subscription_plan')).toBe(
      CATALOG_SETTINGS.planMonthlyPriceMaxPoisha.settingKey,
    );
    expect(ceilingSettingFor('practice_pack')).toBe(
      CATALOG_SETTINGS.coursePriceMaxPoisha.settingKey,
    );
  });
});
