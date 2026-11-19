// Views returned by the statistics and finance server functions. Money is integer poisha;
// percentages are basis points (10 000 = 100%).

import type { NpsSummary } from '#src/features/learning/index.ts';
import type {
  AccountAmount,
  LedgerAccount,
  LedgerKind,
  StatementLineKind,
} from '#src/features/ledger/index.ts';
import type { StudentRow, StudentSummary } from '../domain/insights.ts';

export type MonthMoney = { month: string; amount: number; sales: number };
type Titles = { titleBn: string; titleEn: string };
export type AccountTotals = {
  gross: number;
  platform: number;
  instructors: number;
  unassigned: number;
};

export type CourseInsights = {
  course: { courseId: string; status: string } & Titles;
  finance: AccountTotals & { myEarnings: number; byMonth: MonthMoney[] };
  enrolmentsByMonth: Array<{ month: string; count: number }>;
  summary: StudentSummary;
  lessons: Array<
    {
      lessonId: string;
      kind: 'video' | 'text' | 'quiz';
      sectionTitleBn: string;
      sectionTitleEn: string;
      completions: number;
      completionBps: number;
    } & Titles
  >;
  quizzes: Array<
    { lessonId: string; attempts: number; students: number; averageBps: number } & Titles
  >;
  hardestQuestions: Array<{
    questionId: string;
    lessonId: string;
    answers: number;
    wrong: number;
    wrongBps: number;
    promptBn: string;
    promptEn: string;
    lessonTitleBn: string;
    lessonTitleEn: string;
  }>;
  students: { rows: StudentRow[]; total: number; page: number; pageCount: number; query: string };
};

export type InstructorEarnings = {
  /** Everything credited to the payable except payouts: courseEarnings + salary + policyAdjustment. */
  total: number;
  /** The per-course earnings added up (sales, refunds and reassignments of each course). */
  courseEarnings: number;
  /** US7.13: attribution reassignments received (already inside courseEarnings). */
  reassigned: number;
  /** US7.16: committed salary lines. */
  salary: number;
  /** US7.27: hybrid or salary policy adjustments (either sign). */
  policyAdjustment: number;
  sales: number;
  byMonth: MonthMoney[];
  courses: Array<
    { courseId: string; status: string; earned: number; gross: number; sales: number } & Titles
  >;
};

export type PlatformFinance = {
  /** Sales, refunds and reassignments only (the sales split); the ledger panel has the rest. */
  totals: AccountTotals;
  /** Course and platform sales counted. */
  salesCount: number;
  /** The whole ledger by entry type, each kind its own line, reconciled to the account balances. */
  ledger: {
    entries: Array<{ kind: LedgerKind; transactions: number; accounts: AccountAmount[] }>;
    balances: AccountAmount[];
    ledgerBalances: AccountAmount[];
    imbalance: number;
    isReconciled: boolean;
  };
  byMonth: MonthMoney[];
  byCourse: Array<{ courseId: string; gross: number; sales: number; platform: number } & Titles>;
  byInstructor: Array<{ instructorId: string; name: string; earned: number; sales: number }>;
  journal: {
    page: number;
    pageCount: number;
    total: number;
    rows: Array<
      {
        transactionId: string;
        kind: LedgerKind;
        /** None for a platform sale, a salary, a policy adjustment, a payout or referral money. */
        courseId: string | null;
        amount: number;
        shareBps: number;
        occurredAt: string;
        postings: Array<{
          account: LedgerAccount;
          instructorId: string | null;
          referrerId: string | null;
          /** The instructor's or the referrer's name. */
          instructorName: string | null;
          amount: number;
        }>;
      } & Titles
    >;
  };
};

/** I3 Teaching dashboard (FR7.9, US7.17): the instructor's own courses only. */
export type TeachingDashboard = {
  totals: {
    courses: number;
    students: number;
    /** Students who finished every lesson, of all enrolled; null with no enrolments. */
    completionBps: number | null;
    nps: NpsSummary;
    repeatStudents: number;
    /** Students who took another of my courses within 12 months; null with no students. */
    repeatBps: number | null;
  };
  courses: Array<
    {
      courseId: string;
      status: string;
      students: number;
      completed: number;
      completionBps: number | null;
      nps: NpsSummary;
    } & Titles
  >;
};

/** US7.8 (monthly until payout cycles exist): one month of an instructor's earnings. */
export type MonthlyStatement = {
  month: string;
  instructorName: string;
  opening: number;
  earned: number;
  refunded: number;
  /** US7.13: attribution reassignments received. */
  reassigned: number;
  /** US7.16: committed salary. */
  salary: number;
  /** US7.27: pay-policy adjustments (either sign). */
  policyAdjustment: number;
  /** Paid out this month (payout-cycle payments). */
  paidOut: number;
  net: number;
  closing: number;
  lines: Array<
    {
      occurredAt: string;
      kind: StatementLineKind;
      courseId: string | null;
      amount: number;
    } & Titles
  >;
  /** The same statement as CSV text in each language (UTF-8 with BOM, formula-safe). */
  csv: { bn: string; en: string };
  /** Set once the month has ended: the stored version, when it was stored and until when kept. */
  stored: { version: number; storedAt: string; retainUntil: string } | null;
};
