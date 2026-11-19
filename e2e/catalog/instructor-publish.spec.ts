// Critical journey I1 (Step 29): an instructor signs in with two-step, creates a course, sets the
// price in Bangla digits and the access duration, adds a section and a text lesson, approves their own
// section and publishes. axe runs on every page. Synthetic data only: a fresh @example.test account,
// with the instructor role, a Goal and the Admin price bounds seeded on the local dev database.
// Bolt 4 adds the carry-over: a Student of the course's Goal then sees it in S3 (AC3.0.1, AC3.8.1).
import { expect, type Page, test } from '@playwright/test';
import { totpCode } from '../../src/features/identity-access/domain/totp.ts';
import { expectAccessible, gotoHydrated, maybeThrottle } from '../foundation/helpers.ts';
import { resetLocalRateLimits } from '../local-rate-limits.ts';
import { newStudent, signUpAndVerify } from './journey.ts';
import { grantInstructor, seedGoalAndPriceBounds } from './seed.ts';

test.use({ locale: 'en-GB' });

test.beforeAll(async () => {
  await resetLocalRateLimits();
});

async function signInWithTwoStep(page: Page, email: string, password: string) {
  // The new staff role makes the open session pending two-step, so the app asks to sign in again.
  await gotoHydrated(page, '/sign-in');
  await expect(page.getByTestId('sign-in-page')).toBeVisible();
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(password);
  await page.getByTestId('sign-in-submit').click();
  // Staff must enrol the authenticator on the first staff sign-in (U1 BR1.6).
  await gotoHydrated(page, '/two-step');
  await expect(page.getByTestId('two-step-enrol')).toBeVisible();
  await expectAccessible(page);
  await page.getByTestId('two-step-start').click();
  const key = ((await page.getByTestId('two-step-setup-key').textContent()) ?? '').replace(
    /\s+/g,
    '',
  );
  await page.getByTestId('two-step-code').fill(totpCode(key, new Date().toISOString()));
  await page.getByTestId('two-step-confirm').click();
  await expect(page.getByTestId('two-step-recovery-codes')).toBeVisible();
  await page.getByTestId('two-step-recovery-saved').click();
}

test('an instructor builds and publishes a course', async ({ page, browser }) => {
  await maybeThrottle(page);
  const email = `e2e.instructor.${Date.now().toString(36)}@example.test`;
  const password = 'E2e-synthetic-password-1';

  await signUpAndVerify(page, email, password);
  const userId = await grantInstructor(email);
  const { goalNameEn } = await seedGoalAndPriceBounds(userId);
  await signInWithTwoStep(page, email, password);

  // I1 list and the new-course form.
  await gotoHydrated(page, '/instructor/courses');
  await expect(page.getByTestId('instructor-courses-page')).toBeVisible();
  await expectAccessible(page);
  await page.getByTestId('new-course-form-goal').getByText(goalNameEn).click();
  await page.getByTestId('new-course-form-title-bn').fill('ই২ই কোর্স');
  await page.getByTestId('new-course-form-title-en').fill('E2E course');
  await page.getByTestId('new-course-form-add-section').click();
  await page.getByTestId('new-course-form-section-title-bn').first().fill('প্রথম অংশ');
  await page.getByTestId('new-course-form-section-title-en').first().fill('First section');
  await page.getByTestId('new-course-form-submit').click();

  // Course page: price in Bangla digits (BR5.1), duration, description.
  await expect(page.getByTestId('course-editor')).toBeVisible();
  await expectAccessible(page);
  await page.getByTestId('course-editor-price-input').fill('১৪৯৯.৫০');
  await page.getByTestId('course-editor-price-submit').click();
  await expect(page.getByTestId('course-editor-price-current').first()).toContainText('1,499.50');
  await page.getByTestId('course-editor-duration').getByText('6 months').click();
  // Each course write bumps Course.version (BR12.1): wait for the save, then load the page afresh
  // so the next write carries the new version.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('_serverFn') && r.request().method() === 'POST'),
    page.getByTestId('course-editor-duration-submit').click(),
  ]);
  await gotoHydrated(page, page.url());
  await page.getByTestId('course-description-en').fill('A synthetic course for the e2e journey.');
  await page.getByTestId('course-description-save').click();
  await expect(page.getByTestId('course-description-saved')).toBeVisible();

  // The section page: one text lesson with a body, then the Lead approves their own section.
  await page.getByTestId('section-row-open').first().click();
  await expect(page.getByTestId('section-content-editor')).toBeVisible();
  await expectAccessible(page);
  await page.getByTestId('lesson-add-form-title-en').fill('Introduction');
  await page.getByTestId('lesson-add-form-submit').click();
  await expect(page.getByTestId('lesson-row')).toHaveCount(1);
  await page
    .getByTestId('lesson-body-en-input')
    .fill('## Welcome\n\nThis lesson introduces the course.');
  await expect(page.getByTestId('lesson-body-en-preview').locator('h2')).toHaveText('Welcome');
  await page.getByTestId('lesson-body-en-save').click();
  await expect(page.getByTestId('lesson-row-complete')).toHaveText('Complete');
  await page.getByTestId('review-panel-selfApprove').click();
  await expect(page.getByTestId('review-panel-state')).toContainText('Approved');
  await expectAccessible(page);

  // Publish from the course page.
  await page.getByTestId('section-content-back-link').click();
  await expect(page.getByTestId('publish-panel')).toBeVisible();
  await page.getByTestId('publish-panel-publish').click();
  await page.getByTestId('publish-panel-confirm-confirm').click();
  await expect(page.getByTestId('publish-panel-message')).toHaveText('Published.');
  await expect(page.getByTestId('course-editor-status')).toContainText('Published');
  await expectAccessible(page);
  const courseId = new URL(page.url()).pathname.split('/').at(-1) as string;

  // The course appears in S3 for its Goal (AC3.0.1, AC3.8.1), for a Student in a separate session.
  const studentContext = await browser.newContext({ locale: 'en-GB' });
  const student = await studentContext.newPage();
  await maybeThrottle(student);
  await newStudent(student);
  await gotoHydrated(student, '/goals');
  await student
    .getByLabel(goalNameEn)
    .or(student.getByLabel(/ই২ই লক্ষ্য/))
    .first()
    .click();
  await student.getByTestId('goal-picker-confirm').click();
  await expect(student).toHaveURL(/\/$/);
  await gotoHydrated(student, '/catalog');
  await expect(student.locator(`a[href="/courses/${courseId}"]`)).toBeVisible();
  await expectAccessible(student);
  await studentContext.close();
});
