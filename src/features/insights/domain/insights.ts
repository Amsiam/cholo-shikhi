// Course statistics arithmetic: plain TypeScript, no framework, DB or env access. Percentages are
// whole basis points (10 000 = 100%) so nothing here is a float that could drift.
export type MonthPoint = { month: string; amount: number; sales: number };

/** The last `count` months as YYYY-MM in Asia/Dhaka, oldest first, ending with `now`'s month. */
export function lastMonths(now: Date, count: number): string[] {
  const dhaka = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  let year = Number(dhaka.find((p) => p.type === 'year')?.value);
  let month = Number(dhaka.find((p) => p.type === 'month')?.value);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.unshift(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

/** A month series with every month present (missing months are zero). */
export function fillMonths(points: readonly MonthPoint[], months: readonly string[]): MonthPoint[] {
  const byMonth = new Map(points.map((p) => [p.month, p]));
  return months.map((month) => byMonth.get(month) ?? { month, amount: 0, sales: 0 });
}

/** part / whole in basis points, rounded down; 0 when whole is 0. */
export function ratioBps(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.floor((Math.max(0, Math.min(part, whole)) * 10_000) / whole);
}

export type EnrolmentFact = {
  userId: string;
  status: 'active' | 'expired' | 'revoked' | 'switched';
  startsAt: string;
  endsAt: string;
};
export type ProgressFact = { userId: string; completed: number; lastActiveAt: string | null };

export type StudentRow = {
  userId: string;
  name: string;
  status: EnrolmentFact['status'];
  enrolledAt: string;
  endsAt: string;
  completed: number;
  progressBps: number;
  lastActiveAt: string | null;
};

/**
 * One row per student (their newest enrolment), joined with progress and display name, newest
 * first. A student who re-bought appears once.
 */
export function studentRows(
  enrolments: readonly EnrolmentFact[],
  progress: readonly ProgressFact[],
  names: Readonly<Record<string, string>>,
  lessonCount: number,
): StudentRow[] {
  const progressOf = new Map(progress.map((p) => [p.userId, p]));
  const newest = new Map<string, EnrolmentFact>();
  for (const e of enrolments) {
    const seen = newest.get(e.userId);
    if (!seen || e.startsAt > seen.startsAt) newest.set(e.userId, e);
  }
  return [...newest.values()]
    .map((e) => {
      const p = progressOf.get(e.userId);
      const completed = Math.min(p?.completed ?? 0, lessonCount);
      return {
        userId: e.userId,
        name: names[e.userId] ?? '',
        status: e.status,
        enrolledAt: e.startsAt,
        endsAt: e.endsAt,
        completed,
        progressBps: ratioBps(completed, lessonCount),
        lastActiveAt: p?.lastActiveAt ?? null,
      };
    })
    .sort((a, b) =>
      a.enrolledAt === b.enrolledAt
        ? a.userId.localeCompare(b.userId)
        : b.enrolledAt.localeCompare(a.enrolledAt),
    );
}

export type StudentSummary = {
  students: number;
  active: number;
  /** Active in the last 7 days (any lesson or quiz). */
  recentlyActive: number;
  averageProgressBps: number;
  completionRateBps: number;
};

export function summarizeStudents(rows: readonly StudentRow[], now: Date): StudentSummary {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const students = rows.length;
  const total = rows.reduce((s, r) => s + r.progressBps, 0);
  return {
    students,
    active: rows.filter((r) => r.status === 'active').length,
    recentlyActive: rows.filter((r) => r.lastActiveAt !== null && r.lastActiveAt >= weekAgo).length,
    averageProgressBps: students === 0 ? 0 : Math.floor(total / students),
    completionRateBps: ratioBps(rows.filter((r) => r.progressBps === 10_000).length, students),
  };
}

/** Case-insensitive name search, then one page. Page numbers start at 1 and are clamped. */
export function pageOfStudents(
  rows: readonly StudentRow[],
  query: string,
  page: number,
  pageSize: number,
): { rows: StudentRow[]; total: number; page: number; pageCount: number } {
  const q = query.trim().toLocaleLowerCase();
  const matched = q === '' ? rows : rows.filter((r) => r.name.toLocaleLowerCase().includes(q));
  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount);
  return {
    rows: matched.slice((current - 1) * pageSize, current * pageSize),
    total: matched.length,
    page: current,
    pageCount,
  };
}

/** Monthly new enrolments from enrolment start dates (Asia/Dhaka months). */
export function enrolmentsByMonth(
  enrolments: readonly EnrolmentFact[],
  months: readonly string[],
): Array<{ month: string; count: number }> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
  });
  const counts = new Map<string, number>();
  for (const e of enrolments) {
    const parts = fmt.formatToParts(new Date(e.startsAt));
    const key = `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return months.map((month) => ({ month, count: counts.get(month) ?? 0 }));
}

const YEAR_MS = 365 * 24 * 3600 * 1000;

/**
 * FR7.9: the Students who took another of the instructor's courses within 12 months, out of all of
 * the instructor's Students. A Student counts once their enrolments span two or more different
 * courses with two starts no more than 12 months apart.
 */
export function repeatStudents(
  enrolments: ReadonlyArray<{ userId: string; courseId: string; startsAt: string }>,
): { students: number; repeat: number } {
  const byStudent = new Map<string, Array<{ courseId: string; at: number }>>();
  for (const e of enrolments) {
    const list = byStudent.get(e.userId) ?? [];
    list.push({ courseId: e.courseId, at: Date.parse(e.startsAt) });
    byStudent.set(e.userId, list);
  }
  let repeat = 0;
  for (const list of byStudent.values()) {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    const isRepeat = sorted.some((a, i) =>
      sorted.slice(i + 1).some((b) => b.courseId !== a.courseId && b.at - a.at <= YEAR_MS),
    );
    if (isRepeat) repeat += 1;
  }
  return { students: byStudent.size, repeat };
}
