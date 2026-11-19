// Synthetic seed for the catalog e2e journeys, on the LOCAL dev database only (team.md Test data).
// It writes what an Admin would otherwise set first: an active Goal in a fresh segment, the course
// price bounds (when none are set yet), and the instructor role for a freshly signed-up synthetic
// account. Refuses to run unless the app is in development, the database is on a loopback host and
// the e2e target is a local URL, exactly like e2e/local-rate-limits.ts. It never touches staging or
// production data, and no real personal data is used.
import pg from 'pg';
import { getEnv } from '../../src/lib/env.ts';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLoopbackUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

export async function withLocalDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const env = getEnv();
  const target = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  if (
    env.NODE_ENV !== 'development' ||
    !isLoopbackUrl(env.DATABASE_URL) ||
    !isLoopbackUrl(target)
  ) {
    throw new Error('The catalog e2e seed only writes to a local development database; refusing.');
  }
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Makes a verified synthetic account an instructor (what an Admin does on A2) and returns its ID. */
export async function grantInstructor(email: string): Promise<string> {
  return withLocalDb(async (client) => {
    const { rows } = await client.query<{ user_id: string }>(
      'SELECT user_id FROM user_account WHERE email_normalised = $1',
      [email.toLowerCase()],
    );
    const userId = rows[0]?.user_id;
    if (!userId) throw new Error(`no synthetic account ${email}`);
    await client.query(
      `INSERT INTO staff_role_assignment (user_id, role, instructor_type, assigned_by)
       VALUES ($1, 'instructor', 'employee', $1)`,
      [userId],
    );
    return userId;
  });
}

/** An active Goal in a fresh segment, and the course price bounds if none are set yet. */
export async function seedGoalAndPriceBounds(actorId: string): Promise<{ goalNameEn: string }> {
  const suffix = Date.now().toString(36);
  const goalNameEn = `E2E Goal ${suffix}`;
  await withLocalDb(async (client) => {
    const segment = await client.query<{ segment_id: string }>(
      `INSERT INTO goal_segment (name_bn, name_en, segment_type, battle_band, sort_order)
       VALUES ($1, $2, 'job_aspirant', $3, 1) RETURNING segment_id`,
      [`ই২ই সেগমেন্ট ${suffix}`, `E2E Segment ${suffix}`, `e2e_${suffix}`],
    );
    await client.query(
      `INSERT INTO goal (segment_id, name_bn, name_en, status, sort_order)
       VALUES ($1, $2, $3, 'active', 1)`,
      [segment.rows[0]?.segment_id, `ই২ই লক্ষ্য ${suffix}`, goalNameEn],
    );
    for (const [key, value] of [
      ['catalog.coursePrice.minPoisha', 10_000],
      ['catalog.coursePrice.maxPoisha', 5_000_000],
    ] as const) {
      await client.query(
        `INSERT INTO setting_version (setting_key, scope_key, value, version, effective_from, changed_by, reason)
         SELECT $1, 'global', to_jsonb($2::bigint), 1, now(), $3, 'e2e synthetic price bound'
         WHERE NOT EXISTS (SELECT 1 FROM setting_version WHERE setting_key = $1 AND scope_key = 'global')`,
        [key, value, actorId],
      );
    }
  });
  return { goalNameEn };
}

export type SeededGoal = { goalId: string; nameBn: string; nameEn: string };

/** An active Goal in a fresh segment, with Bangla and English names. */
export async function seedGoal(label: string): Promise<SeededGoal> {
  const suffix = `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  return withLocalDb(async (client) => {
    const segment = await client.query<{ segment_id: string }>(
      `INSERT INTO goal_segment (name_bn, name_en, segment_type, battle_band, sort_order)
       VALUES ($1, $2, 'job_aspirant', $3, 1) RETURNING segment_id`,
      [
        `ই২ই সেগমেন্ট ${suffix}`,
        `E2E Segment ${suffix}`,
        `e2e_${suffix.replace(/\W/g, '_').toLowerCase()}`,
      ],
    );
    const nameBn = `ই২ই লক্ষ্য ${suffix}`;
    const nameEn = `E2E Goal ${suffix}`;
    const goal = await client.query<{ goal_id: string }>(
      `INSERT INTO goal (segment_id, name_bn, name_en, status, sort_order)
       VALUES ($1, $2, $3, 'active', 1) RETURNING goal_id`,
      [segment.rows[0]?.segment_id, nameBn, nameEn],
    );
    return { goalId: goal.rows[0]?.goal_id as string, nameBn, nameEn };
  });
}

/**
 * A course in the shape the publish path leaves it (live section version, live text lesson, open
 * Lead ownership period), or a draft when `status` is 'draft'. Used by the browse journeys, whose
 * subject is reading S3 and S4; the real publish path is the instructor-publish journey's subject.
 */
export async function seedCourse(input: {
  goalId: string;
  titleBn: string;
  titleEn: string;
  pricePoisha: number;
  months: 4 | 6 | 12;
  status: 'published' | 'draft';
  lessonTitleEn: string;
}): Promise<{ courseId: string }> {
  return withLocalDb(async (client) => {
    await client.query('BEGIN');
    try {
      const lead = await client.query<{ user_id: string }>(
        `INSERT INTO user_account (email_normalised, display_name, email_verified)
         VALUES ($1, 'E2E Lead', true) RETURNING user_id`,
        [`e2e.lead.${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}@example.test`],
      );
      const leadId = lead.rows[0]?.user_id;
      const isPublished = input.status === 'published';
      const course = await client.query<{ course_id: string }>(
        `INSERT INTO course (goal_id, title_bn, title_en, description_bn, lead_instructor_id,
           list_price_poisha, access_duration_months, status, first_published_at, last_published_at,
           created_by)
         VALUES ($1, $2, $3, 'ই২ই কোর্সের বিবরণ', $4, $5, $6, $7,
           CASE WHEN $8 THEN now() END, CASE WHEN $8 THEN now() END, $4)
         RETURNING course_id`,
        [
          input.goalId,
          input.titleBn,
          input.titleEn,
          leadId,
          input.pricePoisha,
          input.months,
          input.status,
          isPublished,
        ],
      );
      const courseId = course.rows[0]?.course_id as string;
      const section = await client.query<{ section_id: string }>(
        `INSERT INTO section (course_id, position, first_published_at)
         VALUES ($1, 1, CASE WHEN $2 THEN now() END) RETURNING section_id`,
        [courseId, isPublished],
      );
      const sectionId = section.rows[0]?.section_id as string;
      await client.query(
        `INSERT INTO ownership_period (section_id, instructor_id, valid_from, assigned_by, reason)
         VALUES ($1, $2, now(), $2, 'default_lead')`,
        [sectionId, leadId],
      );
      const version = await client.query<{ section_version_id: string }>(
        `INSERT INTO section_version (section_id, version_number, title_bn, title_en, review_state,
           published_at)
         VALUES ($1, 1, 'প্রথম অংশ', 'First part', $2, CASE WHEN $3 THEN now() END)
         RETURNING section_version_id`,
        [sectionId, isPublished ? 'published' : 'draft', isPublished],
      );
      const sectionVersionId = version.rows[0]?.section_version_id;
      const lesson = await client.query<{ lesson_id: string }>(
        `INSERT INTO lesson (section_id, kind, live_state, first_published_at, created_by)
         VALUES ($1, 'text', $2, CASE WHEN $3 THEN now() END, $4) RETURNING lesson_id`,
        [sectionId, isPublished ? 'live' : 'never_published', isPublished, leadId],
      );
      await client.query(
        `INSERT INTO lesson_version (lesson_id, section_version_id, position, title_bn, title_en)
         VALUES ($1, $2, 1, 'ভূমিকা', $3)`,
        [lesson.rows[0]?.lesson_id, sectionVersionId, input.lessonTitleEn],
      );
      await client.query(
        isPublished
          ? 'UPDATE section SET live_version_id = $2 WHERE section_id = $1'
          : 'UPDATE section SET working_version_id = $2 WHERE section_id = $1',
        [sectionId, sectionVersionId],
      );
      await client.query('COMMIT');
      return { courseId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
