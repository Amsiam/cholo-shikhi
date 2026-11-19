import { createFileRoute, useRouter } from '@tanstack/react-router';
import {
  listStaffLiveClasses,
  scheduleLiveClass,
} from '#src/features/live/server/live.functions.ts';
import type { LiveClassCard } from '#src/features/live/server/live.server.ts';
import { LiveHostView } from '#src/features/live/ui/LiveHost.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome =
  | { ok: true }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

// Staff: live classes of the courses they teach.
export const Route = createFileRoute('/live-host/')({
  loader: async () => {
    const r = await listStaffLiveClasses({ data: {} });
    return r.ok
      ? {
          denied: false as const,
          ...(r.value as {
            classes: LiveClassCard[];
            courses: Array<{ courseId: string; titleBn: string; titleEn: string }>;
          }),
        }
      : { denied: true as const };
  },
  component: HostPage,
});

function HostPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied)
    return (
      <p role="alert" className="p-6">
        {t('catalog.instructor.denied')}
      </p>
    );
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <LiveHostView
          classes={data.classes}
          courses={data.courses}
          onSchedule={async (input) => {
            const r = (await scheduleLiveClass({ data: input })) as Outcome;
            if (r.ok) await router.invalidate();
            return r;
          }}
        />
      </div>
    </div>
  );
}
