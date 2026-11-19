// Critical journey S1 → S3 (Step 36; US1.9, US1.10, US2.1): a new Student opens the catalog, is sent
// to S1 to choose a Goal (BR2.1), sees only that Goal's published courses, switches tabs, switches the
// language (html[lang] and the tab labels follow), changes Goal on S12 and sees S3 refresh. axe runs
// on every page, with a longest-string overflow check on the cards and the tabs. Synthetic data on
// the local dev database only (e2e/catalog/seed.ts).
import { expect, test } from '@playwright/test';
import { expectAccessible, gotoHydrated, maybeThrottle } from '../foundation/helpers.ts';
import { resetLocalRateLimits } from '../local-rate-limits.ts';
import { expectNoHorizontalOverflow, newStudent } from './journey.ts';
import { seedCourse, seedGoal } from './seed.ts';

test.use({ locale: 'en-GB' });

test.beforeAll(async () => {
  await resetLocalRateLimits();
});

const LONG_EN =
  'A deliberately long synthetic course title to check that the card wraps without overflow';

test('a Student browses the catalog by Goal', async ({ page }) => {
  await maybeThrottle(page);
  const goalA = await seedGoal('A');
  const goalB = await seedGoal('B');
  const shownA = await seedCourse({
    goalId: goalA.goalId,
    titleBn: 'ই২ই প্রকাশিত কোর্স',
    titleEn: LONG_EN,
    pricePoisha: 149_950,
    months: 6,
    status: 'published',
    lessonTitleEn: 'Introduction',
  });
  await seedCourse({
    goalId: goalA.goalId,
    titleBn: 'ই২ই খসড়া কোর্স',
    titleEn: 'E2E draft course',
    pricePoisha: 99_900,
    months: 4,
    status: 'draft',
    lessonTitleEn: 'Hidden',
  });
  const shownB = await seedCourse({
    goalId: goalB.goalId,
    titleBn: 'ই২ই অন্য লক্ষ্যের কোর্স',
    titleEn: 'E2E course of goal B',
    pricePoisha: 250_000,
    months: 12,
    status: 'published',
    lessonTitleEn: 'Welcome',
  });

  await newStudent(page);

  // S3 with no Goal sends the Student to S1 (BR2.1, UC1 E1).
  await gotoHydrated(page, '/catalog');
  await expect(page.getByTestId('goals-page')).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel(goalA.nameEn).or(page.getByLabel(goalA.nameBn)).click();
  await page.getByTestId('goal-picker-confirm').click();
  await expect(page).toHaveURL(/\/$/);

  // S3: the Student starts on their own Goal, so only Goal A's published course is listed.
  await gotoHydrated(page, '/catalog');
  await expect(page.getByTestId('catalog-page')).toBeVisible();
  const cards = page.getByTestId('catalog-card-link');
  await expect(page.locator(`a[href="/courses/${shownA.courseId}"]`)).toBeVisible();
  await expect(page.locator(`a[href="/courses/${shownB.courseId}"]`)).toHaveCount(0);
  await expect(cards).toHaveCount(1);
  await expectAccessible(page);
  await expectNoHorizontalOverflow(
    page,
    '[data-testid="catalog-card"], [data-testid="catalog-search"]',
  );

  // Search: a title fragment finds the course; a miss explains itself and clears back.
  await page.getByTestId('catalog-search-input').fill(LONG_EN.slice(0, 12));
  await page.getByTestId('catalog-search-submit').click();
  await expect(page).toHaveURL(/q=/);
  await expect(cards).toHaveCount(1);
  await page.getByTestId('catalog-search-input').fill('zzzz-no-such-course');
  await page.getByTestId('catalog-search-submit').click();
  await expect(page.getByTestId('catalog-empty')).toBeVisible();
  await expectAccessible(page);
  await page.getByTestId('catalog-empty-clear').click();
  await expect(cards).toHaveCount(1);

  // "Change exam" reopens the picker without changing the Student's Goal.
  await page.getByTestId('catalog-change-exam').click();
  await expect(page.getByTestId('catalog-exam-picker')).toBeVisible();
  await expectAccessible(page);

  // Language switch on Me: html[lang] and the tab labels follow.
  await page.getByTestId('nav-me').click();
  const before = await page.locator('html').getAttribute('lang');
  const target = before === 'bn' ? 'en' : 'bn';
  await page.getByTestId(`language-switcher-${target}`).click();
  await expect(page.locator('html')).toHaveAttribute('lang', target);
  await gotoHydrated(page, '/catalog');
  await expect(page.locator('html')).toHaveAttribute('lang', target);
  await expect(page.getByTestId('catalog-search-submit')).toHaveText(
    target === 'bn' ? 'খুঁজুন' : 'Search',
  );
  await expectAccessible(page);
  await expectNoHorizontalOverflow(
    page,
    '[data-testid="catalog-card"], [data-testid="catalog-search"]',
  );

  // Change Goal on S12, then S3 shows Goal B's course instead.
  await gotoHydrated(page, '/me/goal');
  await page.getByLabel(goalB.nameBn).or(page.getByLabel(goalB.nameEn)).click();
  await page.getByTestId('goal-change-open').click();
  await page.getByTestId('goal-change-confirm').click();
  await expect(page.getByTestId('goal-change-done')).toBeVisible();
  await expectAccessible(page);
  await gotoHydrated(page, '/catalog');
  await expect(page.locator(`a[href="/courses/${shownB.courseId}"]`)).toBeVisible();
  await expect(page.locator(`a[href="/courses/${shownA.courseId}"]`)).toHaveCount(0);
  await expectAccessible(page);
});
