// Critical journey S3 → S4 (Step 36; US2.2, AC2.1.3): from the catalog the Student opens a course and
// sees the price through the active locale, the instructors and the outline with no preview playback;
// an unpublished course URL is not-found. Every catalog response is no-store and Cache Storage holds
// no U2 responses (NFR6.220). axe on every page. Synthetic data on the local dev database only.
import { expect, test } from '@playwright/test';
import { expectAccessible, gotoHydrated, maybeThrottle } from '../foundation/helpers.ts';
import { resetLocalRateLimits } from '../local-rate-limits.ts';
import {
  expectNoCatalogResponsesCached,
  expectNoHorizontalOverflow,
  newStudent,
} from './journey.ts';
import { seedCourse, seedGoal } from './seed.ts';

test.use({ locale: 'en-GB' });

test.beforeAll(async () => {
  await resetLocalRateLimits();
});

test('a Student opens a course page from the catalog', async ({ page }) => {
  await maybeThrottle(page);
  const goal = await seedGoal('S4');
  const course = await seedCourse({
    goalId: goal.goalId,
    titleBn: 'ই২ই কোর্স পাতা',
    titleEn: 'E2E course page',
    pricePoisha: 149_950,
    months: 6,
    status: 'published',
    lessonTitleEn: 'Introduction',
  });
  const draft = await seedCourse({
    goalId: goal.goalId,
    titleBn: 'ই২ই অপ্রকাশিত',
    titleEn: 'E2E unpublished',
    pricePoisha: 99_900,
    months: 4,
    status: 'draft',
    lessonTitleEn: 'Never shown',
  });

  const cacheHeaders: Array<{ url: string; cacheControl: string | undefined }> = [];
  page.on('response', (response) => {
    const url = response.url();
    if (
      /_serverFn|\/catalog|\/courses\//.test(url) &&
      response.request().resourceType() !== 'script'
    )
      cacheHeaders.push({ url, cacheControl: response.headers()['cache-control'] });
  });

  await newStudent(page);
  await gotoHydrated(page, '/goals');
  await page.getByLabel(goal.nameEn).or(page.getByLabel(goal.nameBn)).click();
  await page.getByTestId('goal-picker-confirm').click();
  await expect(page).toHaveURL(/\/$/);

  await gotoHydrated(page, '/catalog');
  await page.locator(`a[href="/courses/${course.courseId}"]`).click();
  await expect(page.getByTestId('course-page')).toBeVisible();
  const lang = await page.locator('html').getAttribute('lang');
  await expect(page.getByTestId('course-page-price')).toHaveText(
    lang === 'bn' ? '৳১,৪৯৯.৫০' : '৳1,499.50',
  );
  await expect(page.getByTestId('course-page-instructor')).toContainText('E2E Lead');
  await expect(page.getByTestId('course-page-section')).toHaveCount(1);
  await expect(page.getByTestId('course-page-lesson')).toHaveCount(1);
  // BR7.5: titles only, no preview playback; the cover is a placeholder (catalog.imageUploads off).
  await expect(page.locator('video, iframe')).toHaveCount(0);
  await expect(page.getByTestId('course-page-cover-placeholder')).toBeVisible();
  await expect(page.getByTestId('course-page-buy')).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page, '[data-testid="course-page"]');

  // An unpublished course by URL answers not-found (AC2.1.3, BR4.4).
  await gotoHydrated(page, `/courses/${draft.courseId}`);
  await expect(page.getByTestId('course-not-found')).toBeVisible();
  await expect(page.getByTestId('course-page')).toHaveCount(0);
  await expectAccessible(page);

  // NFR6.220: every catalog document and server-function response is no-store; nothing is cached.
  expect(cacheHeaders.length).toBeGreaterThan(0);
  for (const entry of cacheHeaders)
    expect(entry, entry.url).toMatchObject({ cacheControl: 'no-store' });
  await expectNoCatalogResponsesCached(page);
});
