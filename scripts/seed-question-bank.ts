// Development-only demo question bank: four subjects with topics and sub-topics, linked to the
// competitive-exam goals, and a set of published questions. Then the synthetic learners from
// seed-demo-activity answer them once each, so the measured difficulty has something to show.
//
//   pnpm db:seed-bank      (after pnpm db:seed-demo and pnpm db:seed-activity)
//
// Questions are standard textbook facts. Learner answers are synthetic. Refuses to run against
// anything but a loopback database. Safe to run again: it does nothing if the subjects exist.
import pg from 'pg';
import { type Difficulty, effectiveDifficulty } from '../src/features/assessment/domain/bank.ts';
import { getEnv } from '../src/lib/env.ts';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const GOALS = ['BCS Preliminary', 'Bank jobs', 'NTRCA teacher registration'];

type Q = {
  d: Difficulty;
  bn: string;
  en: string;
  obn: [string, string, string, string];
  oen: [string, string, string, string];
  c: number;
  xbn?: string;
  xen?: string;
  src?: string;
  /** Share of synthetic learners who get it right on a first attempt. */
  rate: number;
};
type Topic = { bn: string; en: string; qs?: Q[]; subs?: Topic[] };
type Subject = { bn: string; en: string; topics: Topic[] };

const BANK: Subject[] = [
  {
    bn: 'বাংলা',
    en: 'Bangla',
    topics: [
      {
        bn: 'ব্যাকরণ',
        en: 'Grammar',
        subs: [
          {
            bn: 'সন্ধি',
            en: 'Sandhi',
            qs: [
              {
                d: 'easy',
                bn: '"বিদ্যালয়" শব্দের সঠিক সন্ধিবিচ্ছেদ কোনটি?',
                en: 'Which is the correct sandhi split of "বিদ্যালয়"?',
                obn: ['বিদ্য + আলয়', 'বিদ্যা + আলয়', 'বিদ্যা + লয়', 'বিদ + আলয়'],
                oen: ['বিদ্য + আলয়', 'বিদ্যা + আলয়', 'বিদ্যা + লয়', 'বিদ + আলয়'],
                c: 1,
                xbn: 'আ + আ = আ: বিদ্যা + আলয় = বিদ্যালয়।',
                xen: 'আ + আ = আ: বিদ্যা + আলয় = বিদ্যালয়.',
                rate: 0.86,
              },
              {
                d: 'medium',
                bn: '"সূর্যোদয়" শব্দের সন্ধিবিচ্ছেদ কোনটি?',
                en: 'Which is the sandhi split of "সূর্যোদয়"?',
                obn: ['সূর্য + উদয়', 'সূর্যো + দয়', 'সূর্য + ওদয়', 'সূর্যা + উদয়'],
                oen: ['সূর্য + উদয়', 'সূর্যো + দয়', 'সূর্য + ওদয়', 'সূর্যা + উদয়'],
                c: 0,
                xbn: 'অ + উ = ও: সূর্য + উদয় = সূর্যোদয়।',
                xen: 'অ + উ = ও: সূর্য + উদয় = সূর্যোদয়.',
                rate: 0.74,
              },
              {
                d: 'hard',
                bn: '"নমস্কার" কোন ধরনের সন্ধির উদাহরণ?',
                en: '"নমস্কার" is an example of which kind of sandhi?',
                obn: ['স্বরসন্ধি', 'ব্যঞ্জনসন্ধি', 'বিসর্গসন্ধি', 'নিপাতনে সিদ্ধ'],
                oen: ['Vowel sandhi', 'Consonant sandhi', 'Visarga sandhi', 'Irregular sandhi'],
                c: 2,
                xbn: 'নমঃ + কার = নমস্কার: বিসর্গ স্-এ পরিণত হয়েছে।',
                xen: 'নমঃ + কার = নমস্কার: the visarga becomes স্.',
                rate: 0.31,
              },
            ],
          },
          {
            bn: 'সমাস',
            en: 'Samas',
            qs: [
              {
                d: 'medium',
                bn: '"দশানন" কোন সমাস?',
                en: 'Which samas is "দশানন"?',
                obn: ['দ্বিগু', 'বহুব্রীহি', 'কর্মধারয়', 'তৎপুরুষ'],
                oen: ['Dvigu', 'Bahubrihi', 'Karmadharay', 'Tatpurush'],
                c: 1,
                xbn: 'দশ আনন যার: বহুব্রীহি সমাস।',
                xen: '"One who has ten faces": bahubrihi.',
                rate: 0.42,
              },
              {
                d: 'medium',
                bn: '"ত্রিভুজ" কোন সমাস?',
                en: 'Which samas is "ত্রিভুজ"?',
                obn: ['দ্বিগু', 'দ্বন্দ্ব', 'অব্যয়ীভাব', 'বহুব্রীহি'],
                oen: ['Dvigu', 'Dvandva', 'Abyayibhab', 'Bahubrihi'],
                c: 0,
                xbn: 'তিন ভুজের সমাহার: দ্বিগু সমাস।',
                xen: '"A collection of three sides": dvigu.',
                rate: 0.63,
              },
              {
                d: 'hard',
                bn: '"সিংহাসন" কোন সমাস?',
                en: 'Which samas is "সিংহাসন"?',
                obn: ['উপমিত কর্মধারয়', 'মধ্যপদলোপী কর্মধারয়', 'ষষ্ঠী তৎপুরুষ', 'বহুব্রীহি'],
                oen: [
                  'Upamita karmadharay',
                  'Madhyapadalopi karmadharay',
                  'Shashthi tatpurush',
                  'Bahubrihi',
                ],
                c: 1,
                xbn: 'সিংহ চিহ্নিত আসন: মাঝের পদ "চিহ্নিত" লোপ পেয়েছে।',
                xen: '"A seat marked with a lion": the middle word is dropped.',
                rate: 0.37,
              },
            ],
          },
        ],
      },
      {
        bn: 'সাহিত্য',
        en: 'Literature',
        qs: [
          {
            d: 'easy',
            bn: '"অগ্নিবীণা" কাব্যগ্রন্থের রচয়িতা কে?',
            en: 'Who wrote the poetry collection "Agnibeena"?',
            obn: ['রবীন্দ্রনাথ ঠাকুর', 'কাজী নজরুল ইসলাম', 'জসীমউদ্‌দীন', 'জীবনানন্দ দাশ'],
            oen: ['Rabindranath Tagore', 'Kazi Nazrul Islam', 'Jasimuddin', 'Jibanananda Das'],
            c: 1,
            rate: 0.9,
          },
          {
            d: 'medium',
            bn: '"দুর্গেশনন্দিনী" উপন্যাসের রচয়িতা কে?',
            en: 'Who wrote the novel "Durgeshnandini"?',
            obn: ['বঙ্কিমচন্দ্র চট্টোপাধ্যায়', 'শরৎচন্দ্র চট্টোপাধ্যায়', 'মীর মশাররফ হোসেন', 'প্যারীচাঁদ মিত্র'],
            oen: [
              'Bankim Chandra Chattopadhyay',
              'Sarat Chandra Chattopadhyay',
              'Mir Mosharraf Hossain',
              'Peary Chand Mitra',
            ],
            c: 0,
            xbn: 'প্রকাশ ১৮৬৫; বাংলা সাহিত্যের প্রথম সার্থক উপন্যাস হিসেবে ধরা হয়।',
            xen: 'Published in 1865; regarded as the first successful Bangla novel.',
            rate: 0.66,
          },
        ],
      },
    ],
  },
  {
    bn: 'বাংলাদেশ বিষয়াবলি',
    en: 'Bangladesh affairs',
    topics: [
      {
        bn: 'মুক্তিযুদ্ধ',
        en: 'Liberation War',
        qs: [
          {
            d: 'easy',
            bn: 'বাংলাদেশের স্বাধীনতা দিবস কবে?',
            en: "When is Bangladesh's Independence Day?",
            obn: ['১৬ ডিসেম্বর', '২৬ মার্চ', '২১ ফেব্রুয়ারি', '১৭ এপ্রিল'],
            oen: ['16 December', '26 March', '21 February', '17 April'],
            c: 1,
            rate: 0.94,
          },
          {
            d: 'medium',
            bn: 'মুজিবনগর সরকার কবে শপথ গ্রহণ করে?',
            en: 'When did the Mujibnagar government take its oath?',
            obn: ['১০ এপ্রিল ১৯৭১', '১৭ এপ্রিল ১৯৭১', '২৬ মার্চ ১৯৭১', '১৬ ডিসেম্বর ১৯৭১'],
            oen: ['10 April 1971', '17 April 1971', '26 March 1971', '16 December 1971'],
            c: 1,
            xbn: 'সরকার গঠিত হয় ১০ এপ্রিল; শপথ ১৭ এপ্রিল, মেহেরপুরের বৈদ্যনাথতলায়।',
            xen: 'Formed on 10 April; sworn in on 17 April at Baidyanathtala, Meherpur.',
            rate: 0.55,
          },
          {
            d: 'medium',
            bn: 'মুক্তিযুদ্ধের সময় বাংলাদেশকে কয়টি সেক্টরে ভাগ করা হয়েছিল?',
            en: 'Into how many sectors was Bangladesh divided during the Liberation War?',
            obn: ['৯টি', '১০টি', '১১টি', '১২টি'],
            oen: ['9', '10', '11', '12'],
            c: 2,
            rate: 0.81,
          },
        ],
      },
      {
        bn: 'ভূগোল',
        en: 'Geography',
        qs: [
          {
            d: 'easy',
            bn: 'বাংলাদেশে বর্তমানে কয়টি বিভাগ আছে?',
            en: 'How many divisions does Bangladesh have now?',
            obn: ['৬টি', '৭টি', '৮টি', '৯টি'],
            oen: ['6', '7', '8', '9'],
            c: 2,
            xbn: 'ময়মনসিংহ ২০১৫ সালে অষ্টম বিভাগ হয়।',
            xen: 'Mymensingh became the eighth division in 2015.',
            rate: 0.88,
          },
          {
            d: 'medium',
            bn: 'আয়তনে বাংলাদেশের বৃহত্তম জেলা কোনটি?',
            en: 'Which is the largest district of Bangladesh by area?',
            obn: ['খুলনা', 'বান্দরবান', 'রাঙ্গামাটি', 'সিলেট'],
            oen: ['Khulna', 'Bandarban', 'Rangamati', 'Sylhet'],
            c: 2,
            rate: 0.58,
          },
        ],
      },
    ],
  },
  {
    bn: 'গণিত',
    en: 'Mathematics',
    topics: [
      {
        bn: 'পাটিগণিত',
        en: 'Arithmetic',
        subs: [
          {
            bn: 'শতকরা',
            en: 'Percentage',
            qs: [
              {
                d: 'easy',
                bn: '৮০-এর ২৫% কত?',
                en: 'What is 25% of 80?',
                obn: ['১৬', '২০', '২৫', '৩২'],
                oen: ['16', '20', '25', '32'],
                c: 1,
                rate: 0.92,
              },
              {
                d: 'medium',
                bn: 'একটি জিনিসের দাম ২০% বাড়িয়ে পরে ২০% কমানো হলো। মোট পরিবর্তন কত?',
                en: 'A price rises by 20% and then falls by 20%. What is the net change?',
                obn: ['কোনো পরিবর্তন নেই', '৪% কম', '৪% বেশি', '২% কম'],
                oen: ['No change', '4% lower', '4% higher', '2% lower'],
                c: 1,
                xbn: '১০০ → ১২০ → ৯৬: মোট ৪% কম।',
                xen: '100 → 120 → 96: 4% lower overall.',
                rate: 0.47,
              },
            ],
          },
          {
            bn: 'ল.সা.গু ও গ.সা.গু',
            en: 'LCM and HCF',
            qs: [
              {
                d: 'easy',
                bn: '১২ ও ১৮-এর ল.সা.গু কত?',
                en: 'What is the LCM of 12 and 18?',
                obn: ['৬', '২৪', '৩৬', '৭২'],
                oen: ['6', '24', '36', '72'],
                c: 2,
                rate: 0.84,
              },
              {
                d: 'medium',
                bn: '৪৮ ও ৭২-এর গ.সা.গু কত?',
                en: 'What is the HCF of 48 and 72?',
                obn: ['১২', '১৬', '২৪', '৩৬'],
                oen: ['12', '16', '24', '36'],
                c: 2,
                rate: 0.71,
              },
            ],
          },
        ],
      },
      {
        bn: 'সরল সুদ',
        en: 'Simple interest',
        qs: [
          {
            d: 'medium',
            bn: '১,০০০ টাকার ৫% হার সরল সুদে ২ বছরের সুদ কত?',
            en: 'What is the simple interest on Tk 1,000 at 5% a year for 2 years?',
            obn: ['৫০ টাকা', '১০০ টাকা', '১০৫ টাকা', '১৫০ টাকা'],
            oen: ['Tk 50', 'Tk 100', 'Tk 105', 'Tk 150'],
            c: 1,
            xbn: '১,০০০ × ৫ × ২ ÷ ১০০ = ১০০ টাকা।',
            xen: '1,000 × 5 × 2 ÷ 100 = Tk 100.',
            rate: 0.83,
          },
        ],
      },
    ],
  },
  {
    bn: 'ইংরেজি',
    en: 'English',
    topics: [
      {
        bn: 'শব্দভান্ডার',
        en: 'Vocabulary',
        qs: [
          {
            d: 'easy',
            bn: '"Abundant" শব্দের সমার্থক কোনটি?',
            en: 'Which word means the same as "abundant"?',
            obn: ['Scarce', 'Plentiful', 'Rare', 'Empty'],
            oen: ['Scarce', 'Plentiful', 'Rare', 'Empty'],
            c: 1,
            rate: 0.82,
          },
          {
            d: 'medium',
            bn: '"Transparent" শব্দের বিপরীত শব্দ কোনটি?',
            en: 'Which word is the opposite of "transparent"?',
            obn: ['Clear', 'Opaque', 'Visible', 'Bright'],
            oen: ['Clear', 'Opaque', 'Visible', 'Bright'],
            c: 1,
            rate: 0.61,
          },
        ],
      },
      {
        bn: 'ব্যাকরণ',
        en: 'Grammar',
        qs: [
          {
            d: 'easy',
            bn: 'শূন্যস্থান পূরণ করুন: He is good ___ mathematics.',
            en: 'Fill in the blank: He is good ___ mathematics.',
            obn: ['in', 'at', 'on', 'with'],
            oen: ['in', 'at', 'on', 'with'],
            c: 1,
            rate: 0.64,
          },
          {
            d: 'medium',
            bn: '"Criterion" শব্দের বহুবচন কোনটি?',
            en: 'What is the plural of "criterion"?',
            obn: ['Criterions', 'Criteria', 'Criterias', 'Criteriae'],
            oen: ['Criterions', 'Criteria', 'Criterias', 'Criteriae'],
            c: 1,
            rate: 0.52,
          },
        ],
      },
    ],
  },
];

/** A small seeded random generator, so reruns on a fresh database give the same numbers. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const url = new URL(getEnv().DATABASE_URL);
  if (!LOOPBACK_HOSTS.has(url.hostname))
    throw new Error('seed-question-bank runs only against a local database');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM subject WHERE name_en = 'Bangladesh affairs'");
    if (exists.rowCount) {
      console.log('Question bank already seeded.');
      await seedExams(client);
      await seedProducts(client);
      return;
    }
    const author = await client.query<{ user_id: string }>(
      `SELECT r.user_id FROM staff_role_assignment r JOIN user_account u ON u.user_id = r.user_id
       WHERE r.revoked_at IS NULL AND r.role IN ('instructor', 'admin')
       ORDER BY (u.email_normalised LIKE 'demo.%') DESC, r.assigned_at LIMIT 1`,
    );
    const authorId = author.rows[0]?.user_id;
    if (!authorId) throw new Error('No staff account found; run pnpm db:seed-demo first.');
    const goals = await client.query<{ goal_id: string }>(
      'SELECT goal_id FROM goal WHERE name_en = ANY($1)',
      [GOALS],
    );
    const learners = await client.query<{ user_id: string }>(
      "SELECT user_id FROM user_account WHERE email_normalised LIKE 'learner%@example.test'",
    );
    const random = mulberry32(2026);
    let questions = 0;
    let answers = 0;

    await client.query('BEGIN');
    for (const [si, s] of BANK.entries()) {
      const { rows } = await client.query<{ subject_id: string }>(
        'INSERT INTO subject (name_bn, name_en, sort_order) VALUES ($1, $2, $3) RETURNING subject_id',
        [s.bn, s.en, si],
      );
      const subjectId = rows[0]?.subject_id as string;
      for (const g of goals.rows)
        await client.query('INSERT INTO subject_goal (subject_id, goal_id) VALUES ($1, $2)', [
          subjectId,
          g.goal_id,
        ]);
      const addTopic = async (tp: Topic, order: number, parent: string | null) => {
        const r = await client.query<{ topic_id: string }>(
          `INSERT INTO topic (subject_id, parent_topic_id, name_bn, name_en, sort_order)
           VALUES ($1, $2, $3, $4, $5) RETURNING topic_id`,
          [subjectId, parent, tp.bn, tp.en, order],
        );
        const topicId = r.rows[0]?.topic_id as string;
        for (const q of tp.qs ?? []) {
          // Synthetic first attempts: each learner answers once, right with the question's rate.
          const takers = learners.rows.filter(() => random() < 0.7);
          const results = takers.map((l) => ({ userId: l.user_id, ok: random() < q.rate }));
          const correct = results.filter((x) => x.ok).length;
          const qr = await client.query<{ question_id: string }>(
            `INSERT INTO bank_question (topic_id, difficulty, effective_difficulty, prompt_bn, prompt_en,
               options_bn, options_en, correct_index, explanation_bn, explanation_en, source_note,
               status, author_id, reviewed_by, reviewed_at, first_attempts, first_correct)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'published', $12, $12, now(), $13, $14)
             RETURNING question_id`,
            [
              topicId,
              q.d,
              effectiveDifficulty(q.d, results.length, correct),
              q.bn,
              q.en,
              q.obn,
              q.oen,
              q.c,
              q.xbn ?? null,
              q.xen ?? null,
              q.src ?? null,
              authorId,
              results.length,
              correct,
            ],
          );
          const questionId = qr.rows[0]?.question_id as string;
          for (const x of results) {
            const wrong = [0, 1, 2, 3].filter((i) => i !== q.c);
            const chosen = x.ok ? q.c : (wrong[Math.floor(random() * 3)] as number);
            await client.query(
              `INSERT INTO bank_answer (user_id, question_id, chosen_index, is_correct, answered_at)
               VALUES ($1, $2, $3, $4, now() - ($5 || ' hours')::interval)`,
              [x.userId, questionId, chosen, x.ok, String(Math.floor(random() * 24 * 60))],
            );
          }
          questions += 1;
          answers += results.length;
        }
        for (const [i, sub] of (tp.subs ?? []).entries()) await addTopic(sub, i, topicId);
      };
      for (const [ti, tp] of s.topics.entries()) await addTopic(tp, ti, null);
    }
    await client.query('COMMIT');
    await seedExams(client);
    await seedProducts(client);
    console.log(
      `Question bank: ${BANK.length} subjects, ${questions} questions, ${answers} synthetic first attempts, linked to ${goals.rowCount} goal(s).`,
    );
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

/** One mock test and one upcoming live exam for the BCS goal, drawn from the bank (once). */
async function seedExams(client: pg.Client) {
  const has = await client.query("SELECT 1 FROM exam WHERE title_en = 'BCS model test 1'");
  if (has.rowCount) return;
  const goal = await client.query<{ goal_id: string }>(
    "SELECT goal_id FROM goal WHERE name_en = 'BCS Preliminary' LIMIT 1",
  );
  const author = await client.query<{ user_id: string }>(
    "SELECT r.user_id FROM staff_role_assignment r WHERE r.revoked_at IS NULL AND r.role IN ('admin', 'instructor') ORDER BY (r.role = 'admin') DESC, r.assigned_at LIMIT 1",
  );
  const goalId = goal.rows[0]?.goal_id;
  const authorId = author.rows[0]?.user_id;
  if (!goalId || !authorId) return;
  const ids = (
    await client.query<{ question_id: string }>(
      "SELECT question_id FROM bank_question WHERE status = 'published' ORDER BY question_id",
    )
  ).rows.map((r) => r.question_id);
  if (ids.length < 10) return;
  const subjects = await client.query<{ topic_id: string }>(
    'SELECT topic_id FROM topic WHERE parent_topic_id IS NULL ORDER BY sort_order LIMIT 1',
  );
  const blueprint = JSON.stringify([
    {
      topicId: subjects.rows[0]?.topic_id,
      difficulty: null,
      count: Math.min(ids.length, 20),
    },
  ]);
  const insert = `INSERT INTO exam (kind, status, title_bn, title_en, goal_id, duration_minutes, negative_bps,
      starts_at, blueprint, question_ids, created_by, published_at)
    VALUES ($1, 'published', $2, $3, $4, $5, 5000, $6, $7::jsonb, $8, $9, now())`;
  const pickIds = ids.slice(0, Math.min(ids.length, 20));
  await client.query(insert, [
    'mock',
    'বিসিএস মডেল টেস্ট ১',
    'BCS model test 1',
    goalId,
    20,
    null,
    blueprint,
    pickIds,
    authorId,
  ]);
  // Tomorrow 20:00 Dhaka (14:00 UTC).
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(14, 0, 0, 0);
  await client.query(insert, [
    'live',
    'সাপ্তাহিক লাইভ পরীক্ষা',
    'Weekly live exam',
    goalId,
    30,
    start,
    blueprint,
    pickIds,
    authorId,
  ]);
  console.log('Exams: a mock test and an upcoming live exam for BCS Preliminary.');
}

/**
 * Demo products for BCS Preliminary (once): an exam package of the bank's questions, a monthly plan
 * with the first BCS course and that package, and a Practice Pack of the BCS mock test on that
 * course. Published directly, as the catalog's publish flow would leave them.
 */
async function seedProducts(client: pg.Client) {
  const has = await client.query(
    "SELECT 1 FROM exam_package WHERE title_en = 'BCS model test package'",
  );
  if (has.rowCount) return;
  const goal = await client.query<{ goal_id: string }>(
    "SELECT goal_id FROM goal WHERE name_en = 'BCS Preliminary' LIMIT 1",
  );
  const goalId = goal.rows[0]?.goal_id;
  const course = await client.query<{ course_id: string; lead_instructor_id: string }>(
    "SELECT course_id, lead_instructor_id FROM course WHERE goal_id = $1 AND status = 'published' ORDER BY created_at LIMIT 1",
    [goalId],
  );
  const mock = await client.query<{ exam_id: string; created_by: string }>(
    "SELECT exam_id, created_by FROM exam WHERE title_en = 'BCS model test 1' LIMIT 1",
  );
  const questions = await client.query<{ question_id: string }>(
    "SELECT question_id FROM bank_question WHERE status = 'published' ORDER BY question_id LIMIT 15",
  );
  const c = course.rows[0];
  const m = mock.rows[0];
  if (!goalId || !c || !m || questions.rowCount === 0) return;
  const by = c.lead_instructor_id;
  await client.query('BEGIN');
  try {
    const pkg = await client.query<{ exam_package_id: string }>(
      `INSERT INTO exam_package (goal_id, title_bn, title_en, list_price_poisha, status, created_by, first_published_at)
       VALUES ($1, 'বিসিএস মডেল টেস্ট প্যাকেজ', 'BCS model test package', 19900, 'draft', $2, now())
       RETURNING exam_package_id`,
      [goalId, by],
    );
    const packageId = pkg.rows[0]?.exam_package_id as string;
    const ver = await client.query<{ exam_package_version_id: string }>(
      `INSERT INTO exam_package_version (exam_package_id, version_number, question_ids, time_limit_minutes, published_at, published_by)
       VALUES ($1, 1, $2, 20, now(), $3) RETURNING exam_package_version_id`,
      [packageId, questions.rows.map((q) => q.question_id), by],
    );
    await client.query(
      "UPDATE exam_package SET status = 'published', current_version_id = $2 WHERE exam_package_id = $1",
      [packageId, ver.rows[0]?.exam_package_version_id],
    );
    const plan = await client.query<{ plan_id: string }>(
      `INSERT INTO subscription_plan (goal_id, name_bn, name_en, status, draft_monthly_price_poisha, created_by, first_published_at)
       VALUES ($1, 'বিসিএস মাসিক', 'BCS monthly', 'draft', 29900, $2, now()) RETURNING plan_id`,
      [goalId, by],
    );
    const planId = plan.rows[0]?.plan_id as string;
    const pv = await client.query<{ plan_version_id: string }>(
      `INSERT INTO subscription_plan_version (plan_id, version_number, monthly_price_poisha, published_at, published_by)
       VALUES ($1, 1, 29900, now(), $2) RETURNING plan_version_id`,
      [planId, by],
    );
    const planVersionId = pv.rows[0]?.plan_version_id as string;
    await client.query(
      "INSERT INTO subscription_plan_version_item (plan_version_id, item_type, course_id) VALUES ($1, 'course', $2)",
      [planVersionId, c.course_id],
    );
    await client.query(
      "INSERT INTO subscription_plan_version_item (plan_version_id, item_type, exam_package_id) VALUES ($1, 'exam_package', $2)",
      [planVersionId, packageId],
    );
    await client.query(
      "UPDATE subscription_plan SET status = 'published', current_version_id = $2 WHERE plan_id = $1",
      [planId, planVersionId],
    );
    await client.query(
      `INSERT INTO practice_pack (course_id, title_bn, title_en, list_price_poisha, question_set_ids, status, created_by, first_published_at)
       VALUES ($1, 'শেষ মুহূর্তের প্যাক', 'Last-minute pack', 14900, $2, 'published', $3, now())`,
      [c.course_id, [m.exam_id], by],
    );
    await client.query('COMMIT');
    console.log(
      'Products: an exam package, a monthly plan and a Practice Pack for BCS Preliminary.',
    );
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

await main();
