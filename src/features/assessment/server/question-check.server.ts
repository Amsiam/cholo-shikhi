// Assessment's answer to Catalog's question-reference port (CR-8): an exam package's question IDs
// must be published bank questions, and a Practice Pack's "question sets" must be published mock
// tests from the exam builder. Registered once at start-up by the composition root.
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '#src/server/db.ts';
import { bankQuestion, exam } from '#src/server/schema/index.ts';

export async function checkQuestionReferences(input: {
  questionIds?: string[];
  questionSetIds?: string[];
  courseId?: string;
}): Promise<{ valid: true } | { valid: false; unknownIds: string[] }> {
  const db = getDb();
  const unknown: string[] = [];
  if (input.questionIds?.length) {
    const found = await db
      .select({ id: bankQuestion.questionId })
      .from(bankQuestion)
      .where(
        and(
          inArray(bankQuestion.questionId, input.questionIds),
          eq(bankQuestion.status, 'published'),
        ),
      );
    const ok = new Set(found.map((r) => r.id));
    unknown.push(...input.questionIds.filter((id) => !ok.has(id)));
  }
  if (input.questionSetIds?.length) {
    const found = await db
      .select({ id: exam.examId })
      .from(exam)
      .where(
        and(
          inArray(exam.examId, input.questionSetIds),
          eq(exam.kind, 'mock'),
          eq(exam.status, 'published'),
        ),
      );
    const ok = new Set(found.map((r) => r.id));
    unknown.push(...input.questionSetIds.filter((id) => !ok.has(id)));
  }
  return unknown.length === 0 ? { valid: true } : { valid: false, unknownIds: unknown };
}
