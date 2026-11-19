// Statistics and finance views. A course's statistics are visible to its Lead, its Co-instructors
// and Admins only; anyone else gets NOT_FOUND, so a course's existence is not revealed (BR6.1).
// An instructor's earnings are always their own. Platform finance is Admin-only (enforced by the
// server function's role check).
import { createHash } from 'node:crypto';
import {
  courseTitlesOf,
  getPublishedCourse,
  listInstructorCourses,
} from '#src/features/catalog/index.ts';
import { listCourseEnrolments } from '#src/features/commerce/index.ts';
import { type Actor, getIdentity } from '#src/features/identity-access/index.ts';
import { courseLearningStats, courseNpsScores, npsOf } from '#src/features/learning/index.ts';
import {
  courseFinance,
  instructorEarnings,
  instructorStatement,
  instructorStatementMonths,
  platformFinance,
} from '#src/features/ledger/index.ts';
import { statementRetentionYears } from '#src/features/payouts/index.ts';
import {
  createFileObjectStore,
  createRenderer,
  defineCsvTemplate,
  type ObjectStore,
  toCsv,
} from '#src/features/platform/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { getDb } from '#src/server/db.ts';
import { createStatementsRepository } from '../data/statements.repository.ts';
import {
  enrolmentsByMonth,
  fillMonths,
  lastMonths,
  pageOfStudents,
  ratioBps,
  repeatStudents,
  studentRows,
  summarizeStudents,
} from '../domain/insights.ts';
import { CourseInsightsInput, PlatformFinanceInput, StatementInput } from './insights.schema.ts';
import type {
  CourseInsights,
  InstructorEarnings,
  MonthlyStatement,
  PlatformFinance,
  TeachingDashboard,
} from './insights.types.ts';

export const STUDENTS_PAGE_SIZE = 20;
export const JOURNAL_PAGE_SIZE = 15;
const MONTHS = 12;
const isAdmin = (actor: Actor) => actor.roles.includes('admin');

/** Every course the instructor currently teaches (Lead or Co-instructor). */
async function myCourseIds(instructorId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | undefined;
  for (let i = 0; i < 20; i += 1) {
    const page = await listInstructorCourses(instructorId, {
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const item of page.items) ids.add(item.courseId);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return ids;
}

const title = (t: { titleBn: string; titleEn: string } | undefined) => ({
  titleBn: t?.titleBn ?? '',
  titleEn: t?.titleEn ?? '',
});

export async function getCourseInsights(
  actor: Actor,
  raw: CourseInsightsInput,
): Promise<Result<CourseInsights, AppError<'NOT_FOUND'>>> {
  const input = CourseInsightsInput.parse(raw);
  if (!isAdmin(actor) && !(await myCourseIds(actor.userId)).has(input.courseId))
    return err(appError('NOT_FOUND'));
  const titles = await courseTitlesOf([input.courseId]);
  const course = titles[input.courseId];
  if (!course) return err(appError('NOT_FOUND'));

  const published = await getPublishedCourse(input.courseId);
  const lessons = published.ok
    ? published.value.outline.flatMap((s) =>
        s.lessons.map((l) => ({
          lessonId: l.lessonId,
          kind: l.kind,
          titleBn: l.titleBn ?? '',
          titleEn: l.titleEn ?? '',
          sectionTitleBn: s.titleBn,
          sectionTitleEn: s.titleEn,
        })),
      )
    : [];
  const lessonIds = lessons.map((l) => l.lessonId);
  const [enrolments, learning, finance, earnings] = await Promise.all([
    listCourseEnrolments(input.courseId),
    courseLearningStats(input.courseId, lessonIds),
    courseFinance(input.courseId),
    instructorEarnings(actor.userId),
  ]);
  const names = await getIdentity().displayNamesOf([...new Set(enrolments.map((e) => e.userId))]);
  const rows = studentRows(enrolments, learning.students, names, lessonIds.length);
  const now = new Date();
  const months = lastMonths(now, MONTHS);
  const lessonTitle = new Map(lessons.map((l) => [l.lessonId, l]));
  return ok({
    course: { courseId: input.courseId, ...title(course), status: course.status },
    finance: {
      ...finance.totals,
      myEarnings: earnings.byCourse.find((c) => c.courseId === input.courseId)?.earned ?? 0,
      byMonth: fillMonths(finance.byMonth, months),
    },
    enrolmentsByMonth: enrolmentsByMonth(enrolments, months),
    summary: summarizeStudents(rows, now),
    lessons: lessons.map((l) => {
      const done = learning.completionsByLesson[l.lessonId] ?? 0;
      return { ...l, completions: done, completionBps: ratioBps(done, rows.length) };
    }),
    quizzes: learning.quizzes
      .filter((q) => lessonTitle.has(q.lessonId))
      .map((q) => ({ ...q, ...title(lessonTitle.get(q.lessonId)) })),
    hardestQuestions: learning.hardestQuestions.map((q) => ({
      ...q,
      wrongBps: ratioBps(q.wrong, q.answers),
      lessonTitleBn: lessonTitle.get(q.lessonId)?.titleBn ?? '',
      lessonTitleEn: lessonTitle.get(q.lessonId)?.titleEn ?? '',
    })),
    students: { ...pageOfStudents(rows, input.q, input.page, STUDENTS_PAGE_SIZE), query: input.q },
  });
}

export async function getMyEarnings(actor: Actor): Promise<Result<InstructorEarnings, never>> {
  return earningsOf(actor.userId);
}

/**
 * One instructor's earnings from the ledger: totals, the last months and each course they own or
 * earned from. Callers decide who may ask: the instructor for themself, an Admin for anyone.
 */
export async function earningsOf(instructorId: string): Promise<Result<InstructorEarnings, never>> {
  const earnings = await instructorEarnings(instructorId);
  const ids = new Set([
    ...(await myCourseIds(instructorId)),
    ...earnings.byCourse.map((c) => c.courseId),
  ]);
  const titles = await courseTitlesOf([...ids]);
  const byId = new Map(earnings.byCourse.map((c) => [c.courseId, c]));
  return ok({
    total: earnings.total,
    courseEarnings: earnings.courseEarnings,
    reassigned: earnings.reassigned,
    salary: earnings.salary,
    policyAdjustment: earnings.policyAdjustment,
    sales: earnings.sales,
    byMonth: fillMonths(earnings.byMonth, lastMonths(new Date(), MONTHS)),
    courses: [...ids]
      .map((courseId) => ({
        courseId,
        ...title(titles[courseId]),
        status: titles[courseId]?.status ?? 'draft',
        earned: byId.get(courseId)?.earned ?? 0,
        gross: byId.get(courseId)?.gross ?? 0,
        sales: byId.get(courseId)?.sales ?? 0,
      }))
      .sort((a, b) => b.earned - a.earned || a.courseId.localeCompare(b.courseId)),
  });
}

export async function getPlatformFinance(
  raw: PlatformFinanceInput,
): Promise<Result<PlatformFinance, never>> {
  const input = PlatformFinanceInput.parse(raw);
  const books = await platformFinance(input.page, JOURNAL_PAGE_SIZE);
  const courseIds = [
    ...new Set([
      ...books.byCourse.map((c) => c.courseId),
      ...books.journal.rows.flatMap((r) => (r.courseId ? [r.courseId] : [])),
    ]),
  ];
  const instructorIds = [
    ...new Set([
      ...books.byInstructor.map((i) => i.instructorId),
      ...books.journal.rows.flatMap((r) =>
        r.postings.map((p) => p.instructorId ?? p.referrerId ?? ''),
      ),
    ]),
  ].filter((id) => id !== '');
  const [titles, names] = await Promise.all([
    courseTitlesOf(courseIds),
    getIdentity().displayNamesOf(instructorIds),
  ]);
  return ok({
    totals: books.totals,
    salesCount: books.sales,
    ledger: books.ledger,
    byMonth: fillMonths(books.byMonth, lastMonths(new Date(), MONTHS)),
    byCourse: books.byCourse.map((c) => ({ ...c, ...title(titles[c.courseId]) })),
    byInstructor: books.byInstructor.map((i) => ({ ...i, name: names[i.instructorId] ?? '' })),
    journal: {
      page: input.page,
      pageCount: Math.max(1, Math.ceil(books.journal.total / JOURNAL_PAGE_SIZE)),
      total: books.journal.total,
      rows: books.journal.rows.map((r) => ({
        ...r,
        ...(r.courseId ? title(titles[r.courseId]) : { titleBn: '', titleEn: '' }),
        postings: r.postings.map((p) => ({
          ...p,
          instructorName: p.instructorId
            ? (names[p.instructorId] ?? '')
            : p.referrerId
              ? (names[p.referrerId] ?? '')
              : null,
        })),
      })),
    },
  });
}

/**
 * I3 Teaching dashboard (US7.17): per course and in total, the instructor's students, how many
 * finished every lesson, the course NPS (from 5 answers) and the share of students who took
 * another of their courses within 12 months. Only courses the caller teaches are read.
 */
export async function getTeachingDashboard(
  actor: Actor,
): Promise<Result<TeachingDashboard, never>> {
  const ids = [...(await myCourseIds(actor.userId))];
  const [titles, scores] = await Promise.all([courseTitlesOf(ids), courseNpsScores(ids)]);
  const perCourse = await Promise.all(
    ids.map(async (courseId) => {
      const published = await getPublishedCourse(courseId);
      const lessonIds = published.ok
        ? published.value.outline.flatMap((s) => s.lessons.map((l) => l.lessonId))
        : [];
      const [enrolments, learning] = await Promise.all([
        listCourseEnrolments(courseId),
        courseLearningStats(courseId, lessonIds),
      ]);
      const students = new Set(enrolments.map((e) => e.userId));
      const completed =
        lessonIds.length === 0
          ? 0
          : learning.students.filter(
              (x) => students.has(x.userId) && x.completed >= lessonIds.length,
            ).length;
      return { courseId, enrolments, students: students.size, completed };
    }),
  );
  const allScores = ids.flatMap((id) => scores.get(id) ?? []);
  const students = perCourse.reduce((n, c) => n + c.students, 0);
  const completed = perCourse.reduce((n, c) => n + c.completed, 0);
  const repeat = repeatStudents(
    perCourse.flatMap((c) =>
      c.enrolments.map((e) => ({ userId: e.userId, courseId: c.courseId, startsAt: e.startsAt })),
    ),
  );
  return ok({
    totals: {
      courses: ids.length,
      students: repeat.students,
      completionBps: students > 0 ? ratioBps(completed, students) : null,
      nps: npsOf(allScores),
      repeatStudents: repeat.repeat,
      repeatBps: repeat.students > 0 ? ratioBps(repeat.repeat, repeat.students) : null,
    },
    courses: perCourse
      .map((c) => ({
        courseId: c.courseId,
        ...title(titles[c.courseId]),
        status: titles[c.courseId]?.status ?? 'draft',
        students: c.students,
        completed: c.completed,
        completionBps: c.students > 0 ? ratioBps(c.completed, c.students) : null,
        nps: npsOf(scores.get(c.courseId) ?? []),
      }))
      .sort((a, b) => b.students - a.students),
  });
}

/** Poisha as taka with two decimals, exact (integer arithmetic, never floating point). */
function takaText(poisha: number): string {
  const sign = poisha < 0 ? '-' : '';
  const abs = Math.abs(poisha);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const CSV_HEADER = {
  en: ['Date (Asia/Dhaka)', 'Type', 'Course', 'Amount (BDT)'],
  bn: ['তারিখ (ঢাকা)', 'ধরন', 'কোর্স', 'পরিমাণ (টাকা)'],
} as const;
const CSV_WORDS = {
  en: {
    course_sale: 'Sale',
    course_refund: 'Refund',
    attribution_reassignment: 'Attribution reassignment',
    salary_accrual: 'Salary',
    pay_policy_adjustment: 'Pay-policy adjustment',
    instructor_payout: 'Payout',
    opening: 'Owed at start',
    closing: 'Owed at end',
  },
  bn: {
    course_sale: 'বিক্রি',
    course_refund: 'ফেরত',
    attribution_reassignment: 'অ্যাট্রিবিউশন পুনর্বণ্টন',
    salary_accrual: 'বেতন',
    pay_policy_adjustment: 'পে-পলিসি সমন্বয়',
    instructor_payout: 'পেআউট',
    opening: 'শুরুতে পাওনা',
    closing: 'শেষে পাওনা',
  },
} as const;

/** The months with a statement, newest first: always the caller's own. */
export async function getMyStatementMonths(actor: Actor): Promise<Result<string[], never>> {
  return ok(await instructorStatementMonths(actor.userId));
}

/**
 * US7.8 (monthly): the caller's own statement for one Dhaka month, from the immutable ledger, so any
 * past month can be produced again exactly. There is no input that names another instructor
 * (AC7.8.2). The CSV is UTF-8 with a BOM and formula-safe cells.
 */
export async function getMyStatement(
  actor: Actor,
  raw: StatementInput,
): Promise<Result<MonthlyStatement, AppError<'NOT_FOUND'>>> {
  const input = StatementInput.parse(raw);
  const statement = await instructorStatement(actor.userId, input.month);
  if (!statement) return err(appError('NOT_FOUND'));
  const courseIds = [...new Set(statement.lines.flatMap((l) => (l.courseId ? [l.courseId] : [])))];
  const [titles, names] = await Promise.all([
    courseTitlesOf(courseIds),
    getIdentity().displayNamesOf([actor.userId]),
  ]);
  const lines = statement.lines.map((l) => ({
    occurredAt: l.occurredAt.toISOString(),
    kind: l.kind,
    courseId: l.courseId,
    amount: l.amount,
    ...title(l.courseId ? titles[l.courseId] : undefined),
  }));
  const dhakaDate = (iso: string) =>
    new Date(new Date(iso).getTime() + 6 * 3600 * 1000).toISOString().slice(0, 10);
  const rowsIn = (locale: 'bn' | 'en') => {
    const words = CSV_WORDS[locale];
    const row = (date: string, type: string, course: string, amount: number) => ({
      date,
      type,
      course,
      amount: takaText(amount),
    });
    return [
      row('', words.opening, '', statement.opening),
      ...lines.map((l) =>
        row(
          dhakaDate(l.occurredAt),
          words[l.kind],
          (locale === 'bn' ? l.titleBn : l.titleEn) || l.titleBn || l.titleEn,
          l.amount,
        ),
      ),
      row('', words.closing, '', statement.closing),
    ];
  };
  const csvIn = (locale: 'bn' | 'en') =>
    toCsv(
      CSV_HEADER[locale],
      rowsIn(locale).map((r) => [r.date, r.type, r.course, r.amount]),
    ).toString('utf8');
  const csv = { bn: csvIn('bn'), en: csvIn('en') };
  // An ended month's statement is stored (and re-versioned if the ledger later changes for it, or
  // its lines are labelled differently: an earlier version stays exactly as it was stored).
  const range = dhakaMonthEnd(input.month);
  const stored =
    range && statementsNow() >= range
      ? await storeMonthlyStatement(actor.userId, input.month, csv, rowsIn)
      : null;
  return ok({
    month: input.month,
    instructorName: names[actor.userId] ?? '',
    opening: statement.opening,
    earned: statement.earned,
    refunded: statement.refunded,
    reassigned: statement.reassigned,
    salary: statement.salary,
    policyAdjustment: statement.policyAdjustment,
    paidOut: statement.paidOut,
    net: statement.net,
    closing: statement.closing,
    lines,
    csv,
    stored,
  });
}

// ------------------------------------------------- stored monthly statements (FR7.4, 10+ years)

const MONTHLY_TEMPLATE = defineCsvTemplate({
  name: 'insights.monthlyStatement',
  owner: 'insights',
  columns: [
    { key: 'date', header: { en: CSV_HEADER.en[0], bn: CSV_HEADER.bn[0] } },
    { key: 'type', header: { en: CSV_HEADER.en[1], bn: CSV_HEADER.bn[1] } },
    { key: 'course', header: { en: CSV_HEADER.en[2], bn: CSV_HEADER.bn[2] } },
    { key: 'amount', header: { en: CSV_HEADER.en[3], bn: CSV_HEADER.bn[3] } },
  ],
});
const statementsRepo = createStatementsRepository();
let statementStore: ObjectStore = createFileObjectStore();
let statementsNow: () => Date = () => new Date();
/** Tests keep stored statements in a temporary folder and move time forward. */
export function setStatementStoreForTests(store: ObjectStore, clock?: () => Date) {
  statementStore = store;
  if (clock) statementsNow = clock;
}

/** The instant a Dhaka month ends; null if malformed. */
function dhakaMonthEnd(month: string): Date | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]), 1) - 6 * 3600 * 1000) : null;
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Stores an ended month's statement in both languages through the platform renderer, kept for the
 * statement retention (at least 10 years). Unchanged content is not stored again; changed content
 * becomes a new version, and earlier versions stay as they were.
 */
async function storeMonthlyStatement(
  instructorId: string,
  month: string,
  csv: { bn: string; en: string },
  rowsIn: (locale: 'bn' | 'en') => Array<Record<'date' | 'type' | 'course' | 'amount', string>>,
): Promise<{ version: number; storedAt: string; retainUntil: string }> {
  const db = getDb();
  const latest = await statementsRepo.latest(db, instructorId, month);
  const same = latest.length === 2 && latest.every((r) => r.sha256 === sha(csv[r.locale]));
  let rows = latest;
  if (!same) {
    const version = (latest[0]?.version ?? 0) + 1;
    const now = statementsNow();
    const retainUntil = new Date(now);
    retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + (await statementRetentionYears()));
    const renderer = createRenderer({
      db,
      clock: { now: () => statementsNow().toISOString() },
      store: statementStore,
      templates: [MONTHLY_TEMPLATE],
    });
    for (const locale of ['bn', 'en'] as const) {
      const rendered = await renderer.render(
        {
          template: MONTHLY_TEMPLATE.name,
          locale,
          format: 'csv',
          data: rowsIn(locale),
          retainUntil: retainUntil.toISOString(),
        },
        `earnings-statement-${instructorId}-${month}`,
      );
      if (!rendered.ok) continue;
      const bytes = await statementStore.get(rendered.value.objectKey);
      await statementsRepo.insert(db, {
        instructorId,
        month,
        version,
        locale,
        objectKey: rendered.value.objectKey,
        sha256: sha(bytes?.toString('utf8') ?? ''),
        createdAt: now,
        retainUntil,
      });
    }
    rows = await statementsRepo.latest(db, instructorId, month);
  }
  const first = rows[0];
  return first
    ? {
        version: first.version,
        storedAt: first.createdAt.toISOString(),
        retainUntil: first.retainUntil.toISOString(),
      }
    : { version: 0, storedAt: '', retainUntil: '' };
}
