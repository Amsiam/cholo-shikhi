// US4.7 past-paper import rules. Plain TypeScript.
// One CSV row is one question. A row is rejected, with every reason listed, when it has no rights
// status, names a subject or topic missing from the taxonomy, has no source, or fails the bank's
// question rules; valid rows are still imported. A fingerprint of the question's text lets a
// repeated import skip questions already in the bank.

import type { CleanBankQuestion } from './bank.ts';
import { DIFFICULTIES, type Difficulty, SOURCE_MAX, validateBankQuestion } from './bank.ts';

export const PAST_PAPER_COLUMNS = [
  'subject_en',
  'topic_en',
  'difficulty',
  'prompt_bn',
  'prompt_en',
  'option1_bn',
  'option2_bn',
  'option3_bn',
  'option4_bn',
  'option1_en',
  'option2_en',
  'option3_en',
  'option4_en',
  'correct',
  'explanation_bn',
  'explanation_en',
  'source',
  'rights',
] as const;
export const RIGHTS_STATUSES = ['public_domain', 'rights_cleared'] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];
export const MAX_IMPORT_ROWS = 2000;

/** Topics by "subject name / topic name" (English, case-insensitive); a sub-topic matches too. */
export type TopicLookup = ReadonlyMap<string, string>;
export const topicLookupKey = (subjectEn: string, topicEn: string) =>
  `${subjectEn.trim().toLocaleLowerCase()}/${topicEn.trim().toLocaleLowerCase()}`;

export type PastPaperRow = {
  question: CleanBankQuestion & { sourceNote: string };
  topicId: string;
  difficulty: Difficulty;
  rightsStatus: RightsStatus;
  fingerprint: string;
};

/** Columns the header lacks. */
export function missingColumns(header: readonly string[]): string[] {
  return PAST_PAPER_COLUMNS.filter((c) => !header.includes(c));
}

const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** The same question text and options (either language) give the same fingerprint. */
export function fingerprintOf(q: {
  promptBn: string;
  promptEn: string;
  optionsBn: readonly string[];
  optionsEn: readonly string[];
}): string {
  return [q.promptBn, q.promptEn, ...q.optionsBn, ...q.optionsEn].map(norm).join('␟');
}

/** One row checked; the reasons are message keys under `pastPaper.reason.`. */
export function parsePastPaperRow(
  fields: Readonly<Record<string, string>>,
  topics: TopicLookup,
): { ok: true; value: PastPaperRow } | { ok: false; reasons: string[] } {
  const f = (k: (typeof PAST_PAPER_COLUMNS)[number]) => (fields[k] ?? '').trim();
  const reasons: string[] = [];
  const rights = f('rights').toLowerCase();
  if (!rights) reasons.push('rightsMissing');
  else if (!(RIGHTS_STATUSES as readonly string[]).includes(rights)) reasons.push('rightsInvalid');
  const topicId = topics.get(topicLookupKey(f('subject_en'), f('topic_en')));
  if (!topicId) reasons.push('taxonomy');
  const difficulty = (f('difficulty').toLowerCase() || 'medium') as Difficulty;
  if (!DIFFICULTIES.includes(difficulty)) reasons.push('difficulty');
  const source = f('source');
  if (!source) reasons.push('sourceMissing');
  else if (source.length > SOURCE_MAX) reasons.push('sourceTooLong');
  const correct = Number(f('correct'));
  const draft = {
    promptBn: f('prompt_bn'),
    promptEn: f('prompt_en'),
    optionsBn: [f('option1_bn'), f('option2_bn'), f('option3_bn'), f('option4_bn')],
    optionsEn: [f('option1_en'), f('option2_en'), f('option3_en'), f('option4_en')],
    correctIndex: Number.isInteger(correct) ? correct - 1 : -1,
    explanationBn: f('explanation_bn'),
    explanationEn: f('explanation_en'),
    sourceNote: source.slice(0, SOURCE_MAX),
  };
  const clean = validateBankQuestion(draft);
  if (!clean.ok) {
    const fields = Object.keys(clean.error.fieldErrors ?? {});
    if (fields.some((k) => k.startsWith('prompt'))) reasons.push('prompt');
    if (fields.some((k) => k.startsWith('options'))) reasons.push('options');
    if (fields.includes('correctIndex')) reasons.push('correct');
    if (fields.some((k) => k.startsWith('explanation'))) reasons.push('explanation');
  }
  if (reasons.length > 0 || !clean.ok || !topicId) return { ok: false, reasons };
  return {
    ok: true,
    value: {
      question: { ...clean.value, sourceNote: source },
      topicId,
      difficulty,
      rightsStatus: rights as RightsStatus,
      fingerprint: fingerprintOf(clean.value),
    },
  };
}
