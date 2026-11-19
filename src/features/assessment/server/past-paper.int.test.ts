// [LT] US4.7: importing past-paper questions. Valid rows are published with the past-paper label
// (which Students' practice questions carry), bad rows come back per line, a repeat import adds
// nothing, and only Admins may import.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toCsv } from '#src/features/platform/index.ts';
import { getDb } from '#src/server/db.ts';
import { bankQuestion } from '#src/server/schema/index.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { PAST_PAPER_COLUMNS } from '../domain/past-paper.ts';
import { practiceQuestionsFor } from './bank.server.ts';

let s: ServerFnHarness;
let topicId: string;
const tag = Math.random().toString(36).slice(2, 8);
const subjectEn = `Past ${tag}`;

const value = <T>(r: unknown): T => {
  const result = r as { ok: boolean; value?: T; error?: unknown };
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value as T;
};

beforeAll(async () => {
  s = await createServerFnHarness();
  const { subjectId } = value<{ subjectId: string }>(
    await s.call('saveQuestionSubject', s.admin.request, {
      nameBn: `অতীত ${tag}`,
      nameEn: subjectEn,
    }),
  );
  topicId = value<{ topicId: string }>(
    await s.call('saveQuestionTopic', s.admin.request, {
      subjectId,
      nameBn: 'ইতিহাস',
      nameEn: 'History',
    }),
  ).topicId;
}, 120_000);
afterAll(async () => {
  await s?.close();
});

const row = (
  n: number,
  over: Partial<Record<(typeof PAST_PAPER_COLUMNS)[number], string>> = {},
) => {
  const r: Record<string, string> = {
    subject_en: subjectEn,
    topic_en: 'history',
    difficulty: 'medium',
    prompt_bn: `প্রশ্ন ${tag} ${n}`,
    prompt_en: `Question ${tag} ${n}`,
    option1_bn: 'ক',
    option2_bn: 'খ',
    option3_bn: 'গ',
    option4_bn: 'ঘ',
    option1_en: 'A',
    option2_en: 'B',
    option3_en: 'C',
    option4_en: 'D',
    correct: '2',
    explanation_bn: '',
    explanation_en: '',
    source: 'BCS 43 preliminary (2021)',
    rights: 'public_domain',
    ...over,
  };
  return PAST_PAPER_COLUMNS.map((c) => r[c] ?? '');
};
const csvOf = (rows: string[][]) => toCsv([...PAST_PAPER_COLUMNS], rows).toString('utf8');

describe('past-paper import', () => {
  it('imports valid rows with the label, reports bad rows, and never duplicates', async () => {
    const csv = csvOf([
      row(1),
      row(2, { rights: '' }),
      row(3, { topic_en: 'Not a topic' }),
      row(4, { rights: 'rights_cleared' }),
    ]);
    const first = value<{
      imported: number;
      duplicates: number;
      rejected: Array<{ line: number; reasons: string[] }>;
    }>(await s.call('importPastPaperQuestions', s.admin.request, { csv }));
    expect(first).toEqual({
      imported: 2,
      duplicates: 0,
      rejected: [
        { line: 3, reasons: ['rightsMissing'] },
        { line: 4, reasons: ['taxonomy'] },
      ],
    });
    const stored = await getDb()
      .select()
      .from(bankQuestion)
      .where(eq(bankQuestion.topicId, topicId));
    expect(stored).toHaveLength(2);
    expect(stored.every((q) => q.isPastPaper && q.status === 'published')).toBe(true);
    expect(stored.map((q) => q.rightsStatus).sort()).toEqual(['public_domain', 'rights_cleared']);

    const again = value<{ imported: number; duplicates: number }>(
      await s.call('importPastPaperQuestions', s.admin.request, { csv }),
    );
    expect(again).toMatchObject({ imported: 0, duplicates: 2 });

    const student = await s.newStudent();
    const practice = await practiceQuestionsFor(student.userId, topicId, null, 10);
    expect(practice).toHaveLength(2);
    expect(practice.every((q) => q.isPastPaper)).toBe(true);
  });

  it('refuses a file without the required columns, and non-Admins', async () => {
    expect(
      await s.call('importPastPaperQuestions', s.admin.request, { csv: 'prompt_en\nHello' }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.pastPaper.columns' } });
    const instructor = await s.newInstructor();
    expect(
      (await s.call('importPastPaperQuestions', instructor.request, { csv: csvOf([row(9)]) })).ok,
    ).toBe(false);
  });
});
