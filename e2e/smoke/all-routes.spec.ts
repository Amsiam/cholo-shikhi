// Smoke crawl: every page route, as each role, must render without breaking.
// Fails on a 5xx response, the root error screen, an uncaught page error or a console error, and
// lists every failure at once. Roles: anonymous, the seeded demo Student (purchases, progress), and
// fresh synthetic Instructor, Admin and Finance accounts that enrol two-step with the app's own TOTP.
// Route parameters come from the LOCAL dev database (seeded demo data). Synthetic accounts only.
import { expect, type Page, test } from '@playwright/test';
import { totpCode } from '../../src/features/identity-access/domain/totp.ts';
import { signUpAndVerify } from '../catalog/journey.ts';
import { withLocalDb } from '../catalog/seed.ts';
import { gotoHydrated } from '../foundation/helpers.ts';
import { resetLocalRateLimits } from '../local-rate-limits.ts';

test.describe.configure({ mode: 'serial' });
test.setTimeout(15 * 60_000);

const PASSWORD = 'E2e-synthetic-password-1';
const DEMO_STUDENT = { email: 'student@example.test', password: 'DemoStudent2026!' };

type Ids = Record<string, string | undefined>;
let ids: Ids = {};

/** One real ID per route parameter, from the seeded dev database. */
async function loadIds(): Promise<Ids> {
  return withLocalDb(async (c) => {
    const one = async (sql: string, params: unknown[] = []) =>
      (await c.query<{ v: string }>(sql, params)).rows[0]?.v;
    const student = await one(
      `SELECT user_id::text v FROM user_account WHERE email_normalised = $1`,
      [DEMO_STUDENT.email],
    );
    const demoInstructor = await one(
      `SELECT user_id::text v FROM user_account WHERE email_normalised = 'demo.instructor2@example.test'`,
    );
    const learnCourse = await one(
      `SELECT course_id::text v FROM enrolment WHERE user_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1`,
      [student],
    );
    return {
      courseId: await one(
        `SELECT course_id::text v FROM course WHERE status = 'published' AND title_en NOT LIKE 'E2E %' ORDER BY created_at LIMIT 1`,
      ),
      learnCourse,
      lessonId: await one(
        `SELECT l.lesson_id::text v FROM lesson l JOIN section s ON s.section_id = l.section_id
          WHERE s.course_id = $1 AND l.live_state <> 'never_published' ORDER BY s.position LIMIT 1`,
        [learnCourse],
      ),
      paymentId: await one(
        `SELECT payment_id::text v FROM payment WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [student],
      ),
      instructorCourse: await one(
        `SELECT DISTINCT s.course_id::text v FROM ownership_period o JOIN section s ON s.section_id = o.section_id
          WHERE o.instructor_id = $1 LIMIT 1`,
        [demoInstructor],
      ),
      sectionId: await one(
        `SELECT o.section_id::text v FROM ownership_period o WHERE o.instructor_id = $1 LIMIT 1`,
        [demoInstructor],
      ),
      battleId: await one(
        `SELECT battle_id::text v FROM battle ORDER BY created_at DESC LIMIT 1`,
      ).catch(() => undefined),
      bundleId: await one(`SELECT bundle_id::text v FROM bundle LIMIT 1`).catch(() => undefined),
      bundleOrderId: await one(`SELECT order_id::text v FROM bundle_order LIMIT 1`).catch(
        () => undefined,
      ),
      examId: await one(`SELECT exam_id::text v FROM exam ORDER BY created_at DESC LIMIT 1`).catch(
        () => undefined,
      ),
      attemptId: await one(
        `SELECT attempt_id::text v FROM exam_attempt WHERE user_id = $1 LIMIT 1`,
        [student],
      ).catch(() => undefined),
      liveClassId: await one(`SELECT live_class_id::text v FROM live_class LIMIT 1`).catch(
        () => undefined,
      ),
      referralCode: await one(`SELECT code v FROM referral_code LIMIT 1`).catch(() => undefined),
    };
  });
}

/** Every page route; parameters filled from `ids` (or a random UUID, which must be handled too). */
function routes(): string[] {
  const any = '00000000-0000-4000-8000-000000000000';
  const v = (k: string) => ids[k] ?? any;
  const month = new Date().toISOString().slice(0, 7);
  return [
    '/',
    '/sign-in',
    '/sign-up',
    '/verify',
    '/reset-password',
    `/reset-password/not-a-real-token`,
    '/two-step',
    '/goals',
    '/catalog',
    '/store',
    `/courses/${v('courseId')}`,
    `/courses/${any}`,
    `/bundles/${v('bundleId')}`,
    `/r/${v('referralCode')}`,
    '/dev/mailbox',
    '/me',
    '/me/goal',
    '/me/purchases',
    `/me/purchases/${v('paymentId')}`,
    '/me/results',
    '/me/streak',
    '/me/buddy',
    '/me/refer',
    '/notifications',
    '/learn',
    `/learn/${v('learnCourse')}`,
    `/learn/${v('learnCourse')}/lessons/${v('lessonId')}`,
    '/practice',
    '/vault',
    '/questions',
    '/exams',
    `/exams/${v('examId')}`,
    `/exams/result/${v('attemptId')}`,
    '/battles',
    `/battles/${v('battleId')}`,
    '/live',
    `/live/${v('liveClassId')}`,
    `/checkout/${v('paymentId')}`,
    `/checkout/bundle/${v('bundleOrderId')}`,
    `/checkout/order/${any}`,
    '/instructor',
    '/instructor/courses',
    `/instructor/courses/${v('instructorCourse')}`,
    `/instructor/courses/${v('instructorCourse')}/sections/${v('sectionId')}`,
    `/instructor/courses/${v('instructorCourse')}/stats`,
    '/instructor/earnings',
    '/instructor/payouts',
    `/instructor/cycles/${month}`,
    `/instructor/statements/${month}`,
    '/bank',
    '/exam-builder',
    `/exam-builder/${v('examId')}`,
    '/live-host',
    `/live-host/${v('liveClassId')}`,
    '/battle-host',
    '/admin',
    '/admin/staff',
    '/admin/goals',
    '/admin/topics',
    '/admin/plans',
    '/admin/exam-packages',
    '/admin/blocked-domains',
    '/admin/finance',
    '/admin/refunds',
    '/admin/switches',
    '/admin/rewards',
    '/admin/kyc',
    '/admin/payouts',
    '/admin/takedowns',
    '/admin/past-papers',
    '/admin/marketing',
    '/admin/disputes',
    '/admin/attribution',
    '/admin/fraud',
    '/admin/hr',
    '/admin/referrals',
  ];
}

type Failure = { role: string; path: string; problem: string };

/** Visits each route and records anything that breaks. */
async function crawl(page: Page, role: string): Promise<Failure[]> {
  const failures: Failure[] = [];
  let current = '';
  page.on('pageerror', (e) =>
    failures.push({ role, path: current, problem: `pageerror: ${e.message}` }),
  );
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Expected HTTP refusals for a role (401/403/404 on a resource) are not breakage.
    if (/status of (401|403|404)/.test(text)) return;
    failures.push({ role, path: current, problem: `console: ${text.slice(0, 300)}` });
  });
  for (const path of routes()) {
    current = path;
    try {
      const response = await page.goto(path, { waitUntil: 'load', timeout: 45_000 });
      const status = response?.status() ?? 0;
      if (status >= 500) failures.push({ role, path, problem: `HTTP ${status}` });
      await page
        .locator('html[data-hydrated="true"]')
        .waitFor({ timeout: 30_000 })
        .catch(() => {
          failures.push({ role, path, problem: 'never hydrated' });
        });
      await page.waitForTimeout(300);
      if (await page.getByTestId('root-error').count())
        failures.push({ role, path, problem: 'root error screen' });
    } catch (e) {
      failures.push({ role, path, problem: `navigation: ${(e as Error).message.slice(0, 200)}` });
    }
  }
  return failures;
}

async function signIn(page: Page, email: string, password: string) {
  await gotoHydrated(page, '/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 30_000 });
}

/** A fresh synthetic account with a staff role, signed in with two-step enrolled. */
async function newStaff(page: Page, role: 'instructor' | 'admin' | 'finance') {
  const email = `e2e.${role}.${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.test`;
  await signUpAndVerify(page, email, PASSWORD);
  await withLocalDb((c) =>
    c.query(
      `INSERT INTO staff_role_assignment (user_id, role, instructor_type, assigned_by)
       SELECT user_id, $2, CASE WHEN $2 = 'instructor' THEN 'employee' END, user_id
         FROM user_account WHERE email_normalised = $1`,
      [email, role],
    ),
  );
  // Staff sign-in leaves the session pending two-step, so the page does not move on by itself.
  await gotoHydrated(page, '/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(PASSWORD);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-in'), { timeout: 30_000 }),
    page.getByTestId('sign-in-submit').click(),
  ]);
  await gotoHydrated(page, '/two-step');
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

const all: Failure[] = [];

test.beforeAll(async () => {
  await resetLocalRateLimits();
  ids = await loadIds();
});

test('anonymous visitor', async ({ page }) => {
  all.push(...(await crawl(page, 'anonymous')));
});

test('demo student', async ({ page }) => {
  await signIn(page, DEMO_STUDENT.email, DEMO_STUDENT.password);
  all.push(...(await crawl(page, 'student')));
});

for (const role of ['instructor', 'admin', 'finance'] as const) {
  test(`${role} with two-step`, async ({ page }) => {
    try {
      await newStaff(page, role);
    } catch (e) {
      all.push({ role, path: '(sign-in)', problem: (e as Error).message.slice(0, 300) });
      return;
    }
    all.push(...(await crawl(page, role)));
  });
}

test.afterAll(() => {
  expect(all, `${all.length} route problems:\n${JSON.stringify(all, null, 1)}`).toEqual([]);
});
