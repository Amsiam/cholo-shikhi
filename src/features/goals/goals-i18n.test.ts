// [LT] Step 3: every Goals and Catalog key exists in both catalogues and none is empty, including
// every i18nKey of the rules.md error-mapping table (team.md Bilingual checks).
import { describe, expect, it } from 'vitest';
import { bn } from '#src/lib/i18n/bn.ts';
import { en } from '#src/lib/i18n/en.ts';
import { catalogueParityProblems } from '#src/lib/i18n/parity.ts';

const RULES_ERROR_KEYS = [
  'errors.catalog.notLead',
  'errors.catalog.notSectionOwner',
  'errors.catalog.durationLocked',
  'errors.catalog.staleVersion',
  'errors.common.NOT_FOUND',
  'errors.catalog.publishPreconditions',
  'errors.catalog.incompleteLessons',
  'errors.catalog.examPackageIncomplete',
  'errors.goals.segmentHasGoals',
  'errors.catalog.captionsNotConfirmed',
  'errors.catalog.questionCheckUnavailable',
] as const;

const U2_PREFIXES = ['goals.', 'catalog.', 'errors.goals.', 'errors.catalog.'];

describe('Goals and Catalog i18n', () => {
  it('has every rules.md error-mapping key in bn and en, non-empty', () => {
    for (const key of RULES_ERROR_KEYS) {
      expect(en[key]?.trim(), `en ${key}`).toBeTruthy();
      expect(bn[key]?.trim(), `bn ${key}`).toBeTruthy();
    }
  });

  it('has the four U2 namespaces with the same keys in both languages', () => {
    for (const prefix of U2_PREFIXES) {
      const enKeys = Object.keys(en).filter((k) => k.startsWith(prefix));
      const bnKeys = Object.keys(bn).filter((k) => k.startsWith(prefix));
      expect(enKeys.length, prefix).toBeGreaterThan(0);
      expect(bnKeys.sort()).toEqual(enKeys.sort());
    }
  });

  it('keeps the Bangla text in Bangla script', () => {
    for (const key of Object.keys(bn).filter((k) => k.startsWith('goals.'))) {
      expect(bn[key as keyof typeof bn], key).toMatch(/[ঀ-৿]/);
    }
  });

  it('passes the global parity check', () => {
    expect(catalogueParityProblems()).toEqual([]);
  });
});
