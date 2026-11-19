import { createFileRoute } from '@tanstack/react-router';
import { importPastPaperQuestions } from '#src/features/assessment/server/bank.functions.ts';
import type { PastPaperReport } from '#src/features/assessment/server/past-paper.server.ts';
import { PastPaperImport } from '#src/features/assessment/ui/PastPaperImport.tsx';

type Outcome = { ok: true; value: PastPaperReport } | { ok: false; error: { i18nKey?: string } };

// A12 past-paper import, for Admins with two-step sign-in (the server function checks).
export const Route = createFileRoute('/admin_/past-papers')({ component: PastPapersPage });

function PastPapersPage() {
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <PastPaperImport
          onImport={async (csv) => (await importPastPaperQuestions({ data: { csv } })) as Outcome}
        />
      </div>
    </div>
  );
}
