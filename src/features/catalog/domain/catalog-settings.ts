// Settings declared by U2 (functional-spec §8). Every price bound blocks when unset and has no
// default: pricing answers SETTING_NOT_SET until an Admin sets it (functional-spec assumptions 10, 21).
// Pure declarations: Platform's settings registry reads them at start-up.
import { defineSetting } from '#src/features/platform/domain/settings.ts';

/** The hard parse ceiling for any poisha amount in U2 (BR5.1): 9,999,999,999 poisha. */
export const PRICE_CEILING_POISHA = 9_999_999_999;

function priceBound(settingKey: string) {
  return defineSetting({
    settingKey,
    ownerFeature: 'catalog',
    valueType: 'poisha',
    min: 1,
    max: PRICE_CEILING_POISHA,
    unit: 'poisha',
    scope: 'global',
    blocksWhenUnset: true,
  });
}

export const CATALOG_SETTINGS = {
  /** BR5.2: the lowest course price an instructor may set. */
  coursePriceMinPoisha: priceBound('catalog.coursePrice.minPoisha'),
  /** BR5.2, BR10.9: the highest course (and Practice Pack) price. */
  coursePriceMaxPoisha: priceBound('catalog.coursePrice.maxPoisha'),
  /** BR5.9: the highest exam package price. */
  examPackagePriceMaxPoisha: priceBound('catalog.examPackagePrice.maxPoisha'),
  /** BR5.9: the highest subscription plan monthly price. */
  planMonthlyPriceMaxPoisha: priceBound('catalog.planMonthlyPrice.maxPoisha'),
} as const;
