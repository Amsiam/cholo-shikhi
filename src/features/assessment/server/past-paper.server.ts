// US4.7 (A12): an Admin with two-step sign-in imports past-paper questions from a CSV. Valid rows
// are published straight into the bank with the "from past papers" label and their rights basis;
// rejected rows come back in a per-row report; a question already imported is skipped, never
// duplicated. One audit entry records the counts.
import { createHash } from 'node:crypto';
import type { Actor } from '#src/features/identity-access/index.ts';
import { createAudit } from '#src/features/platform/index.ts';
import { parseCsv } from '#src/lib/csv-parse.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createBankRepository } from '../data/bank.repository.ts';
import {
  MAX_IMPORT_ROWS,
  missingColumns,
  parsePastPaperRow,
  topicLookupKey,
} from '../domain/past-paper.ts';
import { ImportPastPapersInput } from './bank.schema.ts';

const repo = createBankRepository();
const audit = createAudit({ clock: systemClock });

export type PastPaperReport = {
  imported: number;
  duplicates: number;
  rejected: Array<{ line: number; reasons: string[] }>;
};
type ImportError = AppError<'FORBIDDEN' | 'VALIDATION_FAILED'>;
const fail = (code: ImportError['code'], i18nKey: `errors.${string}`, params?: object) =>
  err({ ...appError(code), i18nKey, ...(params ? { params } : {}) } as ImportError);

export async function importPastPapers(
  actor: Actor,
  raw: ImportPastPapersInput,
  correlationId: string,
): Promise<Result<PastPaperReport, ImportError>> {
  if (!(actor.roles.includes('admin') && actor.hasStepUp))
    return fail('FORBIDDEN', 'errors.pastPaper.forbidden');
  const parsed = parseCsv(ImportPastPapersInput.parse(raw).csv);
  if (!parsed.ok) return fail('VALIDATION_FAILED', 'errors.pastPaper.unreadable');
  if (missingColumns(parsed.header).length > 0)
    return fail('VALIDATION_FAILED', 'errors.pastPaper.columns');
  if (parsed.records.length === 0) return fail('VALIDATION_FAILED', 'errors.pastPaper.empty');
  if (parsed.records.length > MAX_IMPORT_ROWS)
    return fail('VALIDATION_FAILED', 'errors.pastPaper.tooMany');

  const db = getDb();
  const [subjects, topics] = await Promise.all([repo.subjects(db), repo.topics(db)]);
  const subjectName = new Map(subjects.map((s) => [s.subjectId, s.nameEn]));
  const lookup = new Map(
    topics.map((t) => [topicLookupKey(subjectName.get(t.subjectId) ?? '', t.nameEn), t.topicId]),
  );
  const report: PastPaperReport = { imported: 0, duplicates: 0, rejected: [] };
  return withTransaction(db, async (tx) => {
    const exec = unwrapTx(tx);
    const seen = new Set<string>();
    for (const record of parsed.records) {
      const row = parsePastPaperRow(record.fields, lookup);
      if (!row.ok) {
        report.rejected.push({ line: record.line, reasons: row.reasons });
        continue;
      }
      const importKey = createHash('sha256').update(row.value.fingerprint).digest('hex');
      if (seen.has(importKey)) {
        report.duplicates += 1;
        continue;
      }
      seen.add(importKey);
      const id = await repo.insertImported(exec, {
        ...row.value.question,
        topicId: row.value.topicId,
        difficulty: row.value.difficulty,
        authorId: actor.userId,
        rightsStatus: row.value.rightsStatus,
        importKey,
      });
      if (id) report.imported += 1;
      else report.duplicates += 1;
    }
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'assessment.pastPapers.imported',
      subjectType: 'bank_question',
      subjectId: actor.userId,
      after: {
        imported: report.imported,
        duplicates: report.duplicates,
        rejected: report.rejected.length,
      },
      correlationId,
    });
    return ok(report);
  });
}
