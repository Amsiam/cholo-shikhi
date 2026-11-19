// Runner check for unit U2 (Step 2): proves the unit project, the synthetic factories and the
// integer-poisha price inputs work before the first acceptance test is written.
import { describe, expect, it } from 'vitest';
import { parseTakaString } from '#src/lib/money.ts';
import {
  buildCourseInput,
  buildGoalInput,
  buildPricePoisha,
  buildSegmentInput,
  buildTakaInput,
  buildTitle,
} from '#src/test/factories/catalog.ts';

describe('catalog unit runner', () => {
  it('builds a bilingual segment and Goal with both names filled', () => {
    const segment = buildSegmentInput({}, 7);
    const goal = buildGoalInput('00000000-0000-4000-8000-000000000001', {}, 7);
    expect(segment.nameBn.trim()).not.toBe('');
    expect(segment.nameEn.trim()).not.toBe('');
    expect(goal.nameBn).toMatch(/[ঀ-৿]/);
    expect(goal.nameEn).toMatch(/[A-Za-z]/);
  });

  it('gives every price as integer poisha', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const price = buildPricePoisha(seed);
      expect(Number.isSafeInteger(price)).toBe(true);
      expect(price % 100).toBe(0);
    }
    expect(Number.isInteger(buildCourseInput('g', 3).pricePoisha)).toBe(true);
  });

  it('writes taka inputs in Latin and Bangla digits that parse back exactly', () => {
    expect(buildTakaInput(150_050)).toBe('1500.50');
    expect(buildTakaInput(150_000, 'bangla')).toBe('১৫০০');
    const parsed = parseTakaString(buildTakaInput(150_050));
    expect(parsed).toEqual({ ok: true, value: 150_050 });
  });

  it('is reproducible for a fixed seed and can leave one language empty', () => {
    const titles = Array.from({ length: 40 }, (_, i) =>
      buildTitle(500 + i, { allowOneEmpty: true }),
    );
    expect(titles.some((t) => t.titleBn === '' || t.titleEn === '')).toBe(true);
    expect(titles.every((t) => t.titleBn !== '' || t.titleEn !== '')).toBe(true);
  });
});
