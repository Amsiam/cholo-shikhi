// A12 past-paper import (US4.7): choose a CSV of past-paper questions, import it, and read the
// report: how many were added, how many were already in the bank, and each rejected row with why.
import { FileUp } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PAST_PAPER_COLUMNS } from '../domain/past-paper.ts';
import type { PastPaperReport } from '../server/past-paper.server.ts';

type Outcome = { ok: true; value: PastPaperReport } | { ok: false; error: { i18nKey?: string } };

const card = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';
const MAX_BYTES = 2_000_000;

export function PastPaperImport(props: { onImport: (csv: string) => Promise<Outcome> }) {
  const { t, tDynamic, formatInteger } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [report, setReport] = useState<PastPaperReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!file) return;
    setError(null);
    setReport(null);
    if (file.size > MAX_BYTES) {
      setError('errors.pastPaper.tooLarge');
      return;
    }
    setIsBusy(true);
    const r = await props.onImport(await file.text());
    setIsBusy(false);
    if (r.ok) setReport(r.value);
    else setError(r.error.i18nKey ?? 'errors.pastPaper.unreadable');
  };
  return (
    <div className="flex flex-col gap-6" data-testid="past-paper-import">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t('pastPaper.title')}
        </h1>
        <p className="text-ink/75">{t('pastPaper.subtitle')}</p>
      </header>
      <section className={card} aria-labelledby="pp-file">
        <h2 id="pp-file" className="flex items-center gap-2 text-xl font-bold">
          <FileUp aria-hidden="true" className="size-5 text-primary" />
          {t('pastPaper.file')}
        </h2>
        <p className="text-sm text-ink/80">{t('pastPaper.columnsHelp')}</p>
        <code className="block overflow-x-auto rounded-sm bg-ink/5 p-3 text-xs whitespace-nowrap">
          {PAST_PAPER_COLUMNS.join(',')}
        </code>
        <p className="text-sm text-ink/80">{t('pastPaper.rightsHelp')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="pp-input">{t('pastPaper.choose')}</Label>
            <input
              id="pp-input"
              type="file"
              accept=".csv,text/csv"
              className="text-sm file:mr-3 file:min-h-10 file:rounded-sm file:border file:border-primary/30 file:bg-background file:px-3"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            disabled={!file || isBusy}
            onClick={() => void run()}
            data-testid="past-paper-run"
          >
            {isBusy ? t('pastPaper.importing') : t('pastPaper.import')}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {tDynamic(error)}
          </p>
        ) : null}
      </section>
      {report ? (
        <section className={card} aria-labelledby="pp-report" data-testid="past-paper-report">
          <h2 id="pp-report" className="text-xl font-bold">
            {t('pastPaper.report')}
          </h2>
          <p role="status">
            {t('pastPaper.counts', {
              imported: formatInteger(report.imported),
              duplicates: formatInteger(report.duplicates),
              rejected: formatInteger(report.rejected.length),
            })}
          </p>
          {report.rejected.length > 0 ? (
            <ul className="flex flex-col divide-y divide-primary/10 text-sm">
              {report.rejected.map((r) => (
                <li key={r.line} className="flex flex-wrap gap-2 py-2">
                  <span className="font-semibold tabular-nums">
                    {t('pastPaper.line', { line: formatInteger(r.line) })}
                  </span>
                  <span>{r.reasons.map((x) => tDynamic(`pastPaper.reason.${x}`)).join(' · ')}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
