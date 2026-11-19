// R-01: every exported server function, called through its real builder and handler with the app's
// own singletons (IdentityAccess, Platform, Notifications) on a per-file schema and real Better Auth
// sessions. Only the Start transport is replaced: the request and cookie writes come from the test.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpCode } from '#src/features/identity-access/domain/totp.ts';
import { resetEnvForTests } from '#src/lib/env.ts';
import { type AuthHarness, createAuthHarness, TEST_AUTH_ENV } from '#src/test/auth-harness.ts';
import { TEST_ORIGIN } from '#src/test/browser.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { type DeclaredAccess, overrideServerFnRuntimeForTests } from './fn.ts';

type Invoke = (opts: {
  data?: unknown;
}) => Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>;
type ServerFn = { serverFnAccess: DeclaredAccess; invoke: Invoke };

/** The declared access every server function must have. A new server function must be added here. */
const EXPECTED: Record<string, DeclaredAccess> = {
  listAuditLog: 'role:admin',
  listHrInstructors: 'role:admin|finance',
  findHrInstructor: 'role:admin|finance',
  getInstructorHr: 'role:admin|finance',
  savePayPolicyVersion: 'role:admin|finance',
  saveEmployeeRecord: 'role:admin|finance',
  recordInstructorLeave: 'role:admin|finance',
  listFraudQueue: 'role:admin',
  flagFraudAccount: 'role:admin',
  decideFraudFlag: 'role:admin',
  listAttributionCases: 'role:admin|finance',
  getAttributionCourse: 'role:admin|finance',
  openAttributionCase: 'role:admin|finance',
  resolveAttributionCase: 'role:admin|finance',
  postAttributionReassignments: 'role:admin|finance',
  listPaymentDisputes: 'role:admin|finance',
  recordPaymentDispute: 'role:admin|finance',
  getDisputeEvidencePack: 'role:admin|finance',
  exportDisputeEvidencePack: 'role:admin|finance',
  getMarketingOverview: 'role:admin',
  createCampaign: 'role:admin',
  createPromoCode: 'role:admin',
  setPromoCodeActive: 'role:admin',
  createBundle: 'role:admin',
  listMyCampaignBanners: 'authed',
  listGoalBundles: 'public',
  listStaff: 'role:admin',
  getStaffMember: 'role:admin',
  getInstructorEarnings: 'role:admin',
  getInstructorPayoutCycles: 'role:admin',
  getInstructorCycleStatement: 'role:admin',
  getInstructorKyc: 'role:admin',
  listTakedownNotices: 'role:admin',
  importPastPaperQuestions: 'role:admin',
  getMySwitchOptions: 'authed',
  requestMyCourseSwitch: 'authed',
  listSwitchRequests: 'role:admin',
  decideSwitchRequest: 'role:admin',
  getTakedownTargets: 'role:admin',
  logTakedownNotice: 'role:admin',
  decideTakedownNotice: 'role:admin',
  findStaffCandidate: 'role:admin',
  assignStaffRole: 'role:admin',
  revokeStaffRole: 'role:admin',
  listFlags: 'role:admin',
  saveFlag: 'role:admin',
  listSettingDefinitions: 'role:admin',
  saveSetting: 'role:admin',
  listDeadLetters: 'role:admin',
  resolveDeadLetter: 'role:admin',
  listMyNotifications: 'authed',
  getMyUnreadCount: 'authed',
  markMyNotificationsRead: 'authed',
  setNotificationPreference: 'authed',
  getShellState: 'public',
  setLanguage: 'public',
  getTwoStepState: 'public',
  startTwoStepEnrolment: 'public',
  confirmTwoStepEnrolment: 'public',
  verifyTwoStepCode: 'public',
  redeemTwoStepRecoveryCode: 'public',
  getDevMailbox: 'public',
  // U2 Goals (NFR6.201): Admin functions with step-up, Student functions signed-in; only the
  // public catalog goal picker is public.
  listSegments: 'role:admin',
  saveSegment: 'role:admin',
  deleteSegment: 'role:admin',
  listGoalsAdmin: 'role:admin',
  saveGoal: 'role:admin',
  retireGoal: 'role:admin',
  getCurrentGoal: 'authed',
  listActiveGoals: 'authed',
  // The public catalog's goal picker: read-only, explicitly public.
  listPublicGoals: 'public',
  chooseGoal: 'authed',
  changeGoal: 'authed',
  // U2 Catalog core (NFR6.201): instructors and Admins with step-up; course-level checks (Lead,
  // Co-instructor, owner) run in the service. None public.
  createCourse: 'role:admin|instructor',
  listMyCourses: 'role:admin|instructor',
  getCourseForEditing: 'role:admin|instructor',
  setCoursePrice: 'role:admin|instructor',
  setAccessDuration: 'role:admin|instructor',
  assignSection: 'role:admin|instructor',
  removeCoInstructor: 'role:admin|instructor',
  editSectionTitle: 'role:admin|instructor',
  addSection: 'role:admin|instructor',
  reorderSections: 'role:admin|instructor',
  removeSection: 'role:admin|instructor',
  cancelSectionRemoval: 'role:admin|instructor',
  // U2 Catalog content, review and publish (Bolt 3): authoring with step-up; the blocked-domain
  // list is Admin-only (NFR6.210). None public.
  getSectionForEditing: 'role:admin|instructor',
  addLesson: 'role:admin|instructor',
  editLesson: 'role:admin|instructor',
  saveTextLessonBody: 'role:admin|instructor',
  reorderLessons: 'role:admin|instructor',
  removeLesson: 'role:admin|instructor',
  submitSection: 'role:admin|instructor',
  approveSection: 'role:admin|instructor',
  returnSection: 'role:admin|instructor',
  selfApproveSection: 'role:admin|instructor',
  reopenSection: 'role:admin|instructor',
  getPublishReadiness: 'role:admin|instructor',
  publishCourse: 'role:admin|instructor',
  unpublishCourse: 'role:admin|instructor',
  retireCourse: 'role:admin|instructor',
  setCourseDescription: 'role:admin|instructor',
  listBlockedDomains: 'role:admin',
  addBlockedDomain: 'role:admin',
  removeBlockedDomain: 'role:admin',
  // U2 Catalog BR4.7: only an Admin (with step-up) changes a course's Lead.
  changeLead: 'role:admin',
  // U2 Catalog browse (Bolt 4): S3 and S4 reads need a signed-in user; pins are Admin-only with
  // step-up (BR11.11). The public catalog reads below are the only public ones.
  listCatalog: 'authed',
  getCoursePage: 'authed',
  // The public catalog: published items of an active Goal only, explicitly public and read-only.
  searchCatalogCourses: 'public',
  getPublicCoursePage: 'public',
  // Commerce (fake gateway) and learning: signed-in only; ownership and enrolment checked in the
  // service (NOT_FOUND for another Student's payment or a course without an active enrolment).
  startCourseCheckout: 'authed',
  getMyCheckout: 'authed',
  settleMyFakePayment: 'authed',
  getMyEnrolmentStatus: 'authed',
  getMyPurchases: 'authed',
  getMyReceipt: 'authed',
  startMyTrial: 'authed',
  getMyProfileDetails: 'authed',
  saveMyProfile: 'authed',
  // Question bank (U4): staff authoring and review; Admin-only taxonomy.
  getQuestionTaxonomy: 'role:admin|instructor',
  saveQuestionSubject: 'role:admin',
  saveQuestionTopic: 'role:admin',
  listBankQuestions: 'role:admin|instructor',
  getBankQuestionForEditing: 'role:admin|instructor',
  saveBankQuestionDraft: 'role:admin|instructor',
  reviewBankQuestionAction: 'role:admin|instructor',
  getMyPracticeTopics: 'authed',
  startMyPractice: 'authed',
  answerMyPracticeQuestion: 'authed',
  // Exams (U4): staff builder; Students take their own attempts.
  listExamsForStaff: 'role:admin|instructor',
  getExamForStaff: 'role:admin|instructor',
  saveExamDraft: 'role:admin|instructor',
  drawExamQuestionSet: 'role:admin|instructor',
  publishExamForStudents: 'role:admin|instructor',
  retireExamForStudents: 'role:admin|instructor',
  attachExamToMyCourse: 'role:admin|instructor',
  getMyExams: 'authed',
  createMyPracticeExam: 'authed',
  startMyExam: 'authed',
  saveMyExamAnswer: 'authed',
  submitMyExam: 'authed',
  getMyExamResult: 'authed',
  exploreQuestionBank: 'authed',
  // Battles (U7): Students play; staff schedule hosted battles.
  getMyBattleHome: 'authed',
  findQuickMatch: 'authed',
  createBattleRoom: 'authed',
  joinBattleRoom: 'authed',
  joinHostedBattle: 'authed',
  startBattleRoom: 'authed',
  leaveMyBattle: 'authed',
  getMyBattle: 'authed',
  answerBattleQuestion: 'authed',
  finishMyBattle: 'authed',
  scheduleHostedBattle: 'role:admin|instructor',
  listMyHostedBattles: 'role:admin|instructor',
  // Refunds: the Student asks, an Admin decides.
  requestMyRefund: 'authed',
  getMyResults: 'authed',
  startProductOrder: 'authed',
  getMyProductOrder: 'authed',
  settleMyFakeProductOrder: 'authed',
  getMyProductOrders: 'authed',
  getMyEntitlements: 'authed',
  // Bundles (US8.5): the bundle page is public; buying is the Student's own.
  getBundleOffer: 'public',
  startBundleOrder: 'authed',
  getMyBundleOrder: 'authed',
  settleMyFakeBundleOrder: 'authed',
  // Referrals (US8.6): a Student's own link; anyone may open a link.
  getMyReferral: 'authed',
  openReferralLink: 'public',
  // US8.8/US8.9: the referrer's own payout details; the owner-operator approves payouts.
  getMyReferralPayout: 'authed',
  declareReferrerAdult: 'authed',
  submitMyReferrerKyc: 'authed',
  saveMyReferrerPayoutAccount: 'authed',
  requestReferralWithdrawal: 'authed',
  getReferralAdmin: 'role:admin',
  decideReferralWithdrawal: 'role:admin',
  // Live classes (U8): course staff schedule and run; Students join and answer.
  listStaffLiveClasses: 'role:admin|instructor',
  scheduleLiveClass: 'role:admin|instructor',
  cancelLiveClass: 'role:admin|instructor',
  getLiveControl: 'role:admin|instructor',
  fireLiveQuiz: 'role:admin|instructor',
  getMyLiveClasses: 'authed',
  getLiveRoom: 'authed',
  sendLiveHeartbeat: 'authed',
  answerLiveQuestion: 'authed',
  listRefundRequests: 'role:admin',
  decideRefundRequest: 'role:admin',
  getMyTrialStatus: 'authed',
  listTrialCourseOffers: 'role:admin',
  setSegmentTrialCourse: 'role:admin',
  clearSegmentTrialCourse: 'role:admin',
  listMyLearningCourses: 'authed',
  getMyLearningCourse: 'authed',
  getMyLesson: 'authed',
  completeMyLesson: 'authed',
  answerMyCourseNps: 'authed',
  dismissMyBadgeNotice: 'authed',
  // KYC and payout accounts: instructors their own; the queue, decisions and photos Finance/Admin.
  getMyKycStatus: 'role:instructor',
  submitMyKyc: 'role:instructor',
  saveMyPayoutAccount: 'role:instructor',
  listKycQueue: 'role:admin|finance',
  decideKycItem: 'role:admin|finance',
  getKycDocument: 'role:admin|finance',
  // Payout cycles: Finance and Admins run them; paying is Admin-only (two-step checked in the service).
  getPayoutsOverview: 'role:admin|finance',
  dryRunPayoutCycle: 'role:admin|finance',
  commitPayoutCycle: 'role:admin|finance',
  recordPayoutPayment: 'role:admin',
  recordPayoutFailure: 'role:admin|finance',
  releaseHeldPayout: 'role:admin|finance',
  getMyPayoutCycles: 'role:admin|instructor',
  getMyCycleStatement: 'role:admin|instructor',
  submitMyQuiz: 'authed',
  getMyLearningSummary: 'authed',
  // Mistake Vault: the caller's own vault only (scoped by user ID in every query).
  getMyVault: 'authed',
  getMyVaultSession: 'authed',
  answerMyVaultQuestion: 'authed',
  getMyGoalStreak: 'authed',
  // Streak-shields and streak-tokens: the caller's own; the amounts are Admin settings.
  getMyStreakRewards: 'authed',
  getRewardSettings: 'role:admin',
  // Study buddies: the caller's own invite and pair.
  getMyStudyBuddy: 'authed',
  createMyBuddyInvite: 'authed',
  cancelMyBuddyInvite: 'authed',
  previewStudyBuddyInvite: 'authed',
  acceptStudyBuddyInvite: 'authed',
  endMyStudyBuddy: 'authed',
  // Instructor authoring of video and quiz lessons (section owner or Admin, checked in the service).
  setLessonVideo: 'role:admin|instructor',
  getQuizForEditing: 'role:admin|instructor',
  saveQuizQuestions: 'role:admin|instructor',
  // Course statistics and earnings (course membership checked in the service); platform books.
  getCourseStats: 'role:admin|instructor',
  getMyInstructorEarnings: 'role:admin|instructor',
  getMyTeachingDashboard: 'role:admin|instructor',
  getMyEarningStatementMonths: 'role:admin|instructor',
  getMyEarningStatement: 'role:admin|instructor',
  getPlatformBooks: 'role:admin',
  setPinRank: 'role:admin',
  clearPinRank: 'role:admin',
  // U2 Catalog products (Bolt 5): exam packages and plans are Admin products with step-up
  // (BR10.11); Practice Packs are the course Lead's, an instructor with step-up (BR10.9).
  listExamPackagesAdmin: 'role:admin',
  saveExamPackage: 'role:admin',
  publishExamPackage: 'role:admin',
  unpublishExamPackage: 'role:admin',
  retireExamPackage: 'role:admin',
  listPlansAdmin: 'role:admin',
  listPlanItemCandidates: 'role:admin',
  savePlan: 'role:admin',
  publishPlan: 'role:admin',
  unpublishPlan: 'role:admin',
  retirePlan: 'role:admin',
  listPracticePacks: 'role:instructor',
  savePracticePack: 'role:instructor',
  publishPracticePack: 'role:instructor',
};

/** The Admin-only product functions of U2 Bolt 5: also refused to Finance and an Instructor. */
const PRODUCT_ADMIN_FNS = [
  'listExamPackagesAdmin',
  'saveExamPackage',
  'publishExamPackage',
  'unpublishExamPackage',
  'retireExamPackage',
  'listPlansAdmin',
  'listPlanItemCandidates',
  'savePlan',
  'publishPlan',
  'unpublishPlan',
  'retirePlan',
];

const modules = import.meta.glob('/src/**/server/*.functions.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;
const sources = import.meta.glob('/src/**/server/*.functions.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const fns: Record<string, ServerFn> = {};
for (const exported of Object.values(modules)) {
  for (const [name, value] of Object.entries(exported)) {
    if (typeof value === 'function' && 'serverFnAccess' in value)
      fns[name] = value as unknown as ServerFn;
  }
}
const declaredNames = Object.values(sources).flatMap((src) =>
  [...src.matchAll(/export const (\w+) = createServerFn/g)].map((m) => m[1] as string),
);

let t: TestDatabase;
let h: AuthHarness;
let currentRequest: Request;
const cookiesSet: string[] = [];
let restore: () => void;

const anonymous = () =>
  new Request(`${TEST_ORIGIN}/_serverFn`, { headers: { origin: TEST_ORIGIN } });
async function call(name: string, request: Request, data: unknown = {}) {
  currentRequest = request;
  const fn = fns[name];
  if (!fn) throw new Error(`no server function ${name}`);
  return fn.invoke({ data });
}

let student: { request: Request; userId: string };
let otherStudent: { request: Request; userId: string };
let admin: { request: Request; userId: string };
let finance: { request: Request; userId: string };
let instructor: { request: Request; userId: string };

beforeAll(async () => {
  t = await createTestDatabase();
  // Point the app's own singletons (getEnv, getDb, getIdentity…) at this file's schema and the
  // harness's auth secrets, so sessions made by the harness are valid for the real wiring.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: `${t.connectionString}?options=-c%20search_path%3D${t.schemaName}`,
    APP_BASE_URL: TEST_AUTH_ENV.APP_BASE_URL,
    BETTER_AUTH_SECRET: TEST_AUTH_ENV.BETTER_AUTH_SECRET,
    IDENTIFIER_HASH_KEY: TEST_AUTH_ENV.IDENTIFIER_HASH_KEY,
    TOTP_ENCRYPTION_KEY: TEST_AUTH_ENV.TOTP_ENCRYPTION_KEY,
    KYC_ENCRYPTION_KEY: TEST_AUTH_ENV.KYC_ENCRYPTION_KEY,
    CATALOG_CURSOR_KEYS: TEST_AUTH_ENV.CATALOG_CURSOR_KEYS,
    TRUSTED_ORIGINS: TEST_ORIGIN,
  });
  resetEnvForTests();
  restore = overrideServerFnRuntimeForTests({
    getRequest: () => currentRequest,
    setCookie: (name, value) => {
      cookiesSet.push(`${name}=${value}`);
    },
  });
  h = await createAuthHarness(t);
  const a = await h.verifiedStudent();
  const b = await h.verifiedStudent();
  student = { request: a.browser.request('/'), userId: a.userId };
  otherStudent = { request: b.browser.request('/'), userId: b.userId };
  // An Admin with two-step done in this session.
  const boss = await h.verifiedStudent();
  await h.identity.bootstrapAdmin(boss.userId);
  const browser = h.browser();
  await h.signIn(browser, boss.person.email, boss.person.password);
  const enrol = await h.identity.twoFactor.beginEnrolment(browser.request('/'));
  if (!enrol.ok) throw new Error(enrol.error.code);
  await h.identity.twoFactor.confirmEnrolment(
    browser.request('/'),
    totpCode(enrol.value.secret, h.clock.now()),
  );
  admin = { request: browser.request('/'), userId: boss.userId };
  // Staff with two-step done, assigned by that Admin: the wrong roles for Admin work.
  async function staff(role: 'finance' | 'instructor') {
    const person = await h.verifiedStudent();
    const assigned = await h.identity.roles.assign(
      { userId: boss.userId, roles: ['student', 'admin'], locale: 'en', hasStepUp: true },
      role === 'instructor'
        ? { userId: person.userId, role, instructorType: 'employee' }
        : { userId: person.userId, role },
      `authz-assign-${role}`,
    );
    if (!assigned.ok) throw new Error(assigned.error.code);
    const staffBrowser = h.browser();
    await h.signIn(staffBrowser, person.person.email, person.person.password);
    const staffEnrol = await h.identity.twoFactor.beginEnrolment(staffBrowser.request('/'));
    if (!staffEnrol.ok) throw new Error(staffEnrol.error.code);
    await h.identity.twoFactor.confirmEnrolment(
      staffBrowser.request('/'),
      totpCode(staffEnrol.value.secret, h.clock.now()),
    );
    return { request: staffBrowser.request('/'), userId: person.userId };
  }
  finance = await staff('finance');
  instructor = await staff('instructor');
});
afterAll(async () => {
  restore();
  const { closeDb } = await import('./db.ts');
  await closeDb();
  await t.drop();
});

describe('declared access of every server function', () => {
  it('finds all 248 server functions and every one has an expected-access entry', () => {
    expect(new Set(declaredNames)).toEqual(new Set(Object.keys(fns)));
    expect(Object.keys(fns).sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(Object.keys(fns)).toHaveLength(248);
  });

  it.each(Object.entries(EXPECTED))('%s is built with %s', (name, access) => {
    expect(fns[name]?.serverFnAccess).toBe(access);
  });
});

const ADMIN_FNS = Object.entries(EXPECTED)
  .filter(([, a]) => a === 'role:admin')
  .map(([n]) => n);
const AUTHED_FNS = Object.entries(EXPECTED)
  .filter(([, a]) => a === 'authed')
  .map(([n]) => n);
const TWO_STEP_FNS: Array<[string, unknown]> = [
  ['startTwoStepEnrolment', {}],
  ['confirmTwoStepEnrolment', { code: '123456' }],
  ['verifyTwoStepCode', { code: '123456' }],
  ['redeemTwoStepRecoveryCode', { code: 'AAAA-BBBB-CCCC' }],
];

describe('Admin-only functions (roleFn admin)', () => {
  it.each(ADMIN_FNS)('%s refuses an anonymous caller with UNAUTHENTICATED', async (name) => {
    expect(await call(name, anonymous())).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
  it.each(ADMIN_FNS)('%s refuses the wrong role (a Student) with FORBIDDEN', async (name) => {
    expect(await call(name, student.request)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
  it('lets an Admin with two-step through (positive control)', async () => {
    expect((await call('listFlags', admin.request)).ok).toBe(true);
    expect((await call('listSettingDefinitions', admin.request)).ok).toBe(true);
    expect((await call('listAuditLog', admin.request, { page: 1, pageSize: 5 })).ok).toBe(true);
    expect((await call('listDeadLetters', admin.request, {})).ok).toBe(true);
    // Past the access checks, the shared schema and the domain still apply.
    expect(await call('saveFlag', admin.request, { flagKey: 'bad key' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(
      await call('resolveDeadLetter', admin.request, {
        outboxDeliveryId: randomUUID(),
        action: 'replay',
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('U2 product Admin functions refuse the other staff roles', () => {
  it.each(PRODUCT_ADMIN_FNS)('%s refuses Finance with FORBIDDEN', async (name) => {
    expect(await call(name, finance.request)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
  it.each(PRODUCT_ADMIN_FNS)('%s refuses an Instructor with FORBIDDEN', async (name) => {
    expect(await call(name, instructor.request)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});

const INSTRUCTOR_FNS = Object.entries(EXPECTED)
  .filter(([, a]) => a === 'role:instructor')
  .map(([n]) => n);

describe('instructor-only functions (roleFn instructor)', () => {
  it.each(INSTRUCTOR_FNS)('%s refuses an anonymous caller with UNAUTHENTICATED', async (name) => {
    expect(await call(name, anonymous())).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
  it.each(INSTRUCTOR_FNS)(
    '%s refuses the wrong role (a Student, Finance, an Admin) with FORBIDDEN',
    async (name) => {
      for (const caller of [student, finance, admin]) {
        expect(await call(name, caller.request)).toMatchObject({
          ok: false,
          error: { code: 'FORBIDDEN' },
        });
      }
    },
  );
});

const AUTHORING_FNS = Object.entries(EXPECTED)
  .filter(([, a]) => a === 'role:admin|instructor')
  .map(([n]) => n);

describe('authoring functions (roleFn instructor or admin)', () => {
  it.each(AUTHORING_FNS)('%s refuses an anonymous caller with UNAUTHENTICATED', async (name) => {
    expect(await call(name, anonymous())).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
  it.each(AUTHORING_FNS)('%s refuses the wrong role (a Student) with FORBIDDEN', async (name) => {
    expect(await call(name, student.request)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});

describe('signed-in functions (authedFn)', () => {
  it.each(AUTHED_FNS)('%s refuses an anonymous caller with UNAUTHENTICATED', async (name) => {
    expect(await call(name, anonymous(), { page: 1, pageSize: 5 })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it("never shows or changes another user's notifications (wrong user)", async () => {
    await t.pool.query(
      `INSERT INTO notification (recipient_user_id, type_key, dedupe_key, params, requested_channels, resolved_channels, status, source_event_id)
       VALUES ($1, 'notify.account.welcome', 'authz-dedupe-1', '{}', '{in_app}', '{in_app}', 'created', gen_random_uuid())`,
      [student.userId],
    );
    const theirs = await call('listMyNotifications', otherStudent.request, {
      page: 1,
      pageSize: 20,
    });
    expect(theirs).toMatchObject({ ok: true, value: { total: 0, rows: [] } });
    expect(await call('getMyUnreadCount', otherStudent.request)).toEqual({
      ok: true,
      value: { unread: 0 },
    });
    await call('markMyNotificationsRead', otherStudent.request);
    // The owner still has it, unread (positive control).
    expect(await call('getMyUnreadCount', student.request)).toEqual({
      ok: true,
      value: { unread: 1 },
    });
    expect(
      await call('listMyNotifications', student.request, { page: 1, pageSize: 20 }),
    ).toMatchObject({ ok: true, value: { total: 1 } });
  });

  it('writes a preference only for the caller (wrong user cannot be targeted)', async () => {
    expect(
      (
        await call('setNotificationPreference', otherStudent.request, {
          typeKey: 'notify.account.welcome',
          channel: 'in_app',
          isEnabled: false,
          userId: student.userId,
        })
      ).ok,
    ).toBe(true);
    const { rows } = await t.pool.query<{ user_id: string }>(
      'SELECT user_id FROM notification_preference',
    );
    expect(rows.map((r) => r.user_id)).toEqual([otherStudent.userId]);
  });
});

describe('public functions', () => {
  it.each(TWO_STEP_FNS)(
    '%s refuses an anonymous caller with TWO_STEP_NOT_PENDING',
    async (name, data) => {
      expect(await call(name, anonymous(), data)).toMatchObject({
        ok: false,
        error: { code: 'TWO_STEP_NOT_PENDING' },
      });
    },
  );
  it.each(TWO_STEP_FNS)(
    '%s refuses a Student session that has no two-step pending',
    async (name, data) => {
      expect(await call(name, student.request, data)).toMatchObject({
        ok: false,
        error: { code: 'TWO_STEP_NOT_PENDING' },
      });
    },
  );
  it('listPublicGoals answers an anonymous caller with the active goal groups', async () => {
    expect(await call('listPublicGoals', anonymous())).toMatchObject({
      ok: true,
      value: { segments: expect.any(Array) },
    });
  });
  it('searchCatalogCourses refuses an unknown or inactive goal like a missing one', async () => {
    expect(
      await call('searchCatalogCourses', anonymous(), {
        goalId: '00000000-0000-4000-8000-000000000000',
        query: 'math',
        page: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
  it('searchCatalogCourses refuses a page beyond the bound', async () => {
    expect(
      await call('searchCatalogCourses', anonymous(), {
        goalId: '00000000-0000-4000-8000-000000000000',
        page: 501,
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });
  it('getPublicCoursePage answers a missing course with NOT_FOUND', async () => {
    expect(
      await call('getPublicCoursePage', anonymous(), {
        courseId: '00000000-0000-4000-8000-000000000000',
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
  it('getTwoStepState tells an anonymous caller only "none"', async () => {
    expect(await call('getTwoStepState', anonymous())).toEqual({
      ok: true,
      value: { state: 'none' },
    });
  });
  it('getShellState reveals nothing about accounts to an anonymous caller', async () => {
    expect(await call('getShellState', anonymous())).toMatchObject({
      ok: true,
      value: { isSignedIn: false, roles: [], unread: 0, hasStepUp: false },
    });
  });
  it('setLanguage for an anonymous caller only sets the device cookie', async () => {
    expect(await call('setLanguage', anonymous(), { locale: 'en' })).toEqual({
      ok: true,
      value: { locale: 'en' },
    });
    expect(cookiesSet).toContain('cs_locale=en');
  });
});

describe('getDevMailbox is unreachable outside development', () => {
  async function withNodeEnv(nodeEnv: string) {
    process.env.NODE_ENV = nodeEnv;
    resetEnvForTests();
    try {
      return await call('getDevMailbox', anonymous());
    } finally {
      process.env.NODE_ENV = 'test';
      resetEnvForTests();
    }
  }
  it.each(['production', 'test'])('answers NOT_FOUND when NODE_ENV=%s', async (nodeEnv) => {
    expect(await withNodeEnv(nodeEnv)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
  it('answers in development', async () => {
    const result = await withNodeEnv('development');
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.value)).toBe(true);
  });
});
