// Demo catalog for the LOCAL dev database: real exam goals and realistic bilingual courses, so the
// catalog, course page and landing page can be looked at with believable content. Synthetic only:
// instructor accounts use @example.test addresses and invented names (team.md Test data).
//
//   node scripts/seed-demo.ts             seed once (skips if the demo segments exist)
//   node scripts/seed-demo.ts --hide-e2e  also mark leftover "E2E …" goals inactive (reversible)
//
// Refuses to run unless NODE_ENV is development and DATABASE_URL points at a loopback host.

import { hashPassword } from 'better-auth/crypto';
import pg from 'pg';
import { getEnv } from '../src/lib/env.ts';
import {
  ensureDemoInstructor,
  ensureDemoLearningContent,
  ensureDemoPurchases,
} from './seed-demo-learning.ts';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

type Lang = { en: string; bn: string };
type CourseSpec = {
  title: Lang;
  taka: number;
  months: 4 | 6 | 12;
  sections?: Lang[];
  withCo?: boolean;
  pin?: number;
};
type GoalSpec = { name: Lang; courses: CourseSpec[] };
type SegmentSpec = {
  name: Lang;
  type: 'academic' | 'job_aspirant';
  band: string;
  goals: GoalSpec[];
};

const L = (en: string, bn: string): Lang => ({ en, bn });
const GENERIC_SECTIONS = [
  L('Core concepts', 'মৌলিক ধারণা'),
  L('Chapter-wise lessons', 'অধ্যায়ভিত্তিক পাঠ'),
  L('Practice and model tests', 'অনুশীলন ও মডেল টেস্ট'),
];

const INSTRUCTORS = [
  'Tasnim Rahman',
  'Arif Hossain',
  'Nusrat Jahan',
  'Mahmudul Hasan',
  'Farhana Akter',
  'Rakibul Islam',
  'Sadia Afrin',
  'Kamrul Hasan',
];

const DATA: SegmentSpec[] = [
  {
    name: L('Academic', 'একাডেমিক'),
    type: 'academic',
    band: 'demo_academic',
    goals: [
      {
        name: L('Class 6–8', '৬ষ্ঠ–৮ম শ্রেণি'),
        courses: [
          {
            title: L('Class 8 Mathematics Full Course', '৮ম শ্রেণির গণিত পূর্ণাঙ্গ কোর্স'),
            taka: 1500,
            months: 12,
            sections: [
              L('Sets and algebraic expressions', 'সেট ও বীজগাণিতিক রাশি'),
              L('Geometry', 'জ্যামিতি'),
              L('Statistics', 'পরিসংখ্যান'),
            ],
          },
          { title: L('Class 7 Science', '৭ম শ্রেণির বিজ্ঞান'), taka: 1200, months: 12 },
          {
            title: L('English Grammar for Class 6–8', '৬ষ্ঠ–৮ম শ্রেণির ইংরেজি গ্রামার'),
            taka: 1000,
            months: 6,
            sections: [
              L('Parts of speech', 'পদ প্রকরণ'),
              L('Tense', 'কাল'),
              L('Voice and narration', 'বাচ্য ও উক্তি'),
            ],
          },
          {
            title: L('Bangla Grammar and Composition (Class 6–8)', 'বাংলা ব্যাকরণ ও নির্মিতি (৬ষ্ঠ–৮ম)'),
            taka: 1000,
            months: 6,
          },
        ],
      },
      {
        name: L('SSC', 'এসএসসি'),
        courses: [
          {
            title: L('SSC Physics', 'এসএসসি পদার্থবিজ্ঞান'),
            taka: 2000,
            months: 12,
            withCo: true,
            sections: [
              L('Motion and force', 'গতি ও বল'),
              L('Work, power and energy', 'কাজ, ক্ষমতা ও শক্তি'),
              L('Waves and sound', 'তরঙ্গ ও শব্দ'),
              L('Electricity', 'বিদ্যুৎ'),
            ],
          },
          { title: L('SSC Chemistry', 'এসএসসি রসায়ন'), taka: 2000, months: 12 },
          {
            title: L('SSC Higher Mathematics', 'এসএসসি উচ্চতর গণিত'),
            taka: 2000,
            months: 12,
            withCo: true,
          },
          { title: L('SSC Biology', 'এসএসসি জীববিজ্ঞান'), taka: 1800, months: 12 },
        ],
      },
      {
        name: L('HSC', 'এইচএসসি'),
        courses: [
          {
            title: L('HSC Physics 1st Paper', 'এইচএসসি পদার্থবিজ্ঞান ১ম পত্র'),
            taka: 2200,
            months: 12,
            withCo: true,
            sections: [
              L('Vectors', 'ভেক্টর'),
              L('Newtonian mechanics', 'নিউটনিয়ান বলবিদ্যা'),
              L('Gravitation', 'মহাকর্ষ ও অভিকর্ষ'),
            ],
          },
          { title: L('HSC Chemistry 2nd Paper', 'এইচএসসি রসায়ন ২য় পত্র'), taka: 2200, months: 12 },
          {
            title: L('HSC ICT', 'এইচএসসি আইসিটি'),
            taka: 1500,
            months: 6,
            sections: [
              L('Number systems', 'সংখ্যা পদ্ধতি'),
              L('Web design with HTML', 'এইচটিএমএল দিয়ে ওয়েব ডিজাইন'),
              L('Programming in C', 'সি প্রোগ্রামিং'),
            ],
          },
          {
            title: L('HSC English 1st and 2nd Paper', 'এইচএসসি ইংরেজি ১ম ও ২য় পত্র'),
            taka: 1800,
            months: 12,
          },
        ],
      },
      {
        name: L('University admission', 'বিশ্ববিদ্যালয় ভর্তি'),
        courses: [
          {
            title: L('Medical Admission Complete Preparation', 'মেডিকেল ভর্তি সম্পূর্ণ প্রস্তুতি'),
            taka: 6000,
            months: 6,
            withCo: true,
            pin: 1,
            sections: [
              L('Biology', 'জীববিজ্ঞান'),
              L('Chemistry', 'রসায়ন'),
              L('Physics', 'পদার্থবিজ্ঞান'),
              L('English and general knowledge', 'ইংরেজি ও সাধারণ জ্ঞান'),
            ],
          },
          {
            title: L(
              'Engineering Admission (BUET, CKRUET)',
              'ইঞ্জিনিয়ারিং ভর্তি (বুয়েট, চুয়েট-কুয়েট-রুয়েট)',
            ),
            taka: 6000,
            months: 6,
            withCo: true,
          },
          { title: L('Dhaka University Ka Unit', 'ঢাকা বিশ্ববিদ্যালয় ক ইউনিট'), taka: 4500, months: 6 },
          { title: L('Dhaka University Kha Unit', 'ঢাকা বিশ্ববিদ্যালয় খ ইউনিট'), taka: 4000, months: 6 },
        ],
      },
    ],
  },
  {
    name: L('Job exams', 'চাকরির পরীক্ষা'),
    type: 'job_aspirant',
    band: 'demo_jobs',
    goals: [
      {
        name: L('BCS Preliminary', 'বিসিএস প্রিলিমিনারি'),
        courses: [
          {
            title: L('BCS Preliminary Complete Preparation', 'বিসিএস প্রিলিমিনারি সম্পূর্ণ প্রস্তুতি'),
            taka: 4500,
            months: 12,
            withCo: true,
            pin: 1,
            sections: [
              L('Bangla language and literature', 'বাংলা ভাষা ও সাহিত্য'),
              L('English language and literature', 'ইংরেজি ভাষা ও সাহিত্য'),
              L('Bangladesh affairs', 'বাংলাদেশ বিষয়াবলি'),
              L('International affairs', 'আন্তর্জাতিক বিষয়াবলি'),
              L('Mathematical reasoning', 'গাণিতিক যুক্তি'),
            ],
          },
          {
            title: L('BCS Bangla Language and Literature', 'বিসিএস বাংলা ভাষা ও সাহিত্য'),
            taka: 1500,
            months: 6,
            sections: [
              L('Grammar', 'ব্যাকরণ'),
              L('Ancient and medieval literature', 'প্রাচীন ও মধ্যযুগের সাহিত্য'),
              L('Modern literature', 'আধুনিক সাহিত্য'),
            ],
          },
          {
            title: L('BCS English Grammar and Literature', 'বিসিএস ইংরেজি গ্রামার ও সাহিত্য'),
            taka: 1500,
            months: 6,
            sections: [
              L('Parts of speech', 'পদ প্রকরণ'),
              L('Sentence correction', 'বাক্য শুদ্ধিকরণ'),
              L('English literature', 'ইংরেজি সাহিত্য'),
            ],
          },
          {
            title: L('Bangladesh Affairs', 'বাংলাদেশ বিষয়াবলি'),
            taka: 1200,
            months: 6,
            sections: [
              L('Liberation War', 'মুক্তিযুদ্ধ'),
              L('Constitution', 'সংবিধান'),
              L('Economy', 'অর্থনীতি'),
            ],
          },
          {
            title: L('International Affairs', 'আন্তর্জাতিক বিষয়াবলি'),
            taka: 1200,
            months: 6,
            sections: [
              L('International organisations', 'আন্তর্জাতিক সংস্থা'),
              L('Geopolitics', 'ভূরাজনীতি'),
              L('Current affairs', 'সাম্প্রতিক বিষয়াবলি'),
            ],
          },
          {
            title: L('Mathematical Reasoning', 'গাণিতিক যুক্তি'),
            taka: 1000,
            months: 4,
            sections: [
              L('Arithmetic', 'পাটিগণিত'),
              L('Algebra', 'বীজগণিত'),
              L('Geometry', 'জ্যামিতি'),
            ],
          },
          {
            title: L('Mental Ability', 'মানসিক দক্ষতা'),
            taka: 800,
            months: 4,
            sections: [
              L('Verbal reasoning', 'ভাষাগত যুক্তি'),
              L('Analytical ability', 'বিশ্লেষণী দক্ষতা'),
            ],
          },
          {
            title: L('General Science', 'সাধারণ বিজ্ঞান'),
            taka: 1000,
            months: 4,
            sections: [
              L('Physics basics', 'পদার্থবিজ্ঞানের মৌলিক ধারণা'),
              L('Biology', 'জীববিজ্ঞান'),
              L('Chemistry in daily life', 'দৈনন্দিন জীবনে রসায়ন'),
            ],
          },
          {
            title: L('Computer and ICT', 'কম্পিউটার ও তথ্যপ্রযুক্তি'),
            taka: 800,
            months: 4,
            sections: [
              L('Hardware and software', 'হার্ডওয়্যার ও সফটওয়্যার'),
              L('Networks and the internet', 'নেটওয়ার্ক ও ইন্টারনেট'),
            ],
          },
          {
            title: L(
              'Geography, Environment and Disaster Management',
              'ভূগোল, পরিবেশ ও দুর্যোগ ব্যবস্থাপনা',
            ),
            taka: 900,
            months: 4,
            sections: [
              L('Physical geography', 'প্রাকৃতিক ভূগোল'),
              L('Disaster management', 'দুর্যোগ ব্যবস্থাপনা'),
            ],
          },
          {
            title: L('Ethics, Values and Good Governance', 'নৈতিকতা, মূল্যবোধ ও সুশাসন'),
            taka: 700,
            months: 4,
            sections: [L('Ethics and values', 'নৈতিকতা ও মূল্যবোধ'), L('Good governance', 'সুশাসন')],
          },
          {
            title: L('BCS Model Test Series (50 tests)', 'বিসিএস মডেল টেস্ট সিরিজ (৫০টি)'),
            taka: 2000,
            months: 6,
            sections: [
              L('Subject-wise tests', 'বিষয়ভিত্তিক টেস্ট'),
              L('Full model tests', 'পূর্ণাঙ্গ মডেল টেস্ট'),
            ],
          },
          {
            title: L("Last 10 Years' BCS Questions Solved", 'বিগত ১০ বছরের বিসিএস প্রশ্ন সমাধান'),
            taka: 900,
            months: 6,
            sections: [
              L('35th–39th BCS', '৩৫তম–৩৯তম বিসিএস'),
              L('40th–44th BCS', '৪০তম–৪৪তম বিসিএস'),
            ],
          },
          {
            title: L('BCS Crash Course: 60 Days', 'বিসিএস ক্র্যাশ কোর্স: ৬০ দিন'),
            taka: 2500,
            months: 4,
            withCo: true,
            sections: [L('Weeks 1–4', 'সপ্তাহ ১–৪'), L('Weeks 5–8', 'সপ্তাহ ৫–৮')],
          },
        ],
      },
      {
        name: L('Bank jobs', 'ব্যাংক নিয়োগ'),
        courses: [
          {
            title: L('Bank Job Complete Preparation', 'ব্যাংক জব সম্পূর্ণ প্রস্তুতি'),
            taka: 3500,
            months: 12,
            withCo: true,
            pin: 1,
            sections: [
              L('Bangla', 'বাংলা'),
              L('English', 'ইংরেজি'),
              L('Mathematics', 'গণিত'),
              L('General knowledge', 'সাধারণ জ্ঞান'),
            ],
          },
          {
            title: L('Bank Math Shortcuts', 'ব্যাংক গণিত শর্টকাট'),
            taka: 1200,
            months: 6,
            sections: [
              L('Percentages and profit-loss', 'শতকরা ও লাভ-ক্ষতি'),
              L('Time and work', 'সময় ও কাজ'),
              L('Data interpretation', 'ডেটা ইন্টারপ্রিটেশন'),
            ],
          },
          {
            title: L('English for Bank Jobs', 'ব্যাংক জবের জন্য ইংরেজি'),
            taka: 1200,
            months: 6,
            sections: [
              L('Vocabulary', 'শব্দভান্ডার'),
              L('Reading comprehension', 'অনুচ্ছেদ বোঝা'),
              L('Written English', 'লিখিত ইংরেজি'),
            ],
          },
          {
            title: L('Written Exam: Focus Writing and Essay', 'লিখিত পরীক্ষা: ফোকাস রাইটিং ও রচনা'),
            taka: 1500,
            months: 6,
          },
          {
            title: L('Viva Preparation for Bank Jobs', 'ব্যাংক জবের ভাইভা প্রস্তুতি'),
            taka: 800,
            months: 4,
            sections: [
              L('Common questions', 'সাধারণ প্রশ্ন'),
              L('Banking basics', 'ব্যাংকিংয়ের মৌলিক ধারণা'),
            ],
          },
        ],
      },
      {
        name: L('NTRCA teacher registration', 'এনটিআরসিএ শিক্ষক নিবন্ধন'),
        courses: [
          {
            title: L('NTRCA Preliminary (School level)', 'এনটিআরসিএ প্রিলিমিনারি (স্কুল পর্যায়)'),
            taka: 1800,
            months: 6,
          },
          {
            title: L('NTRCA Preliminary (College level)', 'এনটিআরসিএ প্রিলিমিনারি (কলেজ পর্যায়)'),
            taka: 1800,
            months: 6,
          },
          {
            title: L('NTRCA Written: Bangla and English', 'এনটিআরসিএ লিখিত: বাংলা ও ইংরেজি'),
            taka: 1500,
            months: 6,
            withCo: true,
          },
        ],
      },
    ],
  },
];

const LESSONS: Array<{ kind: 'video' | 'text' | 'quiz'; en: string; bn: string }> = [
  { kind: 'video', en: 'Lecture', bn: 'লেকচার' },
  { kind: 'text', en: 'Notes', bn: 'নোট' },
  { kind: 'quiz', en: 'Practice quiz', bn: 'অনুশীলন কুইজ' },
];

function description(title: Lang): Lang {
  return {
    en: `${title.en}: video lectures, chapter notes and practice quizzes in Bangla and English. Every question you get wrong goes into your Mistake Vault and comes back until you get it right.`,
    bn: `${title.bn}: বাংলা ও ইংরেজিতে ভিডিও লেকচার, অধ্যায়ভিত্তিক নোট আর অনুশীলন কুইজ। যে প্রশ্ন ভুল করবেন, তা ভুলের ভল্টে জমা হবে আর সঠিক না হওয়া পর্যন্ত ফিরে আসবে।`,
  };
}

function isLoopback(value: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

async function main() {
  const env = getEnv();
  if (env.NODE_ENV !== 'development' || !isLoopback(env.DATABASE_URL)) {
    throw new Error('The demo seed only writes to a local development database; refusing.');
  }
  const hideE2e = process.argv.includes('--hide-e2e');
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    if (hideE2e) {
      const hidden = await client.query(
        `UPDATE goal SET status = 'inactive', version = version + 1
         WHERE status = 'active' AND name_en LIKE 'E2E %'`,
      );
      console.log(`Marked ${hidden.rowCount} leftover E2E goals inactive.`);
    }
    const existing = await client.query(
      `SELECT 1 FROM goal_segment WHERE battle_band = ANY($1::text[])`,
      [DATA.map((s) => s.band)],
    );
    if (existing.rowCount) {
      console.log('Demo catalog already seeded; nothing to add.');
      await ensureDemoStudent(client);
      return;
    }

    await client.query('BEGIN');
    const instructorIds: string[] = [];
    for (const [index, name] of INSTRUCTORS.entries()) {
      const row = await client.query<{ user_id: string }>(
        `INSERT INTO user_account (email_normalised, display_name, email_verified)
         VALUES ($1, $2, true) RETURNING user_id`,
        [`demo.instructor${index + 1}@example.test`, name],
      );
      instructorIds.push(row.rows[0]?.user_id as string);
    }

    let courseCount = 0;
    let ageDays = 0;
    for (const [segIndex, segment] of DATA.entries()) {
      const seg = await client.query<{ segment_id: string }>(
        `INSERT INTO goal_segment (name_bn, name_en, segment_type, battle_band, sort_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING segment_id`,
        [segment.name.bn, segment.name.en, segment.type, segment.band, segIndex + 1],
      );
      for (const [goalIndex, goalSpec] of segment.goals.entries()) {
        const goal = await client.query<{ goal_id: string }>(
          `INSERT INTO goal (segment_id, name_bn, name_en, status, sort_order)
           VALUES ($1, $2, $3, 'active', $4) RETURNING goal_id`,
          [seg.rows[0]?.segment_id, goalSpec.name.bn, goalSpec.name.en, goalIndex + 1],
        );
        const goalId = goal.rows[0]?.goal_id as string;
        for (const spec of goalSpec.courses) {
          courseCount += 1;
          ageDays += 3;
          const lead = instructorIds[courseCount % instructorIds.length] as string;
          const co = instructorIds[(courseCount + 3) % instructorIds.length] as string;
          const desc = description(spec.title);
          const published = `now() - interval '${ageDays} days'`;
          const course = await client.query<{ course_id: string }>(
            `INSERT INTO course (goal_id, title_bn, title_en, description_bn, description_en,
               lead_instructor_id, list_price_poisha, access_duration_months, status,
               first_published_at, last_published_at, pin_rank, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', ${published}, ${published}, $9, $6)
             RETURNING course_id`,
            [
              goalId,
              spec.title.bn,
              spec.title.en,
              desc.bn,
              desc.en,
              lead,
              spec.taka * 100,
              spec.months,
              spec.pin ?? null,
            ],
          );
          const courseId = course.rows[0]?.course_id as string;
          const sections = spec.sections ?? GENERIC_SECTIONS;
          for (const [sIndex, sec] of sections.entries()) {
            const owner = spec.withCo && sIndex % 2 === 1 ? co : lead;
            const section = await client.query<{ section_id: string }>(
              `INSERT INTO section (course_id, position, first_published_at)
               VALUES ($1, $2, ${published}) RETURNING section_id`,
              [courseId, sIndex + 1],
            );
            const sectionId = section.rows[0]?.section_id as string;
            await client.query(
              `INSERT INTO ownership_period (section_id, instructor_id, valid_from, assigned_by, reason)
               VALUES ($1, $2, ${published}, $3, $4)`,
              [sectionId, owner, lead, owner === lead ? 'default_lead' : 'assigned'],
            );
            const version = await client.query<{ section_version_id: string }>(
              `INSERT INTO section_version (section_id, version_number, title_bn, title_en, review_state, published_at)
               VALUES ($1, 1, $2, $3, 'published', ${published}) RETURNING section_version_id`,
              [sectionId, sec.bn, sec.en],
            );
            const sectionVersionId = version.rows[0]?.section_version_id;
            for (const [lIndex, lesson] of LESSONS.entries()) {
              const row = await client.query<{ lesson_id: string }>(
                `INSERT INTO lesson (section_id, kind, live_state, first_published_at, created_by)
                 VALUES ($1, $2, 'live', ${published}, $3) RETURNING lesson_id`,
                [sectionId, lesson.kind, owner],
              );
              await client.query(
                `INSERT INTO lesson_version (lesson_id, section_version_id, position, title_bn, title_en)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                  row.rows[0]?.lesson_id,
                  sectionVersionId,
                  lIndex + 1,
                  `${lesson.bn}: ${sec.bn}`,
                  `${lesson.en}: ${sec.en}`,
                ],
              );
            }
            await client.query('UPDATE section SET live_version_id = $2 WHERE section_id = $1', [
              sectionId,
              sectionVersionId,
            ]);
          }
        }
      }
    }
    await client.query('COMMIT');
    console.log(
      `Seeded ${DATA.length} segments, ${DATA.reduce((n, s) => n + s.goals.length, 0)} goals, ${courseCount} published courses and ${INSTRUCTORS.length} demo instructors.`,
    );
    await ensureDemoStudent(client);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * A verified demo Student who can sign in straight away, with BCS Preliminary as the current Goal.
 * The password is hashed by Better Auth's own hasher, exactly as sign-up would store it. Local
 * development only: the address is a reserved @example.test one and the password is printed here.
 */
export const DEMO_STUDENT = {
  email: 'student@example.test',
  password: 'DemoStudent2026!',
  displayName: 'Rahim Uddin',
};

async function ensureDemoStudent(client: pg.Client) {
  const found = await client.query<{ user_id: string }>(
    'SELECT user_id FROM user_account WHERE email_normalised = $1',
    [DEMO_STUDENT.email],
  );
  let userId = found.rows[0]?.user_id;
  if (!userId) {
    const created = await client.query<{ user_id: string }>(
      `INSERT INTO user_account (email_normalised, display_name, email_verified, email_verified_at, status, locale)
       VALUES ($1, $2, true, now(), 'active', 'bn') RETURNING user_id`,
      [DEMO_STUDENT.email, DEMO_STUDENT.displayName],
    );
    userId = created.rows[0]?.user_id as string;
  }
  const hasCredential = await client.query(
    `SELECT 1 FROM auth_account WHERE user_id = $1 AND provider_id = 'credential'`,
    [userId],
  );
  if (!hasCredential.rowCount) {
    await client.query(
      `INSERT INTO auth_account (provider_account_id, provider_id, user_id, password_hash)
       VALUES ($1, 'credential', $2, $3)`,
      [userId, userId, await hashPassword(DEMO_STUDENT.password)],
    );
  }
  const hasGoal = await client.query(
    'SELECT 1 FROM student_goal_selection WHERE user_id = $1 AND ended_at IS NULL',
    [userId],
  );
  if (!hasGoal.rowCount) {
    await client.query(
      `INSERT INTO student_goal_selection (user_id, goal_id, segment_id, selected_at)
       SELECT $1, g.goal_id, g.segment_id, now()
       FROM goal g JOIN goal_segment s ON s.segment_id = g.segment_id
       WHERE s.battle_band = 'demo_jobs' AND g.name_en = 'BCS Preliminary'`,
      [userId],
    );
  }
  await ensureDemoLearningContent(client);
  await ensureDemoPurchases(client, userId);
  await ensureDemoInstructor(client, hashPassword);
  console.log(`Demo student ready. Sign in with ${DEMO_STUDENT.email} / ${DEMO_STUDENT.password}`);
}

await main();
