// A Student's activity in one course (lesson completions and quiz scores), read for a payment
// dispute's evidence pack (US9.3). Server-only; the caller (TrustOps, Finance) authorizes.
import { getDb } from '#src/server/db.ts';
import { createEvidenceRepository } from '../data/evidence.repository.ts';

const repo = createEvidenceRepository();

export type CourseActivity = {
  completions: Array<{ lessonId: string; at: string }>;
  quizAttempts: Array<{ lessonId: string; score: number; total: number; at: string }>;
};

export async function courseActivityOf(userId: string, courseId: string): Promise<CourseActivity> {
  const db = getDb();
  const [completions, attempts] = await Promise.all([
    repo.completions(db, userId, courseId),
    repo.quizAttempts(db, userId, courseId),
  ]);
  return {
    completions: completions.map((c) => ({
      lessonId: c.lessonId,
      at: c.completedAt.toISOString(),
    })),
    quizAttempts: attempts.map((a) => ({
      lessonId: a.lessonId,
      score: a.score,
      total: a.total,
      at: a.submittedAt.toISOString(),
    })),
  };
}
