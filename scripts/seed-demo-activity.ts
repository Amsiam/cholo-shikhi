// Development-only demo activity: synthetic learners who bought demo courses over the last eight
// months, worked through lessons and took quizzes, so the course statistics, earnings and platform
// books have something real to show. Then it posts every sale that is not yet in the ledger.
//
//   pnpm db:seed-activity      (after pnpm db:seed-demo)
//
// Synthetic data only: example.test addresses, made-up names, no password (these learners cannot
// sign in). Refuses to run against anything but a loopback database. Safe to run again: learners are
// created once, and the ledger backfill skips sales it already posted.
//
// Ledger note: the split uses the same rule as checkout (src/features/ledger/domain). A real sale is
// split by the section owners at the moment of sale. The demo courses' ownership records only start
// when the demo was seeded, so these back-dated synthetic sales use the current owners instead;
// otherwise every one of them would land in the unassigned pool.
import pg from 'pg';
import { salePostings, splitSale } from '../src/features/ledger/domain/revenue-split.ts';
import { getEnv } from '../src/lib/env.ts';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LEARNERS = 80;
const MONTHS_BACK = 8;
const INSTRUCTOR_EMAIL = 'demo.instructor2@example.test';

const FIRST = [
  'আয়েশা',
  'তানভীর',
  'নুসরাত',
  'রাফি',
  'সাদিয়া',
  'ইমরান',
  'মাহি',
  'সাকিব',
  'তাসনিম',
  'আরিফ',
  'ফারহানা',
  'জুবায়ের',
  'নাদিয়া',
  'রিয়াদ',
  'সুমাইয়া',
  'হাসান',
  'লামিয়া',
  'শুভ',
  'মেহজাবিন',
  'রাকিব',
];
const LAST = ['রহমান', 'ইসলাম', 'হোসেন', 'আহমেদ', 'চৌধুরী', 'খান', 'সরকার', 'দাস', 'মিয়া', 'আক্তার'];

/** Deterministic pseudo-random numbers (mulberry32), so a re-seed builds the same history. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Course = { courseId: string; price: number; months: number; weight: number };
type Lesson = { lessonId: string; kind: string; lessonVersionId: string };

async function main() {
  const url = new URL(getEnv().DATABASE_URL);
  if (!LOOPBACK_HOSTS.has(url.hostname))
    throw new Error('seed-demo-activity runs only against a local database');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await seedActivity(client);
    await backfillVault(client);
    await ensureTrialCourses(client);
    const result = await backfillLedger(client);
    console.log(`Ledger: posted ${result.posted} sale(s), ${result.skipped} already posted.`);
  } finally {
    await client.end();
  }
}

async function seedActivity(client: pg.Client) {
  const marker = await client.query(
    "SELECT 1 FROM user_account WHERE email_normalised = 'learner01@example.test'",
  );
  if (marker.rowCount) {
    console.log('Demo activity already seeded.');
    return;
  }
  const instructor = await client.query<{ user_id: string }>(
    'SELECT user_id FROM user_account WHERE email_normalised = $1',
    [INSTRUCTOR_EMAIL],
  );
  const instructorId = instructor.rows[0]?.user_id ?? null;
  const courses = (
    await client.query<{ course_id: string; price: string; months: number; lead: string | null }>(
      `SELECT course_id, list_price_poisha::text AS price, coalesce(access_duration_months, 6) AS months,
              lead_instructor_id AS lead
         FROM course WHERE status = 'published' AND list_price_poisha IS NOT NULL ORDER BY course_id`,
    )
  ).rows.map(
    (r): Course => ({
      courseId: r.course_id,
      price: Number(r.price),
      months: r.months,
      // The demo instructor's courses sell more, so their statistics are the richest.
      weight: r.lead !== null && r.lead === instructorId ? 6 : 1,
    }),
  );
  if (courses.length === 0) throw new Error('No published courses: run pnpm db:seed-demo first');
  const lessonsOf = new Map<string, Lesson[]>();
  for (const c of courses) {
    const rows = await client.query<{ lesson_id: string; kind: string; lesson_version_id: string }>(
      `SELECT l.lesson_id, l.kind, lv.lesson_version_id
         FROM section s
         JOIN lesson_version lv ON lv.section_version_id = s.live_version_id
         JOIN lesson l ON l.lesson_id = lv.lesson_id
        WHERE s.course_id = $1 AND s.structure_state <> 'removed'
        ORDER BY s.position, lv.position`,
      [c.courseId],
    );
    lessonsOf.set(
      c.courseId,
      rows.rows.map((r) => ({
        lessonId: r.lesson_id,
        kind: r.kind,
        lessonVersionId: r.lesson_version_id,
      })),
    );
  }
  const questionsOf = async (lessonVersionId: string) =>
    (
      await client.query<{ question_id: string; correct_index: number }>(
        'SELECT question_id, correct_index FROM quiz_question WHERE lesson_version_id = $1 ORDER BY position',
        [lessonVersionId],
      )
    ).rows;

  const random = rng(20261118);
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)] as T;
  const weighted = () => {
    const total = courses.reduce((s, c) => s + c.weight, 0);
    let r = random() * total;
    for (const c of courses) {
      r -= c.weight;
      if (r <= 0) return c;
    }
    return courses[courses.length - 1] as Course;
  };
  const now = Date.now();
  const day = 24 * 3600 * 1000;

  await client.query('BEGIN');
  try {
    for (let i = 1; i <= LEARNERS; i += 1) {
      const email = `learner${String(i).padStart(2, '0')}@example.test`;
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const user = await client.query<{ user_id: string }>(
        `INSERT INTO user_account (email_normalised, display_name, email_verified, email_verified_at, status, locale)
         VALUES ($1, $2, true, now(), 'active', 'bn') RETURNING user_id`,
        [email, name],
      );
      const userId = user.rows[0]?.user_id as string;
      const bought = new Set<string>();
      const purchases = 1 + Math.floor(random() * 3);
      for (let k = 0; k < purchases; k += 1) {
        const course = weighted();
        if (bought.has(course.courseId)) continue;
        bought.add(course.courseId);
        // Sales lean towards recent months: the platform is growing.
        const ageDays = Math.floor(random() ** 1.6 * MONTHS_BACK * 30);
        const at = new Date(now - ageDays * day - Math.floor(random() * day));
        const ends = new Date(at);
        ends.setUTCMonth(ends.getUTCMonth() + course.months);
        const pay = await client.query<{ payment_id: string }>(
          `INSERT INTO payment (user_id, course_id, amount_poisha, access_duration_months, gateway, status, gateway_ref, created_at, settled_at)
           VALUES ($1, $2, $3, $4, 'fake', 'succeeded', 'fake-demo-activity', $5, $5) RETURNING payment_id`,
          [userId, course.courseId, course.price, course.months, at],
        );
        await client.query(
          `INSERT INTO enrolment (user_id, course_id, payment_id, starts_at, ends_at, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $4)`,
          [
            userId,
            course.courseId,
            pay.rows[0]?.payment_id,
            at,
            ends,
            ends.getTime() > now ? 'active' : 'expired',
          ],
        );
        // Progress: some finish, most stop part-way, a few never start.
        const lessons = lessonsOf.get(course.courseId) ?? [];
        const r = random();
        const share = r < 0.15 ? 0 : r > 0.8 ? 1 : random();
        const done = Math.round(lessons.length * share);
        const span = Math.max(1, now - at.getTime());
        for (let j = 0; j < done; j += 1) {
          const lesson = lessons[j] as Lesson;
          const completedAt = new Date(
            at.getTime() + Math.floor(span * ((j + 1) / (done + 1)) * random()),
          );
          await client.query(
            'INSERT INTO lesson_progress (user_id, lesson_id, course_id, completed_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [userId, lesson.lessonId, course.courseId, completedAt],
          );
          if (lesson.kind !== 'quiz') continue;
          const questions = await questionsOf(lesson.lessonVersionId);
          if (questions.length === 0) continue;
          const skill = 0.45 + random() * 0.5;
          const attempts = 1 + (random() < 0.35 ? 1 : 0);
          for (let a = 0; a < attempts; a += 1) {
            const answers = questions.map((q, n) => {
              // Later questions are a little harder; a second attempt goes a little better.
              const correct = random() < skill - n * 0.06 + a * 0.12;
              const chosen = correct
                ? q.correct_index
                : (q.correct_index + 1 + Math.floor(random() * 3)) % 4;
              return { questionId: q.question_id, chosen, correct };
            });
            const attempt = await client.query<{ attempt_id: string }>(
              `INSERT INTO quiz_attempt (user_id, lesson_id, course_id, score, total, submitted_at)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING attempt_id`,
              [
                userId,
                lesson.lessonId,
                course.courseId,
                answers.filter((x) => x.correct).length,
                answers.length,
                new Date(completedAt.getTime() + a * 3600 * 1000),
              ],
            );
            for (const x of answers) {
              await client.query(
                'INSERT INTO quiz_attempt_answer (attempt_id, question_id, chosen_index, is_correct) VALUES ($1, $2, $3, $4)',
                [attempt.rows[0]?.attempt_id, x.questionId, x.chosen, x.correct],
              );
            }
          }
        }
      }
    }
    await client.query('COMMIT');
    console.log(
      `Demo activity: ${LEARNERS} synthetic learners with purchases, progress and quizzes.`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** One free trial course per demo segment (FR-DIST-1): the segment's course with the most lessons. */
async function ensureTrialCourses(client: pg.Client) {
  const r = await client.query(
    `INSERT INTO trial_offer (segment_id, course_id, set_by)
     SELECT DISTINCT ON (g.segment_id) g.segment_id, c.course_id, c.lead_instructor_id
       FROM course c
       JOIN goal g ON g.goal_id = c.goal_id
      WHERE c.status = 'published' AND c.lead_instructor_id IS NOT NULL AND g.status = 'active'
      ORDER BY g.segment_id,
               (SELECT count(*) FROM section s WHERE s.course_id = c.course_id) DESC,
               c.course_id
     ON CONFLICT DO NOTHING`,
  );
  console.log(`Free trial courses: ${r.rowCount ?? 0} set.`);
}

/** Wrong quiz answers become Mistake Vault items (same rule as quiz submission; idempotent). */
async function backfillVault(client: pg.Client) {
  const r = await client.query(
    `INSERT INTO vault_item (user_id, question_id, lesson_id, course_id, goal_id, last_wrong_choice,
                             status, correct_run, wrong_count, first_wrong_at, last_wrong_at)
     SELECT a.user_id, x.question_id, a.lesson_id, a.course_id, c.goal_id,
            (array_agg(x.chosen_index ORDER BY a.submitted_at DESC))[1],
            'active', 0, count(*), min(a.submitted_at), max(a.submitted_at)
       FROM quiz_attempt_answer x
       JOIN quiz_attempt a ON a.attempt_id = x.attempt_id
       LEFT JOIN course c ON c.course_id = a.course_id
      WHERE NOT x.is_correct
      GROUP BY a.user_id, x.question_id, a.lesson_id, a.course_id, c.goal_id
     ON CONFLICT DO NOTHING`,
  );
  console.log(`Mistake Vault: ${r.rowCount ?? 0} new item(s).`);
}

async function backfillLedger(client: pg.Client) {
  const sales = await client.query<{
    payment_id: string;
    course_id: string;
    amount: string;
    occurred_at: Date;
  }>(
    `SELECT p.payment_id, p.course_id, p.amount_poisha::text AS amount, coalesce(p.settled_at, p.created_at) AS occurred_at
       FROM payment p
      WHERE p.status = 'succeeded'
        AND NOT EXISTS (SELECT 1 FROM ledger_transaction t WHERE t.source_payment_id = p.payment_id)
      ORDER BY occurred_at`,
  );
  let posted = 0;
  for (const sale of sales.rows) {
    // Current owners (see the ledger note at the top of this file).
    const owners = await client.query<{ section_id: string; instructor_id: string }>(
      `SELECT s.section_id, o.instructor_id
         FROM section s JOIN ownership_period o ON o.section_id = s.section_id AND o.valid_to IS NULL
        WHERE s.course_id = $1 AND s.removed_at IS NULL`,
      [sale.course_id],
    );
    const split = splitSale(
      Number(sale.amount),
      owners.rows.map((o) => ({ sectionId: o.section_id, instructorId: o.instructor_id })),
    );
    if (!split.ok) throw new Error(`cannot split sale ${sale.payment_id}`);
    await client.query('BEGIN');
    try {
      const tx = await client.query<{ transaction_id: string }>(
        `INSERT INTO ledger_transaction (kind, source_payment_id, course_id, amount_poisha, instructor_share_bps, occurred_at)
         VALUES ('course_sale', $1, $2, $3, $4, $5) RETURNING transaction_id`,
        [
          sale.payment_id,
          sale.course_id,
          split.value.amount,
          split.value.shareBps,
          sale.occurred_at,
        ],
      );
      for (const p of salePostings(split.value)) {
        await client.query(
          'INSERT INTO ledger_posting (transaction_id, account, instructor_id, amount_poisha) VALUES ($1, $2, $3, $4)',
          [tx.rows[0]?.transaction_id, p.account, p.instructorId, p.amount],
        );
      }
      await client.query('COMMIT');
      posted += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  return { posted, skipped: 0 };
}

await main();
