// Development-only demo staff and admin work items, so every Admin and Finance screen can be looked
// at with something on it:
//   - a demo Admin and a demo Finance user who can sign in (two-step setup on first sign-in, as for
//     every staff member; scan the QR code with any authenticator app);
//   - the Admin settings that have no default (course and product price bounds, refund window),
//     only where an Admin has not saved them yet;
//   - an open copyright takedown notice, a pending course switch request from the demo Student,
//     and a few past-paper questions in the bank carrying the "From past papers" label;
//   - a sample bundle of two published courses of one segment, at 80% of their prices;
//   - a referral link for the demo Student (Me -> Refer); the share stays the Admin's to set.
//
//   pnpm db:seed-staff      (after pnpm db:seed-demo; db:seed-bank adds the question taxonomy)
//
// Synthetic only: reserved @example.test addresses, invented names, passwords printed below.
// Refuses to run unless NODE_ENV is development and DATABASE_URL points at a loopback host.
// Safe to run again: everything is created once.
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import pg from 'pg';
import { getEnv } from '../src/lib/env.ts';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const isLoopback = (url: string) => LOOPBACK_HOSTS.has(new URL(url).hostname);

export const DEMO_STAFF = [
  {
    email: 'demo.admin@example.test',
    password: 'DemoAdmin2026!',
    displayName: 'Arif Hossain',
    role: 'admin' as const,
  },
  {
    email: 'demo.finance@example.test',
    password: 'DemoFinance2026!',
    displayName: 'Nasrin Akter',
    role: 'finance' as const,
  },
];

async function ensureAccount(
  client: pg.Client,
  account: (typeof DEMO_STAFF)[number],
): Promise<string> {
  const found = await client.query<{ user_id: string }>(
    'SELECT user_id FROM user_account WHERE email_normalised = $1',
    [account.email],
  );
  let userId = found.rows[0]?.user_id;
  if (!userId) {
    const created = await client.query<{ user_id: string }>(
      `INSERT INTO user_account (email_normalised, display_name, email_verified, email_verified_at, status, locale)
       VALUES ($1, $2, true, now(), 'active', 'bn') RETURNING user_id`,
      [account.email, account.displayName],
    );
    userId = created.rows[0]?.user_id as string;
  }
  const credential = await client.query(
    `SELECT 1 FROM auth_account WHERE user_id = $1 AND provider_id = 'credential'`,
    [userId],
  );
  if (!credential.rowCount)
    await client.query(
      `INSERT INTO auth_account (provider_account_id, provider_id, user_id, password_hash)
       VALUES ($1, 'credential', $2, $3)`,
      [userId, userId, await hashPassword(account.password)],
    );
  const role = await client.query(
    `SELECT 1 FROM staff_role_assignment WHERE user_id = $1 AND role = $2 AND revoked_at IS NULL`,
    [userId, account.role],
  );
  if (!role.rowCount)
    await client.query(
      `INSERT INTO staff_role_assignment (user_id, role, assigned_by) VALUES ($1, $2, $1)`,
      [userId, account.role],
    );
  return userId;
}

/** An open takedown notice against the first lesson of a published demo course. */
async function ensureTakedown(client: pg.Client, adminId: string) {
  const exists = await client.query(`SELECT 1 FROM takedown_notice LIMIT 1`);
  if (exists.rowCount) return;
  const target = await client.query<{ course_id: string; lesson_id: string }>(
    `SELECT c.course_id, l.lesson_id
       FROM course c
       JOIN section s ON s.course_id = c.course_id
       JOIN lesson l ON l.section_id = s.section_id
      WHERE c.status = 'published' AND l.live_state <> 'never_published'
        AND c.title_en NOT LIKE 'E2E %'
      ORDER BY c.created_at, s.position LIMIT 1`,
  );
  const row = target.rows[0];
  if (!row) return;
  await client.query(
    `INSERT INTO takedown_notice (content_type, content_id, course_id, claimant, claimant_contact,
       claim, evidence, state, logged_by, logged_at)
     VALUES ('lesson', $1, $2, 'Demo Publishers Ltd', 'rights@publisher.example.test',
       'Chapter 2 of our guidebook appears to be copied into this lesson.',
       'https://publisher.example.test/guidebook/chapter-2', 'open', $3, now())`,
    [row.lesson_id, row.course_id, adminId],
  );
  console.log('Seeded an open takedown notice (/admin/takedowns).');
}

/** A pending switch request from the demo Student, from one paid course to another. */
async function ensureSwitchRequest(client: pg.Client) {
  const student = await client.query<{ user_id: string }>(
    `SELECT user_id FROM user_account WHERE email_normalised = 'student@example.test'`,
  );
  const userId = student.rows[0]?.user_id;
  if (!userId) return;
  const pending = await client.query(
    `SELECT 1 FROM course_switch_request WHERE user_id = $1 AND status = 'pending'`,
    [userId],
  );
  if (pending.rowCount) return;
  const from = await client.query<{ enrolment_id: string; course_id: string; payment_id: string }>(
    `SELECT e.enrolment_id, e.course_id, e.payment_id
       FROM enrolment e JOIN payment p ON p.payment_id = e.payment_id
      WHERE e.user_id = $1 AND e.status = 'active' AND p.status = 'succeeded' AND e.ends_at > now()
      ORDER BY e.created_at LIMIT 1`,
    [userId],
  );
  const f = from.rows[0];
  if (!f) return;
  const to = await client.query<{ course_id: string }>(
    `SELECT c.course_id FROM course c
      WHERE c.status = 'published' AND c.title_en NOT LIKE 'E2E %'
        AND c.title_en NOT ILIKE '%synthetic%'
        AND c.course_id NOT IN (SELECT course_id FROM enrolment WHERE user_id = $1)
      ORDER BY c.created_at LIMIT 1`,
    [userId],
  );
  const t = to.rows[0];
  if (!t) return;
  await client.query(
    `INSERT INTO course_switch_request (user_id, enrolment_id, payment_id, from_course_id,
       to_course_id, status, requested_at, deadline_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', now() - interval '20 hours', now() + interval '4 hours')`,
    [userId, f.enrolment_id, f.payment_id, f.course_id, t.course_id],
  );
  console.log('Seeded a pending course switch request (/admin/switches).');
}

/** A sample bundle (US8.4/US8.5): two published courses of one segment at 80% of their prices. */
async function ensureBundle(client: pg.Client, adminId: string) {
  const exists = await client.query(`SELECT 1 FROM bundle LIMIT 1`);
  if (exists.rowCount) return;
  const courses = await client.query<{
    segment_id: string;
    course_id: string;
    list_price_poisha: string;
  }>(
    `SELECT g.segment_id, c.course_id, c.list_price_poisha
       FROM course c JOIN goal g ON g.goal_id = c.goal_id
      WHERE c.status = 'published' AND c.list_price_poisha IS NOT NULL
        AND c.title_en NOT LIKE 'E2E %'
      ORDER BY g.segment_id, c.created_at`,
  );
  const bySegment = new Map<string, typeof courses.rows>();
  for (const row of courses.rows)
    bySegment.set(row.segment_id, [...(bySegment.get(row.segment_id) ?? []), row]);
  const pair = [...bySegment.values()].find((rows) => rows.length >= 2)?.slice(0, 2);
  if (!pair) return;
  const total = pair.reduce((sum, c) => sum + BigInt(c.list_price_poisha), 0n);
  // 80% in whole poisha (integer arithmetic only).
  const price = (total * 80n) / 100n;
  await client.query(
    `INSERT INTO bundle (name_bn, name_en, segment_id, price_poisha, course_ids, created_by)
     VALUES ('ডেমো বান্ডেল', 'Demo bundle', $1, $2, $3, $4)`,
    [pair[0]?.segment_id, price.toString(), pair.map((c) => c.course_id), adminId],
  );
  console.log('Seeded a sample bundle (catalog Bundles list, /bundles/<id>).');
}

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** The demo Student's referral link (the share stays unset until an Admin sets it on A1). */
async function ensureReferral(client: pg.Client) {
  const student = await client.query<{ user_id: string }>(
    `SELECT user_id FROM user_account WHERE email_normalised = 'student@example.test'`,
  );
  const userId = student.rows[0]?.user_id;
  if (!userId) return;
  const code = Array.from(
    randomBytes(10),
    (b) => REFERRAL_ALPHABET[b % REFERRAL_ALPHABET.length],
  ).join('');
  const added = await client.query(
    `INSERT INTO referral_code (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, code],
  );
  if (added.rowCount) console.log('Seeded a referral link for the demo Student (/me/refer).');
}

const PAST_PAPERS = [
  {
    bn: 'বাংলাদেশের সংবিধান কবে কার্যকর হয়?',
    en: 'When did the Constitution of Bangladesh come into force?',
    optionsBn: ['১৬ ডিসেম্বর ১৯৭২', '২৬ মার্চ ১৯৭১', '৪ নভেম্বর ১৯৭২', '২১ ফেব্রুয়ারি ১৯৭৩'],
    optionsEn: ['16 December 1972', '26 March 1971', '4 November 1972', '21 February 1973'],
    correct: 0,
    source: 'BCS preliminary (past paper)',
  },
  {
    bn: 'জাতীয় সংসদের আসন সংখ্যা (সংরক্ষিত মহিলা আসনসহ) কত?',
    en: 'How many seats does the Jatiya Sangsad have, including reserved seats for women?',
    optionsBn: ['৩০০', '৩৩০', '৩৫০', '৩৪৫'],
    optionsEn: ['300', '330', '350', '345'],
    correct: 2,
    source: 'BCS preliminary (past paper)',
  },
  {
    bn: 'মুজিবনগর সরকার কোন জেলায় শপথ নেয়?',
    en: 'In which district did the Mujibnagar government take its oath?',
    optionsBn: ['মেহেরপুর', 'কুষ্টিয়া', 'চুয়াডাঙ্গা', 'যশোর'],
    optionsEn: ['Meherpur', 'Kushtia', 'Chuadanga', 'Jessore'],
    correct: 0,
    source: 'BCS preliminary (past paper)',
  },
];

/** A few public-domain past-paper questions under the first topic in the taxonomy. */
async function ensurePastPapers(client: pg.Client, adminId: string) {
  const topic = await client.query<{ topic_id: string }>(
    `SELECT topic_id FROM topic ORDER BY created_at LIMIT 1`,
  );
  const topicId = topic.rows[0]?.topic_id;
  if (!topicId) {
    console.log('No question taxonomy yet; run pnpm db:seed-bank for past-paper questions.');
    return;
  }
  let added = 0;
  for (const q of PAST_PAPERS) {
    const key = createHash('sha256')
      .update([q.bn, q.en, ...q.optionsBn, ...q.optionsEn].join('|'))
      .digest('hex');
    const r = await client.query(
      `INSERT INTO bank_question (topic_id, difficulty, effective_difficulty, prompt_bn, prompt_en,
         options_bn, options_en, correct_index, source_note, is_past_paper, rights_status,
         import_key, status, author_id, reviewed_by, reviewed_at)
       VALUES ($1, 'medium', 'medium', $2, $3, $4, $5, $6, $7, true, 'public_domain', $8,
         'published', $9, $9, now())
       ON CONFLICT (import_key) DO NOTHING`,
      [topicId, q.bn, q.en, q.optionsBn, q.optionsEn, q.correct, q.source, `demo:${key}`, adminId],
    );
    added += r.rowCount ?? 0;
  }
  if (added) console.log(`Seeded ${added} past-paper questions (label "From past papers").`);
}

/** Demo values for the Admin settings that have no default (pricing and checkout refuse until set). */
const DEMO_SETTINGS: Array<[string, number]> = [
  ['catalog.coursePrice.minPoisha', 10_000], // ৳100
  ['catalog.coursePrice.maxPoisha', 5_000_000], // ৳50,000
  ['catalog.examPackagePrice.maxPoisha', 1_000_000], // ৳10,000
  ['catalog.planMonthlyPrice.maxPoisha', 500_000], // ৳5,000
  ['commerce.refund.windowDays', 7],
];

/** Sets each demo setting once, as the demo Admin's change; a value an Admin already saved is kept. */
async function ensureSettings(client: pg.Client, adminId: string) {
  let added = 0;
  for (const [key, value] of DEMO_SETTINGS) {
    const r = await client.query(
      `INSERT INTO setting_version (setting_key, scope_key, value, version, effective_from, changed_by, reason)
       SELECT $1, 'global', to_jsonb($2::bigint), 1, now(), $3, 'Demo seed: local development default'
       WHERE NOT EXISTS (SELECT 1 FROM setting_version WHERE setting_key = $1 AND scope_key = 'global')`,
      [key, value, adminId],
    );
    added += r.rowCount ?? 0;
  }
  if (added)
    console.log(`Set ${added} Admin settings (price bounds, refund window) for local use.`);
}

async function main() {
  const env = getEnv();
  if (env.NODE_ENV !== 'development' || !isLoopback(env.DATABASE_URL)) {
    throw new Error('The demo seed only writes to a local development database; refusing.');
  }
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const ids: Record<string, string> = {};
    for (const account of DEMO_STAFF) ids[account.role] = await ensureAccount(client, account);
    const adminId = ids.admin as string;
    await ensureSettings(client, adminId);
    await ensureTakedown(client, adminId);
    await ensureSwitchRequest(client);
    await ensurePastPapers(client, adminId);
    await ensureBundle(client, adminId);
    await ensureReferral(client);
    for (const a of DEMO_STAFF)
      console.log(
        `Demo ${a.role} ready (two-step setup on first sign-in): ${a.email} / ${a.password}`,
      );
  } finally {
    await client.end();
  }
}

await main();
